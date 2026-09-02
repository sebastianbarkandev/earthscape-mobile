import ExpoModulesCore

struct PresetRecord: Record {
    @Field var width: Int?
    @Field var height: Int?
    @Field var fps: Int?
    @Field var bitrateKbps: Int?
    @Field var maxBitrateKbps: Int?
    @Field var minBitrateKbps: Int?
}

struct PreviewOptionsRecord: Record {
    @Field var camera: String?
    @Field var orientation: String?
    @Field var preset: PresetRecord?
    @Field var mirrorFront: Bool?
}

struct PublishOptionsRecord: Record {
    @Field var url: String = ""
    @Field var preset: PresetRecord?
    @Field var audioBitrateKbps: Int?
    @Field var keyframeIntervalSec: Int?
    @Field var adaptiveBitrate: Bool?
    @Field var autoReconnect: Bool?
    @Field var maxReconnectAttempts: Int?
}

/// Expo module: thin bridge from JS to `LivePublisher` (the engine) and the preview view.
public class EarthscapeLiveModule: Module {
    public func definition() -> ModuleDefinition {
        Name("EarthscapeLive")

        Constants([
            "isSupported": true,
            "isVoiceSupported": true,
        ])

        Events("onStateChange", "onStats", "onError", "onNetworkPath", "onVoiceState", "onVoiceTranscript")

        OnCreate {
            Task { @MainActor in
                LivePublisher.shared.eventSink = { [weak self] name, body in
                    self?.sendEvent(name, body)
                }
            }
        }

        OnDestroy {
            Task { @MainActor in
                LivePublisher.shared.eventSink = nil
                await LivePublisher.shared.stopPreview()
            }
        }

        Function("getState") { () -> String in
            // Called from the JS thread; the engine is main-actor isolated, so hop synchronously.
            if Thread.isMainThread {
                return MainActor.assumeIsolated { LivePublisher.shared.stateName }
            }
            return DispatchQueue.main.sync { MainActor.assumeIsolated { LivePublisher.shared.stateName } }
        }

        AsyncFunction("requestPermissions") { () async -> [String: String] in
            await LivePublisher.requestPermissions()
        }

        AsyncFunction("getPermissions") { () -> [String: String] in
            LivePublisher.permissionStatus()
        }

        AsyncFunction("startPreview") { (options: PreviewOptionsRecord) async throws in
            try await LivePublisher.shared.startPreview(options)
        }

        AsyncFunction("stopPreview") { () async in
            await LivePublisher.shared.stopPreview()
        }

        AsyncFunction("startPublish") { (options: PublishOptionsRecord) async throws in
            try await LivePublisher.shared.startPublish(options)
        }

        AsyncFunction("stopPublish") { () async in
            await LivePublisher.shared.stopPublish(reason: "user")
        }

        AsyncFunction("setVideoBitrate") { (kbps: Int) async in
            await LivePublisher.shared.setVideoBitrate(kbps)
        }

        AsyncFunction("setMaxVideoBitrate") { (kbps: Int) async in
            await LivePublisher.shared.setMaxVideoBitrate(kbps)
        }

        AsyncFunction("switchCamera") { () async throws -> String in
            try await LivePublisher.shared.switchCamera()
        }

        AsyncFunction("setTorch") { (enabled: Bool) async in
            await LivePublisher.shared.setTorch(enabled)
        }

        AsyncFunction("setMuted") { (muted: Bool) async throws in
            try await LivePublisher.shared.setMuted(muted)
        }

        AsyncFunction("setOrientation") { (orientation: String) async in
            await LivePublisher.shared.setOrientation(orientation)
        }

        AsyncFunction("getStats") { () async -> [String: Any]? in
            await LivePublisher.shared.currentStats()
        }

        AsyncFunction("getSpeechPermission") { () -> String in
            LivePublisher.speechPermissionStatus()
        }

        AsyncFunction("requestSpeechPermission") { () async -> String in
            await LivePublisher.requestSpeechPermission()
        }

        AsyncFunction("setVoiceListening") { (on: Bool, contextualStrings: [String]?) async in
            await LivePublisher.shared.setVoiceListening(on, contextualStrings: contextualStrings ?? [])
        }

        Function("haptic") { (kind: String) in
            LivePublisher.haptic(kind)
        }

        View(EarthscapeLivePreviewView.self) {
            Prop("videoGravity") { (view: EarthscapeLivePreviewView, gravity: String?) in
                view.setGravity(gravity)
            }
        }
    }
}
