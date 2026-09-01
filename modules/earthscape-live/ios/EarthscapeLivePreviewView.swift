import AVFoundation
import ExpoModulesCore
import HaishinKit

/// Camera preview: hosts HaishinKit's Metal-backed `MTHKView`, registered as a
/// mixer output so it shows the live camera whether or not we are publishing.
final class EarthscapeLivePreviewView: ExpoView {
    private let hkView = MTHKView(frame: .zero)

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        backgroundColor = .black
        hkView.videoGravity = .resizeAspectFill
        addSubview(hkView)
        Task { @MainActor in LivePublisher.shared.attachPreview(hkView) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        hkView.frame = bounds
    }

    override func willMove(toWindow newWindow: UIWindow?) {
        super.willMove(toWindow: newWindow)
        if newWindow == nil {
            Task { @MainActor in LivePublisher.shared.detachPreview(hkView) }
        } else {
            Task { @MainActor in LivePublisher.shared.attachPreview(hkView) }
        }
    }

    func setGravity(_ gravity: String?) {
        switch gravity {
        case "resize": hkView.videoGravity = .resize
        case "resizeAspect": hkView.videoGravity = .resizeAspect
        default: hkView.videoGravity = .resizeAspectFill
        }
    }
}
