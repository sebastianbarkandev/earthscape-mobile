import AVFoundation
import Foundation
import HaishinKit
import Speech
import os

/// Speech recognition for voice commands while publishing, fed from the `MediaMixer`
/// audio fan-out — the SAME PCM the encoder gets. There is no second capture graph and
/// the shared `AVAudioSession` is never touched, so it cannot fight HaishinKit (or
/// expo-video) for the microphone the way `expo-speech-recognition`'s own AVAudioEngine
/// tap would (LIVE-020 class of bug).
///
/// Lifecycle: `MediaMixer` → `mixer(_:didOutput:when:)` (copied off the mixer's task) →
/// serial `queue` → converted to the request's native format →
/// `SFSpeechAudioBufferRecognitionRequest`. On-device recognition never finalizes on its
/// own, so requests are rotated: ~1 s after the partial transcript stops changing the
/// current request gets `endAudio()` (→ its final result) and a fresh one is already
/// receiving audio; a hard cap rotates long silences / continuous speech too.
///
/// Everything mutable lives on `queue` (recognizer callbacks are delivered there as well).
final class VoiceCommandRecognizer: NSObject, @unchecked Sendable {
    static let locale = Locale(identifier: "en-US")

    /// (eventName, payload); always invoked on the main thread.
    var eventSink: ((String, [String: Any]) -> Void)?

    private let queue = DispatchQueue(label: "earthscape.live.voice")
    private let callbackQueue = OperationQueue()

    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var requestId = 0
    private var requestStart = Date()
    private var converter: AVAudioConverter?
    private var converterInput: AVAudioFormat?

    private var running = false
    private var micMuted = false
    private var available = true
    private var onDevice = false
    private var contextualStrings: [String] = []
    private var lastPartial = ""
    private var lastPartialSegments: [SFTranscriptionSegment] = []
    private var consecutiveErrors = 0
    private var lastErrorReason: String?
    private var lastStateSent: [String: Any] = [:]

    private var utteranceTimer: DispatchWorkItem?
    private var rotationTimer: DispatchWorkItem?
    private var restartTimer: DispatchWorkItem?

    /// A rotated-out request whose final has not arrived yet: its last stable partial, promoted
    /// to the final if the request errors out instead (1110 "no speech" is routine for a short
    /// word after `endAudio()`) or never finalizes. Without this a heard-and-shown "mark" is
    /// silently dropped while a four-word phrase sails through.
    private struct PendingFinal {
        let text: String
        let segments: [SFTranscriptionSegment]
        let start: Date
        let fallback: DispatchWorkItem
    }
    private var pendingFinals: [Int: PendingFinal] = [:]

    private static let log = Logger(subsystem: "earthscape.live", category: "voice")

    /// Silence after the last partial change before the utterance is finalized.
    private static let utteranceGap: TimeInterval = 1.0
    /// Hard cap per request (server recognition stops at 60 s; on-device is not immune to stalls).
    private static let requestCap: TimeInterval = 45
    /// How long a rotated-out request may take to deliver its final before the partial stands in.
    private static let finalGrace: TimeInterval = 1.5

    override init() {
        callbackQueue.underlyingQueue = queue
        callbackQueue.maxConcurrentOperationCount = 1
        super.init()
    }

    // MARK: - Permissions

    nonisolated static func authorizationName() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "undetermined"
        }
    }

    nonisolated static func requestAuthorization() async -> String {
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                SFSpeechRecognizer.requestAuthorization { _ in c.resume() }
            }
        }
        return authorizationName()
    }

    // MARK: - Control (thread-safe)

    func start(contextualStrings: [String]) {
        queue.async {
            self.contextualStrings = Array(contextualStrings.prefix(100))
            if self.running {
                self.emitState()
                return
            }
            self.running = true
            self.consecutiveErrors = 0
            self.lastErrorReason = nil
            let recognizer = SFSpeechRecognizer(locale: Self.locale)
            recognizer?.queue = self.callbackQueue
            recognizer?.delegate = self
            self.recognizer = recognizer
            self.available = recognizer?.isAvailable ?? false
            self.onDevice = recognizer?.supportsOnDeviceRecognition ?? false
            self.beginRequest()
            self.emitState()
        }
    }

    func stop() {
        queue.async {
            guard self.running else { return }
            self.running = false
            self.cancelTimers()
            self.task?.cancel()
            self.task = nil
            self.request = nil
            self.recognizer?.delegate = nil
            self.recognizer = nil
            self.converter = nil
            self.converterInput = nil
            self.lastPartial = ""
            self.lastPartialSegments = []
            self.pendingFinals.values.forEach { $0.fallback.cancel() }
            self.pendingFinals = [:]
            self.emitState()
        }
    }

    /// The publisher detaches the microphone device when muted, so no audio can reach us: the
    /// recognizer stays armed and the UI is told why nothing happens.
    func setMicMuted(_ muted: Bool) {
        queue.async {
            self.micMuted = muted
            self.emitState()
        }
    }

    // MARK: - Request lifecycle (on queue)

    private func beginRequest() {
        guard running, let recognizer else { return }
        cancelTimers()
        requestId += 1
        requestStart = Date()
        lastPartial = ""
        lastPartialSegments = []
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .search
        req.requiresOnDeviceRecognition = onDevice
        if !contextualStrings.isEmpty { req.contextualStrings = contextualStrings }
        if #available(iOS 16.0, *) { req.addsPunctuation = false }
        // A new native format may mean a new converter.
        converter = nil
        converterInput = nil
        request = req
        let id = requestId
        let start = requestStart
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            self?.handle(requestId: id, start: start, result: result, error: error)
        }
        let cap = DispatchWorkItem { [weak self] in self?.rotate(reason: "cap") }
        rotationTimer = cap
        queue.asyncAfter(deadline: .now() + Self.requestCap, execute: cap)
    }

    /// Hand audio to a fresh request first, then close the old one so it finalizes.
    private func rotate(reason: String) {
        guard running else { return }
        let old = request
        let oldId = requestId
        let oldStart = requestStart
        let partial = lastPartial
        let partialSegments = lastPartialSegments
        beginRequest()
        old?.endAudio()
        Self.log.info("rotate #\(oldId) (\(reason)) partial=\"\(partial, privacy: .public)\"")
        guard !partial.isEmpty else { return }
        let fallback = DispatchWorkItem { [weak self] in self?.promotePartial(requestId: oldId, why: "no final") }
        pendingFinals[oldId] = PendingFinal(text: partial, segments: partialSegments, start: oldStart, fallback: fallback)
        queue.asyncAfter(deadline: .now() + Self.finalGrace, execute: fallback)
    }

    /// The rotated-out request is not going to finalize: its last partial is what was heard.
    private func promotePartial(requestId id: Int, why: String) {
        guard running, let pending = pendingFinals.removeValue(forKey: id) else { return }
        pending.fallback.cancel()
        Self.log.notice("final #\(id) promoted from partial (\(why, privacy: .public)): \"\(pending.text, privacy: .public)\"")
        emitTranscript(requestId: id, start: pending.start, text: pending.text, segments: pending.segments, isFinal: true)
    }

    private func handle(requestId id: Int, start: Date, result: SFSpeechRecognitionResult?, error: Error?) {
        guard running else { return }
        let isCurrent = id == requestId
        if let result {
            consecutiveErrors = 0
            if lastErrorReason != nil {
                lastErrorReason = nil
                emitState()
            }
            let text = result.bestTranscription.formattedString
            if isCurrent && !result.isFinal {
                if text != lastPartial && !text.isEmpty {
                    lastPartial = text
                    scheduleUtteranceEnd()
                }
                if !text.isEmpty { lastPartialSegments = result.bestTranscription.segments }
            }
            if result.isFinal {
                if let pending = pendingFinals.removeValue(forKey: id) { pending.fallback.cancel() }
                Self.log.info("final #\(id): \"\(text, privacy: .public)\"")
            }
            if !text.isEmpty || result.isFinal {
                emitTranscript(requestId: id, start: start, text: text, segments: result.bestTranscription.segments, isFinal: result.isFinal)
            }
            return
        }
        if let error {
            let ns = error as NSError
            // Old requests fail routinely on endAudio() with nothing to say (1110 "no speech") —
            // but one that DID produce a partial is a heard utterance: promote it.
            guard isCurrent else {
                Self.log.info("request #\(id) ended with error \(ns.domain, privacy: .public)/\(ns.code)")
                promotePartial(requestId: id, why: "error \(ns.code)")
                return
            }
            Self.log.error("current request #\(id) failed: \(ns.domain, privacy: .public)/\(ns.code) \(ns.localizedDescription, privacy: .public)")
            if ns.domain == "kAFAssistantErrorDomain" && (ns.code == 209 || ns.code == 216) { return } // cancelled by us
            consecutiveErrors += 1
            let backoff = min(5.0, 0.5 * pow(2.0, Double(consecutiveErrors - 1)))
            if consecutiveErrors >= 3 {
                lastErrorReason = Self.describe(ns)
                emitState()
            }
            task?.cancel()
            task = nil
            request = nil
            cancelTimers()
            let work = DispatchWorkItem { [weak self] in self?.beginRequest() }
            restartTimer = work
            queue.asyncAfter(deadline: .now() + backoff, execute: work)
        }
    }

    private func scheduleUtteranceEnd() {
        utteranceTimer?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.rotate(reason: "utterance") }
        utteranceTimer = work
        queue.asyncAfter(deadline: .now() + Self.utteranceGap, execute: work)
    }

    private func cancelTimers() {
        utteranceTimer?.cancel(); utteranceTimer = nil
        rotationTimer?.cancel(); rotationTimer = nil
        restartTimer?.cancel(); restartTimer = nil
    }

    // MARK: - Audio (on queue)

    private func append(_ buffer: AVAudioPCMBuffer) {
        guard running, let request else { return }
        let target = request.nativeAudioFormat
        if buffer.format == target {
            request.append(buffer)
            return
        }
        if converter == nil || converterInput != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: target)
            converterInput = buffer.format
        }
        guard let converter else { return }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var consumed = false
        var error: NSError?
        let status = converter.convert(to: out, error: &error) { _, outStatus in
            if consumed {
                outStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            outStatus.pointee = .haveData
            return buffer
        }
        if status == .error || error != nil { return }
        if out.frameLength > 0 { request.append(out) }
    }

    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        copy.frameLength = buffer.frameLength
        let src = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
        let dst = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for (s, d) in zip(src, dst) {
            guard let sd = s.mData, let dd = d.mData else { return nil }
            memcpy(dd, sd, Int(min(s.mDataByteSize, d.mDataByteSize)))
        }
        return copy
    }

    // MARK: - Events

    private func emitTranscript(requestId id: Int, start: Date, text: String, segments: [SFTranscriptionSegment], isFinal: Bool) {
        let segments: [[String: Any]] = segments.map { seg in
            var d: [String: Any] = [
                "text": seg.substring,
                "durationSec": seg.duration,
                "confidence": seg.confidence,
            ]
            // Partial results often carry 0 timestamps; only a real offset is turned into a clock.
            if seg.timestamp > 0 {
                d["startUnix"] = start.timeIntervalSince1970 + seg.timestamp
            } else {
                d["startUnix"] = NSNull()
            }
            return d
        }
        send("onVoiceTranscript", [
            "requestId": id,
            "text": text,
            "isFinal": isFinal,
            "onDevice": onDevice,
            "requestStartUnix": start.timeIntervalSince1970,
            "segments": segments,
        ])
    }

    private func emitState() {
        let state: String
        if !running { state = "off" }
        else if !available { state = "unavailable" }
        else if micMuted { state = "paused_muted" }
        else if lastErrorReason != nil { state = "error" }
        else { state = "listening" }
        var payload: [String: Any] = ["state": state, "onDevice": onDevice]
        if let lastErrorReason { payload["reason"] = lastErrorReason }
        if !available { payload["reason"] = "Speech recognition is not available right now" }
        if (lastStateSent["state"] as? String) == state && (lastStateSent["reason"] as? String) == (payload["reason"] as? String) { return }
        lastStateSent = payload
        send("onVoiceState", payload)
    }

    private func send(_ name: String, _ body: [String: Any]) {
        guard let sink = eventSink else { return }
        DispatchQueue.main.async { sink(name, body) }
    }

    private static func describe(_ e: NSError) -> String {
        switch e.code {
        case 1101: return "On-device dictation is not enabled (Settings › General › Keyboard › Enable Dictation)"
        case 203: return "Speech recognition timed out; retrying"
        case 1110: return "No speech detected"
        default: return e.localizedDescription
        }
    }
}

extension VoiceCommandRecognizer: SFSpeechRecognizerDelegate {
    func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        queue.async {
            let was = self.available
            self.available = available
            if available && !was && self.running && self.task == nil { self.beginRequest() }
            self.emitState()
        }
    }
}

extension VoiceCommandRecognizer: MediaMixerOutput {
    /// Only outputs with `UInt8.max` receive the mixed audio; we take no video at all.
    var videoTrackId: UInt8? { nil }
    var audioTrackId: UInt8? { UInt8.max }

    func mixer(_ mixer: MediaMixer, didOutput sampleBuffer: CMSampleBuffer) {}

    func mixer(_ mixer: MediaMixer, didOutput buffer: AVAudioPCMBuffer, when: AVAudioTime) {
        // The mixer may recycle its buffers; copy (~4 KB) so its audio loop is never blocked on us.
        guard let copy = Self.copy(buffer) else { return }
        queue.async { self.append(copy) }
    }

    func selectTrack(_ id: UInt8?, mediaType: CMFormatDescription.MediaType) async {}
}
