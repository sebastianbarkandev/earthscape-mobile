import AVFoundation
import Foundation
import HaishinKit
import Network
import SRTHaishinKit
import UIKit
import VideoToolbox

/// Encoder preset (landscape dimensions; swapped for portrait capture).
struct PublishPreset {
    var width = 1280
    var height = 720
    var fps = 30
    var bitrateKbps = 2500
    var maxBitrateKbps = 4000
    var minBitrateKbps = 500

    mutating func apply(_ record: PresetRecord?) {
        guard let r = record else { return }
        if let v = r.width, v > 0 { width = v }
        if let v = r.height, v > 0 { height = v }
        if let v = r.fps, v > 0 { fps = v }
        if let v = r.bitrateKbps, v > 0 { bitrateKbps = v }
        if let v = r.maxBitrateKbps, v > 0 { maxBitrateKbps = v }
        if let v = r.minBitrateKbps, v > 0 { minBitrateKbps = v }
        maxBitrateKbps = max(maxBitrateKbps, minBitrateKbps)
        bitrateKbps = min(max(bitrateKbps, minBitrateKbps), maxBitrateKbps)
    }
}

struct PublishSession {
    let url: URL
    let latencyMs: Double
    var audioBitrateKbps: Int
    var keyframeIntervalSec: Int32
    var adaptiveBitrate: Bool
    var autoReconnect: Bool
    var maxReconnectAttempts: Int
}

/// The single live-publishing engine behind the Expo module.
///
/// Pipeline: `MediaMixer` (camera + mic, VideoToolbox H.264 + AAC) → `SRTStream`
/// over an `SRTConnection` in **caller** mode → Earthscape's per-stream SRT
/// listener. Everything network-related is resilient by construction:
///  * link loss → exponential backoff reconnect (camera keeps running),
///  * network path change (Wi-Fi ⇄ cellular) → immediate reconnect,
///  * app background → connection parked, resumed on foreground,
///  * congestion → adaptive bitrate (see `AdaptiveBitrateController`),
///  * thermal pressure → bitrate ceiling.
@MainActor
final class LivePublisher {
    static let shared = LivePublisher()

    enum State: String {
        case idle, preview, connecting, publishing, reconnecting, stopping
    }

    struct PublisherError: LocalizedError {
        let code: String
        let message: String
        var errorDescription: String? { message }
    }

    /// Set by the Expo module; receives (eventName, payload).
    var eventSink: ((String, [String: Any]) -> Void)?

    private(set) var state: State = .idle

    private let mixer = MediaMixer()
    private var connection: SRTConnection?
    private var stream: SRTStream?
    private var previewViews = NSHashTable<MTHKView>.weakObjects()

    private var preset = PublishPreset()
    private var cameraPosition: AVCaptureDevice.Position = .back
    private var orientationMode = "auto"
    private var mirrorFront = true
    private var muted = false
    private var mixerRunning = false

    private var session: PublishSession?
    private var shouldBePublishing = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var statsTask: Task<Void, Never>?
    private var connectTask: Task<Void, Never>?
    private var sessionStart: Date?
    private var lastPerf: SRTPerformanceData?
    private var lastPerfAt: Date?
    private var currentBitrateKbps = 2500
    private var abr = AdaptiveBitrateController(minKbps: 500, maxKbps: 4000)
    private var pathMonitor: NWPathMonitor?
    private var lastPathStatus: NWPath.Status = .requiresConnection
    private var observers: [NSObjectProtocol] = []
    private var parkedForBackground = false

    /// Voice commands: a second audio output on the mixer (see VoiceCommandRecognizer).
    private let voice = VoiceCommandRecognizer()
    private var voiceAttached = false

    /// Hard cap on one connect attempt (handshake + publish). libsrt's own caller timeout
    /// (`conntimeo`, see `dialURL`) normally fires first; this is the backstop for the case
    /// seen on 2026-08-27 where `connect()` never returned and the UI sat in "Connecting…".
    private static let connectTimeout: TimeInterval = 15
    /// libsrt caller handshake timeout (ms) appended to the ingest URL when the backend
    /// didn't set one. Default in libsrt is 3 s; 8 s tolerates a slow listener start
    /// without letting a dead port stall the attempt.
    private static let defaultConnTimeoutMs = 8000

    private init() {
        installLifecycleObservers()
        voice.eventSink = { [weak self] name, body in
            Task { @MainActor in self?.eventSink?(name, body) }
        }
    }

    // MARK: - Public surface used by the module

    var stateName: String { state.rawValue }

    nonisolated static func permissionStatus() -> [String: String] {
        func map(_ s: AVAuthorizationStatus) -> String {
            switch s {
            case .authorized: return "granted"
            case .denied, .restricted: return "denied"
            default: return "undetermined"
            }
        }
        return [
            "camera": map(AVCaptureDevice.authorizationStatus(for: .video)),
            "microphone": map(AVCaptureDevice.authorizationStatus(for: .audio)),
        ]
    }

    nonisolated static func requestPermissions() async -> [String: String] {
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .audio)
        }
        return permissionStatus()
    }

    func attachPreview(_ view: MTHKView) {
        previewViews.add(view)
        if mixerRunning {
            Task { await mixer.addOutput(view) }
        }
    }

    func detachPreview(_ view: MTHKView) {
        previewViews.remove(view)
        Task { await mixer.removeOutput(view) }
    }

    func startPreview(_ options: PreviewOptionsRecord) async throws {
        if let camera = options.camera { cameraPosition = camera == "front" ? .front : .back }
        if let o = options.orientation { orientationMode = o }
        if let m = options.mirrorFront { mirrorFront = m }
        preset.apply(options.preset)
        try await startMixerIfNeeded()
        if state == .idle { setState(.preview, reason: "preview") }
    }

    func stopPreview() async {
        await stopPublish(reason: "preview stopped")
        await setVoiceListening(false, contextualStrings: [])
        await mixer.stopRunning()
        try? await mixer.attachVideo(nil, track: 0)
        try? await mixer.attachAudio(nil, track: 0)
        mixerRunning = false
        releaseAudioSession()
        setState(.idle, reason: "preview stopped")
    }

    func startPublish(_ options: PublishOptionsRecord) async throws {
        guard let url = URL(string: options.url), url.scheme?.lowercased() == "srt" else {
            throw PublisherError(code: "bad_url", message: "Ingest URL must be an srt:// URL")
        }
        if shouldBePublishing {
            throw PublisherError(code: "already_publishing", message: "A publish session is already active")
        }
        preset.apply(options.preset)
        currentBitrateKbps = preset.bitrateKbps
        abr = AdaptiveBitrateController(minKbps: preset.minBitrateKbps, maxKbps: preset.maxBitrateKbps)
        abr.setThermal(ProcessInfo.processInfo.thermalState)

        let latency = Double(Self.queryValue(url, "latency") ?? "") ?? 120
        session = PublishSession(
            url: Self.dialURL(url),
            latencyMs: latency,
            audioBitrateKbps: options.audioBitrateKbps ?? 96,
            keyframeIntervalSec: Int32(options.keyframeIntervalSec ?? 2),
            adaptiveBitrate: options.adaptiveBitrate ?? true,
            autoReconnect: options.autoReconnect ?? true,
            maxReconnectAttempts: options.maxReconnectAttempts ?? 0
        )

        try await startMixerIfNeeded()

        await makeTransport()

        shouldBePublishing = true
        reconnectAttempt = 0
        sessionStart = nil
        lastPerf = nil
        lastPerfAt = nil
        startPathMonitor()
        startStatsLoop()
        await connectOnce()
    }

    func stopPublish(reason: String = "user") async {
        guard shouldBePublishing || connection != nil else { return }
        shouldBePublishing = false
        reconnectTask?.cancel(); reconnectTask = nil
        connectTask?.cancel(); connectTask = nil
        statsTask?.cancel(); statsTask = nil
        stopPathMonitor()
        setState(.stopping, reason: reason)
        if let stream { await stream.close(); await mixer.removeOutput(stream) }
        if let connection { await connection.close() }
        stream = nil
        connection = nil
        session = nil
        setState(mixerRunning ? .preview : .idle, reason: reason)
    }

    func setVideoBitrate(_ kbps: Int) async {
        guard let stream else {
            currentBitrateKbps = kbps
            return
        }
        let clamped = min(max(kbps, preset.minBitrateKbps), preset.maxBitrateKbps)
        currentBitrateKbps = clamped
        var settings = await stream.videoSettings
        settings.bitRate = clamped * 1000
        await stream.setVideoSettings(settings)
    }

    func setMaxVideoBitrate(_ kbps: Int) async {
        preset.maxBitrateKbps = max(kbps, preset.minBitrateKbps)
        abr.setMax(preset.maxBitrateKbps)
        if currentBitrateKbps > preset.maxBitrateKbps { await setVideoBitrate(preset.maxBitrateKbps) }
    }

    func switchCamera() async throws -> String {
        cameraPosition = cameraPosition == .back ? .front : .back
        if mixerRunning { try await attachCamera() }
        return cameraPosition == .front ? "front" : "back"
    }

    func setTorch(_ enabled: Bool) async {
        await mixer.setTorchEnabled(enabled)
    }

    func setMuted(_ muted: Bool) async throws {
        self.muted = muted
        voice.setMicMuted(muted)
        guard mixerRunning else { return }
        if muted {
            try await mixer.attachAudio(nil, track: 0)
        } else {
            try await mixer.attachAudio(AVCaptureDevice.default(for: .audio), track: 0)
        }
    }

    // MARK: - Voice commands

    nonisolated static func speechPermissionStatus() -> String {
        VoiceCommandRecognizer.authorizationName()
    }

    nonisolated static func requestSpeechPermission() async -> String {
        await VoiceCommandRecognizer.requestAuthorization()
    }

    /// Arm/disarm the recognizer. Needs the camera session (the mic is attached to the mixer,
    /// not to us) and speech authorization; the recognizer reports its own state via
    /// `onVoiceState` and utterances via `onVoiceTranscript`.
    func setVoiceListening(_ on: Bool, contextualStrings: [String]) async {
        if on {
            if !voiceAttached {
                await mixer.addOutput(voice)
                voiceAttached = true
            }
            voice.setMicMuted(muted)
            voice.start(contextualStrings: contextualStrings)
        } else {
            voice.stop()
            if voiceAttached {
                await mixer.removeOutput(voice)
                voiceAttached = false
            }
        }
    }

    nonisolated static func haptic(_ kind: String) {
        DispatchQueue.main.async {
            switch kind {
            case "success":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.success)
            case "warning":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.warning)
            case "error":
                let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.error)
            case "heavy":
                let g = UIImpactFeedbackGenerator(style: .heavy); g.prepare(); g.impactOccurred()
            case "medium":
                let g = UIImpactFeedbackGenerator(style: .medium); g.prepare(); g.impactOccurred()
            default:
                let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); g.impactOccurred()
            }
        }
    }

    func setOrientation(_ mode: String) async {
        orientationMode = mode
        await applyOrientation()
        if let stream { await stream.setVideoSettings(makeVideoSettings()) }
    }

    func currentStats() async -> [String: Any]? {
        guard let perf = lastPerf else { return nil }
        return statsPayload(perf: perf, delta: nil, intervalSec: 1)
    }

    // MARK: - Capture

    private func startMixerIfNeeded() async throws {
        if mixerRunning { return }
        try configureAudioSession()
        await mixer.setFrameRate(Float64(preset.fps))
        await mixer.setSessionPreset(sessionPreset())
        try await attachCamera()
        if !muted {
            try await mixer.attachAudio(AVCaptureDevice.default(for: .audio), track: 0)
        }
        await applyOrientation()
        for view in previewViews.allObjects {
            await mixer.addOutput(view)
        }
        await mixer.startRunning()
        mixerRunning = true
    }

    private func attachCamera() async throws {
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: cameraPosition)
            ?? AVCaptureDevice.default(for: .video)
        guard let device else {
            throw PublisherError(code: "no_camera", message: "No camera available on this device")
        }
        let mirror = cameraPosition == .front && mirrorFront
        do {
            try await mixer.attachVideo(device, track: 0) { unit in
                unit.isVideoMirrored = mirror
                unit.preferredVideoStabilizationMode = .standard
            }
        } catch {
            throw PublisherError(code: "camera_attach_failed", message: "Could not start the camera: \(error.localizedDescription)")
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        // LIVE-020: deliberately NOT .mixWithOthers. With .playAndRecord + .defaultToSpeaker any
        // audio another app keeps playing leaves the speaker while the mic is capturing, and lands
        // in the published AAC track as echo/feedback. An exclusive session interrupts that audio
        // instead of recording it. (In-app playback is not affected by this option — expo-video
        // shares this same AVAudioSession — so PlayerScreen pauses itself before pushing /golive.)
        try session.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
    }

    /// LIVE-020: give the audio route back when the camera stops. Without this the process keeps a
    /// .playAndRecord/.videoRecording session (mic hot, recording indicator on, record-side routing)
    /// after the viewer leaves the Go Live screen. The category is left alone on purpose: expo-video's
    /// VideoManager re-asserts .playback/.moviePlayback on the next player state change.
    private func releaseAudioSession() {
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// LIVE-024 (recovery half): something took the shared audio session away from capture —
    /// expo-video's VideoManager re-asserts `.playback`/`.moviePlayback` on every player state
    /// change (it sets the CATEGORY unconditionally, so muted players do it too), and an
    /// interruption or a media-services reset leaves the session in whatever state it likes.
    /// While we still own the camera that means a dead microphone, so put our session back.
    /// The app prevents the common case (ProgramStrip freezes its tiles while the Go Live screen
    /// is up — src/features/broadcast/audioFocus.ts); this is the belt and braces for the rest.
    private func reassertAudioSessionIfCapturing(reason: String) {
        guard mixerRunning else { return }
        let session = AVAudioSession.sharedInstance()
        if session.category == .playAndRecord && session.mode == .videoRecording { return }
        do {
            try configureAudioSession()
        } catch {
            // Non-fatal: surfaced as lastEvent, never as a stream-killing error.
            eventSink?("onError", [
                "code": "audio_session_lost",
                "message": "Could not restore the microphone session after \(reason): \(error.localizedDescription)",
                "fatal": false,
            ])
        }
    }

    private func sessionPreset() -> AVCaptureSession.Preset {
        switch max(preset.width, preset.height) {
        case 1920...: return .hd1920x1080
        case 1280...: return .hd1280x720
        default: return .vga640x480
        }
    }

    private var isPortrait: Bool {
        switch orientationMode {
        case "portrait": return true
        case "landscape": return false
        default:
            // Auto: follow the interface orientation (portrait when face up/unknown).
            let o = UIDevice.current.orientation
            return !(o == .landscapeLeft || o == .landscapeRight)
        }
    }

    private func applyOrientation() async {
        let orientation: AVCaptureVideoOrientation
        switch orientationMode {
        case "portrait": orientation = .portrait
        case "landscape":
            orientation = UIDevice.current.orientation == .landscapeLeft ? .landscapeLeft : .landscapeRight
        default:
            switch UIDevice.current.orientation {
            case .landscapeLeft: orientation = .landscapeLeft
            case .landscapeRight: orientation = .landscapeRight
            case .portraitUpsideDown: orientation = .portraitUpsideDown
            default: orientation = .portrait
            }
        }
        await mixer.setVideoOrientation(orientation)
    }

    private func makeVideoSettings() -> VideoCodecSettings {
        var s = VideoCodecSettings.default
        let w = preset.width, h = preset.height
        s.videoSize = isPortrait ? CGSize(width: h, height: w) : CGSize(width: w, height: h)
        s.bitRate = currentBitrateKbps * 1000
        // Main profile, no B-frames: good compression for the archive/HLS, lowest encode latency.
        s.profileLevel = kVTProfileLevel_H264_Main_AutoLevel as String
        s.allowFrameReordering = false
        s.maxKeyFrameIntervalDuration = session?.keyframeIntervalSec ?? 2
        s.scalingMode = .trim
        s.bitRateMode = .average
        s.isHardwareEncoderEnabled = true
        return s
    }

    private func makeAudioSettings() -> AudioCodecSettings {
        var a = AudioCodecSettings()
        a.bitRate = (session?.audioBitrateKbps ?? 96) * 1000
        a.downmix = true
        return a
    }

    // MARK: - Connection lifecycle

    /// Single-flight connect: a path-restored `reconnectNow` or a backoff timer firing while a
    /// handshake is still in progress joins the in-flight attempt instead of starting a second
    /// `connect()` on the same `SRTConnection` (the loser threw `invalidState`, tore the winner's
    /// fresh link down and doubled `reconnectAttempt` on every Wi-Fi ⇄ cellular flap).
    private func connectOnce() async {
        if let inFlight = connectTask {
            await inFlight.value
            return
        }
        // Explicit type: without it the single-expression closure infers `Task<Void?, Never>`.
        let task: Task<Void, Never> = Task { [weak self] in await self?.performConnect() }
        connectTask = task
        await task.value
        if connectTask == task { connectTask = nil }
    }

    private func performConnect() async {
        guard shouldBePublishing, let connection, let stream, let session else { return }
        setState(reconnectAttempt > 0 ? .reconnecting : .connecting, reason: reconnectAttempt > 0 ? "retry" : "connect", attempt: reconnectAttempt)
        do {
            try await Self.withTimeout(Self.connectTimeout, code: "connect_timeout",
                                       message: "SRT connect timed out after \(Int(Self.connectTimeout))s") {
                try await connection.connect(session.url)
            }
            // stopPublish() cancelled us mid-handshake, or a timeout already rebuilt the
            // transport under us: leave this (stale) connection to its teardown.
            guard shouldBePublishing, !Task.isCancelled, self.connection === connection else { return }
            await stream.publish()
            reconnectAttempt = 0
            if sessionStart == nil { sessionStart = Date() }
            lastPerf = nil
            lastPerfAt = nil
            setState(.publishing, reason: "connected")
        } catch {
            let timedOut = (error as? PublisherError)?.code == "connect_timeout"
            emitError(code: timedOut ? "connect_timeout" : "connect_failed", message: describe(error), fatal: false)
            await handleLinkFailure(reason: timedOut ? "connect timed out" : "connect failed")
        }
    }

    /// Race `operation` against a deadline. On timeout the operation's task is cancelled and
    /// left to finish on its own (a blocking `srt_connect` cannot be interrupted, so the caller
    /// must also stop using the connection it was made on — see `handleLinkFailure`).
    private static func withTimeout<T: Sendable>(
        _ seconds: TimeInterval, code: String, message: String,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await operation() }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw PublisherError(code: code, message: message)
            }
            let result = try await group.next()!
            group.cancelAll()
            return result
        }
    }

    /// Create a fresh SRT connection + stream, wire the stream into the mixer and apply the
    /// current codec settings. Any previous stream is detached first. Called on start and
    /// after every link failure so a retry never reuses a connection whose handshake may
    /// still be wedged inside libsrt.
    private func makeTransport() async {
        if let old = stream { await mixer.removeOutput(old) }
        let connection = SRTConnection()
        let stream = SRTStream(connection: connection)
        self.connection = connection
        self.stream = stream
        await stream.setVideoSettings(makeVideoSettings())
        await stream.setAudioSettings(makeAudioSettings())
        await mixer.addOutput(stream)
    }

    /// The URL we actually dial: the backend's ingest URL plus a libsrt caller timeout
    /// (`conntimeo`) when it didn't specify one, so a port with no listener fails fast
    /// instead of relying on the library default.
    private static func dialURL(_ url: URL) -> URL {
        guard var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = comps.queryItems ?? []
        if !items.contains(where: { $0.name.lowercased() == "conntimeo" }) {
            items.append(URLQueryItem(name: "conntimeo", value: String(defaultConnTimeoutMs)))
            comps.queryItems = items
        }
        return comps.url ?? url
    }

    private func handleLinkFailure(reason: String) async {
        guard shouldBePublishing, let session else { return }
        // Tear the transport down and rebuild it so the next attempt starts clean — including
        // after a connect timeout, where the old connection may still be blocked in libsrt.
        if let stream { await stream.close() }
        if let connection { await connection.close() }
        await makeTransport()
        guard session.autoReconnect else {
            emitError(code: "link_lost", message: reason, fatal: true)
            await stopPublish(reason: reason)
            return
        }
        reconnectAttempt += 1
        if session.maxReconnectAttempts > 0 && reconnectAttempt > session.maxReconnectAttempts {
            emitError(code: "reconnect_exhausted", message: "Gave up after \(session.maxReconnectAttempts) attempts", fatal: true)
            await stopPublish(reason: "reconnect exhausted")
            return
        }
        let delay = parkedForBackground ? 3600 : Backoff.delay(attempt: reconnectAttempt)
        setState(.reconnecting, reason: reason, attempt: reconnectAttempt, nextRetryMs: Int(delay * 1000))
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.connectOnce()
        }
    }

    /// Cut the backoff short (network came back, app foregrounded).
    private func reconnectNow(reason: String) {
        guard shouldBePublishing, state == .reconnecting || parkedForBackground else { return }
        // Clear the park flag FIRST: an attempt still on the wire when we foregrounded would
        // otherwise compute its next backoff as the 1-hour parked delay (LIVE-019).
        parkedForBackground = false
        // An attempt is already on the wire: it will either publish or schedule the next retry.
        guard connectTask == nil else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            await self?.connectOnce()
        }
    }

    // MARK: - Stats + ABR (1 Hz)

    private func startStatsLoop() {
        statsTask?.cancel()
        statsTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                await self?.statsTick()
            }
        }
    }

    private func statsTick() async {
        guard shouldBePublishing, let connection, let session else { return }
        let connected = await connection.connected
        if state == .publishing && !connected {
            await handleLinkFailure(reason: "connection lost")
            return
        }
        guard state == .publishing, let perf = await connection.performanceData else { return }
        let now = Date()
        let interval = max(0.25, lastPerfAt.map { now.timeIntervalSince($0) } ?? 1)
        let delta = lastPerf.map { PerfDelta(prev: $0, cur: perf) }
        lastPerf = perf
        lastPerfAt = now

        if session.adaptiveBitrate, let d = delta {
            let sample = LinkSample(
                lossRatio: d.pktSent > 0 ? Double(d.retrans + d.dropped) / Double(d.pktSent) : 0,
                rttMs: perf.msRTT,
                sendBufferMs: Double(perf.msSndBuf),
                latencyMs: session.latencyMs,
                bandwidthKbps: perf.mbpsBandwidth * 1000,
                currentKbps: currentBitrateKbps
            )
            switch abr.evaluate(sample) {
            case .stepDown(let kbps, _): await setVideoBitrate(kbps)
            case .stepUp(let kbps): await setVideoBitrate(kbps)
            case .hold: break
            }
        }
        eventSink?("onStats", statsPayload(perf: perf, delta: delta, intervalSec: interval))
    }

    private struct PerfDelta {
        let pktSent: Int64
        let retrans: Int32
        let dropped: Int32
        let lost: Int32
        let bytes: UInt64
        init(prev: SRTPerformanceData, cur: SRTPerformanceData) {
            pktSent = max(0, cur.pktSentTotal - prev.pktSentTotal)
            retrans = max(0, cur.pktRetransTotal - prev.pktRetransTotal)
            dropped = max(0, cur.pktSndDropTotal - prev.pktSndDropTotal)
            lost = max(0, cur.pktSndLossTotal - prev.pktSndLossTotal)
            bytes = cur.byteSentTotal >= prev.byteSentTotal ? cur.byteSentTotal - prev.byteSentTotal : 0
        }
    }

    private func statsPayload(perf: SRTPerformanceData, delta: PerfDelta?, intervalSec: Double) -> [String: Any] {
        let sendRateKbps = delta.map { Double($0.bytes) * 8.0 / 1000.0 / intervalSec } ?? perf.mbpsSendRate * 1000
        return [
            "elapsedSec": sessionStart.map { Date().timeIntervalSince($0) } ?? 0,
            "videoBitrateKbps": currentBitrateKbps,
            "sendRateKbps": Int(sendRateKbps),
            "rttMs": perf.msRTT,
            "retransmitted": Int(delta?.retrans ?? 0),
            "dropped": Int(delta?.dropped ?? 0),
            "lost": Int(delta?.lost ?? 0),
            "sendBufferMs": Int(perf.msSndBuf),
            "bandwidthKbps": Int(perf.mbpsBandwidth * 1000),
            "congestion": abr.lastCongestion,
            "bytesSentTotal": Int(perf.byteSentTotal),
            "tier": "\(currentBitrateKbps) kbps",
            "thermalState": Self.thermalName(ProcessInfo.processInfo.thermalState),
        ]
    }

    // MARK: - Network path + app lifecycle

    private func startPathMonitor() {
        stopPathMonitor()
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.handlePath(path) }
        }
        monitor.start(queue: DispatchQueue(label: "earthscape.live.path"))
        pathMonitor = monitor
    }

    private func stopPathMonitor() {
        pathMonitor?.cancel()
        pathMonitor = nil
    }

    private func handlePath(_ path: NWPath) {
        let iface: String
        if path.usesInterfaceType(.wifi) { iface = "wifi" }
        else if path.usesInterfaceType(.cellular) { iface = "cellular" }
        else if path.usesInterfaceType(.wiredEthernet) { iface = "wired" }
        else if path.status == .satisfied { iface = "other" }
        else { iface = "none" }
        let status: String
        switch path.status {
        case .satisfied: status = "satisfied"
        case .unsatisfied: status = "unsatisfied"
        default: status = "requiresConnection"
        }
        eventSink?("onNetworkPath", [
            "status": status,
            "interface": iface,
            "expensive": path.isExpensive,
            "constrained": path.isConstrained,
        ])
        let becameSatisfied = path.status == .satisfied && lastPathStatus != .satisfied
        lastPathStatus = path.status
        if becameSatisfied && state == .reconnecting {
            reconnectNow(reason: "network restored")
        }
    }

    private func installLifecycleObservers() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.parkForBackground() }
        })
        observers.append(nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.resumeFromBackground() }
        })
        observers.append(nc.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.orientationMode == "auto", self.mixerRunning else { return }
                await self.applyOrientation()
            }
        })
        // LIVE-024: the audio session is process-wide and shared with expo-video. A category
        // change (route-change reason .categoryChange), the end of an interruption, or a media
        // services reset can all leave us without a recording session while the camera runs.
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard raw == AVAudioSession.RouteChangeReason.categoryChange.rawValue else { return }
            Task { @MainActor in self?.reassertAudioSessionIfCapturing(reason: "an audio category change") }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.ended.rawValue else { return }
            Task { @MainActor in self?.reassertAudioSessionIfCapturing(reason: "an audio interruption") }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.reassertAudioSessionIfCapturing(reason: "a media services reset") }
        })
        observers.append(nc.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.abr.setThermal(ProcessInfo.processInfo.thermalState)
            }
        })
        UIDevice.current.beginGeneratingDeviceOrientationNotifications()
    }

    /// iOS stops camera capture in the background; park the link and resume on return.
    private func parkForBackground() async {
        guard shouldBePublishing else { return }
        parkedForBackground = true
        reconnectTask?.cancel()
        // An attempt already inside performConnect() is deliberately NOT cancelled: closing the
        // connection below makes it fail on its own, and starting a second connect on a socket
        // libsrt may still be wedged in is what the single-flight guard exists to prevent. Its
        // failure now schedules ordinary backoff because resumeFromBackground clears the park
        // flag before that failure lands (LIVE-019).
        if let stream { await stream.close() }
        if let connection { await connection.close() }
        setState(.reconnecting, reason: "background", attempt: reconnectAttempt)
    }

    private func resumeFromBackground() {
        guard shouldBePublishing, parkedForBackground else { return }
        reconnectNow(reason: "foreground")
    }

    // MARK: - Helpers

    private func setState(_ new: State, reason: String, attempt: Int? = nil, nextRetryMs: Int? = nil) {
        let previous = state
        state = new
        var payload: [String: Any] = ["state": new.rawValue, "previous": previous.rawValue, "reason": reason]
        if let attempt { payload["attempt"] = attempt }
        if let nextRetryMs { payload["nextRetryMs"] = nextRetryMs }
        eventSink?("onStateChange", payload)
    }

    private func emitError(code: String, message: String, fatal: Bool) {
        eventSink?("onError", ["code": code, "message": message, "fatal": fatal])
    }

    private func describe(_ error: Error) -> String {
        if let e = error as? SRTConnection.Error {
            switch e {
            case .invalidState: return "SRT connection is in an invalid state"
            case .unsupportedUri(let uri):
                // The query carries the ingest passphrase — report scheme/host/port only (SEC-010).
                var redacted = uri.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                redacted?.query = nil
                return "Unsupported SRT URL: \(redacted?.string ?? "?")"
            case .failedToConnect(let message, let reason): return "SRT connect failed: \(message) (\(reason))"
            }
        }
        return error.localizedDescription
    }

    private static func queryValue(_ url: URL, _ name: String) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
    }

    private static func thermalName(_ s: ProcessInfo.ThermalState) -> String {
        switch s {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }
}
