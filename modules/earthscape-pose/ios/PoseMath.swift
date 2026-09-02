import AVFoundation
import CoreMotion
import Foundation

/// Camera pose in the conventions the backend's `app/utils/phone_pose.py` expects:
/// heading clockwise from true north (deg), pitch positive = looking up (deg),
/// roll positive = the camera's right side dips (deg), already reduced to the
/// nearest device orientation so `landscape` says which way the frame is rotated.
struct CameraPose {
    let heading: Double
    let pitch: Double
    let roll: Double
    let landscape: Bool
}

struct CameraFieldOfView {
    /// Field of view across the sensor's long side (the width of a landscape buffer).
    let longSideDeg: Double
    /// Field of view across the sensor's short side.
    let shortSideDeg: Double
    let zoom: Double
}

private struct Vec3 {
    var x: Double
    var y: Double
    var z: Double

    static func - (a: Vec3, b: Vec3) -> Vec3 { Vec3(x: a.x - b.x, y: a.y - b.y, z: a.z - b.z) }
    static func * (a: Vec3, s: Double) -> Vec3 { Vec3(x: a.x * s, y: a.y * s, z: a.z * s) }
    static prefix func - (a: Vec3) -> Vec3 { Vec3(x: -a.x, y: -a.y, z: -a.z) }

    func dot(_ b: Vec3) -> Double { x * b.x + y * b.y + z * b.z }
    func cross(_ b: Vec3) -> Vec3 {
        Vec3(x: y * b.z - z * b.y, y: z * b.x - x * b.z, z: x * b.y - y * b.x)
    }
    var length: Double { (x * x + y * y + z * z).squareRoot() }
    var normalized: Vec3 { let l = length; return l > 0 ? self * (1 / l) : self }
}

enum PoseMath {
    /// Pose of the camera from a `.xTrueNorthZVertical` attitude.
    ///
    /// CoreMotion's rotation matrix maps device coordinates to the reference frame
    /// (x = true north, y = west, z = up), so its columns are the device axes expressed
    /// in that frame. The back camera looks along the device's -Z axis, the front camera
    /// along +Z; the top of the phone is +Y.
    static func pose(from m: CMRotationMatrix, frontCamera: Bool) -> CameraPose {
        let devY = Vec3(x: m.m12, y: m.m22, z: m.m32)
        let devZ = Vec3(x: m.m13, y: m.m23, z: m.m33)
        let forward = (frontCamera ? devZ : -devZ).normalized
        let zUp = Vec3(x: 0, y: 0, z: 1)

        // Horizontal direction the camera looks at. Near-vertical (pointing at the
        // ground or the sky) the forward vector has no usable azimuth, so use the
        // top of the phone instead: that is where the top of the image lands.
        var horizontal = Vec3(x: forward.x, y: forward.y, z: 0)
        var degenerate = false
        if horizontal.length < 0.05 {
            horizontal = Vec3(x: devY.x, y: devY.y, z: 0)
            degenerate = true
        }
        horizontal = horizontal.normalized
        // ref y points WEST, so east = -y
        var heading = atan2(-horizontal.y, horizontal.x) * 180 / .pi
        if heading < 0 { heading += 360 }
        if heading >= 360 { heading -= 360 }

        let pitch = asin(max(-1, min(1, forward.z))) * 180 / .pi

        // Level "up" and "right" for this forward direction, then the angle of the
        // phone's top (device +Y) away from level up = roll of the portrait frame.
        var up0 = (zUp - forward * zUp.dot(forward)).normalized
        if degenerate { up0 = horizontal }
        let right0 = forward.cross(up0).normalized
        let rollOfDeviceY = atan2(devY.dot(right0), devY.dot(up0)) * 180 / .pi

        // Snap to the nearest device orientation: the encoder rotates the frame with
        // the device, so only the residual counts as roll of the picture.
        let quadrant = Int((rollOfDeviceY / 90).rounded())
        var roll = rollOfDeviceY - Double(quadrant) * 90
        if roll > 180 { roll -= 360 }
        if roll < -180 { roll += 360 }
        let landscape = quadrant % 2 != 0
        return CameraPose(heading: heading, pitch: pitch, roll: roll, landscape: landscape)
    }

    /// The active format's field of view for the built-in wide camera at `position`,
    /// corrected for the current zoom factor. nil when the device or its FOV is unknown.
    static func fieldOfView(position: AVCaptureDevice.Position) -> CameraFieldOfView? {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            return nil
        }
        let format = device.activeFormat
        let fov = Double(format.videoFieldOfView)
        guard fov > 0, fov < 180 else { return nil }
        let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let w = Double(dims.width)
        let h = Double(dims.height)
        let aspect = (w > 0 && h > 0) ? min(w, h) / max(w, h) : 9.0 / 16.0
        let zoom = max(1.0, Double(device.videoZoomFactor))
        let tanLong = tan(fov * .pi / 360) / zoom
        let tanShort = tanLong * aspect
        return CameraFieldOfView(
            longSideDeg: 2 * atan(tanLong) * 180 / .pi,
            shortSideDeg: 2 * atan(tanShort) * 180 / .pi,
            zoom: zoom
        )
    }

    /// Horizontal/vertical FOV of the *published picture*: portrait frames put the
    /// sensor's short side across the image.
    static func imageFieldOfView(_ fov: CameraFieldOfView, landscape: Bool) -> (hfov: Double, vfov: Double) {
        landscape ? (fov.longSideDeg, fov.shortSideDeg) : (fov.shortSideDeg, fov.longSideDeg)
    }
}
