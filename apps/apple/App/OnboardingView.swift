import SwiftUI

#if canImport(TipKit)
import TipKit
#endif

struct ZeroChatEmptyState<Actions: View>: View {
    let title: String
    let systemImage: String
    let description: String
    let actions: Actions

    init(
        _ title: String,
        systemImage: String,
        description: String,
        @ViewBuilder actions: () -> Actions
    ) {
        self.title = title
        self.systemImage = systemImage
        self.description = description
        self.actions = actions()
    }

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.semibold))
                .multilineTextAlignment(.center)
            Text(description)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            actions
        }
        .frame(maxWidth: .infinity)
    }
}

#if canImport(TipKit)
@available(iOS 17.0, macOS 14.0, *)
private struct AppleFirstUseTip: Tip {
    let titleText: String
    let messageText: String
    let systemImage: String

    var title: Text {
        Text(titleText)
    }

    var message: Text? {
        Text(messageText)
    }

    var image: Image? {
        Image(systemName: systemImage)
    }
}
#endif

extension View {
    @ViewBuilder
    func zeroChatFirstUseTip(
        title: String,
        message: String,
        systemImage: String,
        arrowEdge: Edge = .top
    ) -> some View {
#if canImport(TipKit)
        if #available(iOS 17.0, macOS 14.0, *) {
            self.popoverTip(
                AppleFirstUseTip(titleText: title, messageText: message, systemImage: systemImage),
                arrowEdge: arrowEdge
            )
        } else {
            self
        }
#else
        self
#endif
    }
}
