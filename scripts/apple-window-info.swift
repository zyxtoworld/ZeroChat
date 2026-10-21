import CoreGraphics
import Darwin
import Foundation

private struct WindowCandidate {
    let id: CGWindowID
    let title: String
    let area: Double
}

private func number(
    _ window: [String: Any],
    key: CFString
) -> NSNumber? {
    window[key as String] as? NSNumber
}

private func area(of window: [String: Any]) -> Double {
    guard
        let bounds = window[kCGWindowBounds as String] as? NSDictionary,
        let width = bounds["Width"] as? NSNumber,
        let height = bounds["Height"] as? NSNumber
    else {
        return 0
    }

    return width.doubleValue * height.doubleValue
}

guard
    CommandLine.arguments.count == 2,
    let targetPID = Int32(CommandLine.arguments[1]),
    targetPID > 0
else {
    fputs("Usage: apple-window-info <pid>\n", stderr)
    exit(64)
}

let options: CGWindowListOption = [
    .optionOnScreenOnly,
    .excludeDesktopElements,
]

guard
    let windows = CGWindowListCopyWindowInfo(
        options,
        kCGNullWindowID
    ) as? [[String: Any]]
else {
    fputs("CoreGraphics window information is unavailable.\n", stderr)
    exit(69)
}

private var best: WindowCandidate?

for window in windows {
    guard
        let ownerPID = number(window, key: kCGWindowOwnerPID),
        ownerPID.int32Value == targetPID,
        let windowNumber = number(window, key: kCGWindowNumber),
        windowNumber.uint32Value > 0,
        let layer = number(window, key: kCGWindowLayer),
        layer.intValue == 0,
        let alpha = number(window, key: kCGWindowAlpha),
        alpha.doubleValue > 0
    else {
        continue
    }

    let windowArea = area(of: window)
    guard windowArea > 0 else {
        continue
    }

    let title = (window[kCGWindowName as String] as? String ?? "")
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
    let candidate = WindowCandidate(
        id: windowNumber.uint32Value,
        title: title,
        area: windowArea
    )

    if let current = best {
        if candidate.area > current.area {
            best = candidate
        }
    } else {
        best = candidate
    }
}

guard let window = best else {
    exit(1)
}

print(window.id)
print(window.title)
