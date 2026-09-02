import AVFoundation
import CoreMotion
import ExpoModulesCore

struct PoseStartOptions: Record {
    @Field var camera: String?
    @Field var intervalMs: Int?
}

/// Expo module: streams the camera's pose (true-north heading, pitch, roll) plus the
/// active camera's field of view as `onPose` events. Pure sensor reading — the
/// publisher (modules/earthscape-live) is untouched and the two never share state.
public class EarthscapePoseModule: Module {
    private let motion = CMMotionManager()
    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.name = "com.earthscape.pose"
        q.maxConcurrentOperationCount = 1
        return q
    }()
    private let lock = NSLock()
    private var cameraPosition: AVCaptureDevice.Position = .back
    private var intervalSec: TimeInterval = 0.25
    private var lastEmit: TimeInterval = 0

    public func definition() -> ModuleDefinition {
        Name("EarthscapePose")

        Constants {
            [
                "isSupported": self.motion.isDeviceMotionAvailable,
            ]
        }

        Events("onPose")

        OnDestroy {
            self.stopUpdates()
        }

        Function("setCamera") { (position: String) in
            self.lock.lock()
            self.cameraPosition = position == "front" ? .front : .back
            self.lock.unlock()
        }

        Function("getFieldOfView") { (position: String?) -> [String: Double]? in
            let pos: AVCaptureDevice.Position = position == "front" ? .front : .back
            guard let fov = PoseMath.fieldOfView(position: pos) else { return nil }
            return ["longSideDeg": fov.longSideDeg, "shortSideDeg": fov.shortSideDeg, "zoom": fov.zoom]
        }

        AsyncFunction("start") { (options: PoseStartOptions) in
            guard self.motion.isDeviceMotionAvailable else {
                throw Exception(name: "ERR_POSE_UNAVAILABLE", description: "Device motion is not available on this device")
            }
            self.lock.lock()
            if let camera = options.camera { self.cameraPosition = camera == "front" ? .front : .back }
            self.intervalSec = Double(max(100, min(2000, options.intervalMs ?? 250))) / 1000
            self.lastEmit = 0
            self.lock.unlock()
            self.startUpdates()
        }

        AsyncFunction("stop") {
            self.stopUpdates()
        }
    }

    private func startUpdates() {
        if motion.isDeviceMotionActive { return }
        // 10 Hz is plenty: fixes go out at 1 Hz and the JS side only keeps the latest.
        motion.deviceMotionUpdateInterval = 0.1
        motion.showsDeviceMovementDisplay = true
        motion.startDeviceMotionUpdates(using: .xTrueNorthZVertical, to: queue) { [weak self] data, error in
            guard let self = self else { return }
            if let error = error {
                self.sendEvent("onPose", ["error": error.localizedDescription, "timestamp": Date().timeIntervalSince1970 * 1000])
                return
            }
            guard let data = data else { return }
            let now = Date().timeIntervalSince1970
            self.lock.lock()
            let interval = self.intervalSec
            let last = self.lastEmit
            let position = self.cameraPosition
            self.lock.unlock()
            if now - last < interval { return }
            self.lock.lock()
            self.lastEmit = now
            self.lock.unlock()

            let pose = PoseMath.pose(from: data.attitude.rotationMatrix, frontCamera: position == .front)
            var body: [String: Any] = [
                "heading": pose.heading,
                "pitch": pose.pitch,
                "roll": pose.roll,
                "landscape": pose.landscape,
                "camera": position == .front ? "front" : "back",
                // -1 uncalibrated, 0 low, 1 medium, 2 high (CMMagneticFieldCalibrationAccuracy)
                "magneticAccuracy": Int(data.magneticField.accuracy.rawValue),
                "timestamp": now * 1000,
            ]
            if let fov = PoseMath.fieldOfView(position: position) {
                let image = PoseMath.imageFieldOfView(fov, landscape: pose.landscape)
                body["hfov"] = image.hfov
                body["vfov"] = image.vfov
                body["zoom"] = fov.zoom
            }
            self.sendEvent("onPose", body)
        }
    }

    private func stopUpdates() {
        if motion.isDeviceMotionActive {
            motion.stopDeviceMotionUpdates()
        }
    }
}
