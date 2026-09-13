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

@Test func appleDetachedWindowCannotBeResurrectedByQueuedAttachment() throws {
    let reporter = try appleOwnershipSource("App/AppleWindowActivationReporter.swift")
    let attach = try appleOwnershipFunctionBody(
        "func attach(to view: NSView)",
        in: reporter
    )

    #expect(reporter.contains("private var attachmentGeneration: UInt64 = 0"))
    #expect(attach.contains("attachmentGeneration &+= 1"))
    #expect(attach.contains("let generation = attachmentGeneration"))
    #expect(attach.contains("self.attachmentGeneration == generation"))
    #expect(attach.contains("[weak self, weak view]"))

    let generation = try #require(attach.range(of: "attachmentGeneration &+= 1"))
    let dispatch = try #require(attach.range(of: "DispatchQueue.main.async"))
    let ownerGuard = try #require(attach.range(of: "self.attachmentGeneration == generation"))
    let register = try #require(attach.range(of: "commandCenter?.registerWindow"))

    #expect(generation.lowerBound < dispatch.lowerBound)
    #expect(ownerGuard.lowerBound < register.lowerBound)
}

@Test func appleMessageEditReturnsFocusToTheWindowLocalComposer() throws {
    let pane = try appleOwnershipSource("App/AppleChatConversationPane.swift")
    let edit = try #require(pane.range(of: "edit: {"))
    let tail = String(pane[edit.lowerBound...].prefix(220))

    #expect(tail.contains("model.beginEdit(message)"))
    #expect(tail.contains("composerFocused = true"))
}

@Test func appleGenerationCleanupUsesOneCurrentOwnerTokenForChatAndImage() throws {
    let source = try appleOwnershipSource("App/AppleChatViewModel.swift")

    #expect(source.contains("private enum GenerationKind"))
    #expect(source.contains("case chat"))
    #expect(source.contains("case image"))
    #expect(source.contains("private func finishGenerationIfCurrent(generationToken: Int, kind: GenerationKind)"))
    #expect(source.contains("guard generationIsCurrent(generationToken) else { return }"))
    #expect(source.contains("finishGenerationIfCurrent(generationToken: generationToken, kind: .chat)"))
    #expect(source.contains("finishGenerationIfCurrent(generationToken: generationToken, kind: .image)"))
}

@Test func appleGenerationResultsRejectCancellationLateCallbacksAndSwitchedOwners() throws {
    let source = try appleOwnershipSource("App/AppleChatViewModel.swift")

    #expect(source.contains("private func beginGeneration() -> Int"))
    #expect(source.contains("private func invalidateGeneration()"))
    #expect(source.contains("private func generationIsCurrent(_ generationToken: Int) -> Bool"))
    #expect(source.contains("private func completeAssistantIfCurrent("))
    #expect(source.contains("generationSerial &+= 1"))

    let stop = try appleOwnershipFunctionBody("func stopGenerating()", in: source)
    #expect(stop.contains("invalidateGeneration()"))

    let invalidate = try appleOwnershipFunctionBody(
        "private func invalidateGeneration()",
        in: source
    )
    #expect(invalidate.contains("activeGeneration"))
    #expect(invalidate.contains("appleStoppedAssistantMessage("))
    #expect(invalidate.contains("appleStoppedImageMessage("))
    #expect(invalidate.components(separatedBy: "completeAssistantIfCurrent(").count - 1 == 2)
    let terminalize = try #require(invalidate.range(of: "completeAssistantIfCurrent("))
    let invalidateToken = try #require(invalidate.range(of: "generationSerial &+= 1"))
    #expect(terminalize.lowerBound < invalidateToken.lowerBound)
    #expect(invalidate.contains("activeGeneration = nil"))
    #expect(invalidate.contains("chatStreamingTask = nil"))
    #expect(invalidate.contains("imageGenerationTask = nil"))

    let chat = try appleOwnershipFunctionBody(
        "private func sendChat(in conversation: Conversation)",
        in: source
    )
    let image = try appleOwnershipFunctionBody(
        "private func sendImagePrompt(in conversation: Conversation)",
        in: source
    )
    let streaming = try appleOwnershipFunctionBody(
        "private func updateStreamingAssistant(",
        in: source
    )
    let completion = try appleOwnershipFunctionBody(
        "private func completeAssistantIfCurrent(",
        in: source
    )

    #expect(chat.contains("let generationToken = beginGeneration()"))
    #expect(image.contains("let generationToken = beginGeneration()"))
    #expect(chat.contains("generationToken: generationToken"))
    #expect(chat.components(separatedBy: "completeAssistantIfCurrent(").count - 1 == 3)
    #expect(image.components(separatedBy: "completeAssistantIfCurrent(").count - 1 == 3)
    #expect(chat.contains("guard generationIsCurrent(generationToken) else { return }"))
    #expect(image.contains("guard generationIsCurrent(generationToken) else { return }"))
    #expect(streaming.contains("generationToken: Int"))
    #expect(streaming.contains("guard generationIsCurrent(generationToken) else { return }"))
    #expect(completion.contains("guard generationIsCurrent(generationToken) else { return }"))
    let imageCancellationCheck = try #require(image.range(of: "try Task.checkCancellation()"))
    let imageOwnerCheck = try #require(image.range(of: "guard generationIsCurrent(generationToken) else { return }"))
    #expect(imageCancellationCheck.lowerBound < imageOwnerCheck.lowerBound)
}

@Test func appleMacSidebarUsesTheWindowLocalSelectionBindingSetter() throws {
    let sidebar = try appleOwnershipSource("App/AppleConversationSidebar.swift")
    let chat = try appleOwnershipSource("App/ChatView.swift")

    #expect(sidebar.contains("let selection = Binding<String?>("))
    #expect(sidebar.contains("get: { activeConversationId }"))
    #expect(sidebar.contains("set: { value in selectConversation(value) }"))
    #expect(sidebar.contains("List(selection: selection)"))
    #expect(chat.contains("selectConversation: { windowActiveConversationId = $0 }"))
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
