import SwiftUI

#if os(iOS) || os(tvOS) || os(visionOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// ZeroChat current design tokens (mirrors src/app/app.css).
enum ZeroChatTheme {
    static let accentLight = Color(hex: 0x0A7CFF)
    static let accentDark = Color(hex: 0x3B93FF)
    static let accent = Color.dynamic(light: accentLight, dark: accentDark)

    static let accentHoverLight = Color(hex: 0x0069E0)
    static let accentHoverDark = Color(hex: 0x63AAFF)

    static let bubbleUserTextLight = Color.white
    static let bubbleUserTextDark = Color(hex: 0x0B1220)
    static let bubbleUserText = Color.dynamic(light: bubbleUserTextLight, dark: bubbleUserTextDark)

    static let bubbleAiLight = Color(hex: 0xFFFFFF)
    static let bubbleAiDark = Color(hex: 0x1C2029)
    static let bubbleAi = Color.dynamic(light: bubbleAiLight, dark: bubbleAiDark)

    static let dangerLight = Color(hex: 0xD93025)
    static let dangerDark = Color(hex: 0xF0665C)
    static let danger = Color.dynamic(light: dangerLight, dark: dangerDark)

    static let radiusSmall: CGFloat = 6
    static let radiusMedium: CGFloat = 10
    static let radiusLarge: CGFloat = 16
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        let red = Double((hex >> 16) & 0xFF) / 255
        let green = Double((hex >> 8) & 0xFF) / 255
        let blue = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: opacity)
    }

    /// Resolves a light/dark pair against the system appearance.
    static func dynamic(light: Color, dark: Color) -> Color {
        #if os(iOS) || os(tvOS) || os(visionOS)
        return Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
        #elseif os(macOS)
        return Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(isDark ? dark : light)
        })
        #else
        return light
        #endif
    }
}
