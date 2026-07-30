import Foundation
import Testing

@Test func appleProviderModelFetchesRejectCancelledAndStaleOwners() throws {
    let editor = try appleOwnershipSource("App/ProviderEditor.swift")
    let models = try appleOwnershipSource("App/ModelSettingsView.swift")
    let ownership = try appleOwnershipSource("App/AppleProviderRequestState.swift")

    for source in [editor, models] {
        #expect(source.contains("Task<Void, Never>?"))
        #expect(source.contains("RequestId"))
        #expect(source.contains("Task.checkCancellation()"))
        #expect(source.contains("catch is CancellationError"))
        #expect(source.contains("appleProviderModelRequestStillCurrent("))
        #expect(source.contains("proxyToken"))
        #expect(source.contains("apiKey"))
        #expect(source.contains(".onDisappear"))
    }

    let matcher = try appleOwnershipFunctionBody(
        "func appleProviderModelRequestStillCurrent(",
        in: ownership
    )
    for field in [
        ".id", ".kind", ".baseUrl", ".proxyUrl", ".clientRequestMode",
        ".needsApiKey", ".enabled",
    ] {
        #expect(matcher.contains(field))
    }
}

@Test func appleClosedWindowsCannotRemainCommandTargets() throws {
    let app = try appleOwnershipSource("App/ZeroChatApp.swift")
    let reporter = try appleOwnershipSource("App/AppleWindowActivationReporter.swift")

    #expect(app.contains("private var liveWindowIds = Set<UUID>()"))
    #expect(app.contains("func unregisterWindow(_ id: UUID)"))
    #expect(app.contains("liveWindowIds.contains(activeWindowId)"))
    #expect(app.components(separatedBy: "commandCenter.commandTargetWindowId").count - 1 == 2)
    #expect(reporter.contains("NSWindow.willCloseNotification"))
    #expect(reporter.contains("static func dismantleNSView"))
    #expect(reporter.contains("unregisterCurrentWindow()"))
    #expect(reporter.contains("commandCenter?.unregisterWindow(registeredWindowId)"))
}

@Test func appleMessageEditReturnsFocusToTheWindowLocalComposer() throws {
    let pane = try appleOwnershipSource("App/AppleChatConversationPane.swift")
    let edit = try #require(pane.range(of: "edit: {"))
    let tail = String(pane[edit.lowerBound...].prefix(220))

    #expect(tail.contains("model.beginEdit(message)"))
    #expect(tail.contains("composerFocused = true"))
}

private enum AppleOwnershipContractError: Error {
    case markerMissing(String)
    case malformedFunction(String)
}

private func appleOwnershipSource(_ relativePath: String) throws -> String {
    let repositoryRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let sourceURL = relativePath.split(separator: "/").reduce(
        repositoryRoot.appendingPathComponent("apps").appendingPathComponent("apple")
    ) { url, component in
        url.appendingPathComponent(String(component))
    }
    return try String(contentsOf: sourceURL, encoding: .utf8)
}

private func appleOwnershipFunctionBody(_ marker: String, in source: String) throws -> String {
    guard let markerRange = source.range(of: marker) else {
        throw AppleOwnershipContractError.markerMissing(marker)
    }
    guard let openingBrace = source[markerRange.lowerBound...].firstIndex(of: "{") else {
        throw AppleOwnershipContractError.malformedFunction(marker)
    }

    var depth = 0
    var cursor = openingBrace
    while cursor < source.endIndex {
        switch source[cursor] {
        case "{": depth += 1
        case "}":
            depth -= 1
            if depth == 0 { return String(source[openingBrace...cursor]) }
        default: break
        }
        cursor = source.index(after: cursor)
    }
    throw AppleOwnershipContractError.malformedFunction(marker)
}
