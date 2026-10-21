import SwiftUI
import Foundation
import ZeroChatCore

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

struct ChatView: View {
    @ObservedObject var model: ZeroChatViewModel
    let openSettingsWindow: ((SettingsTab) -> Void)?
    @Environment(\.scenePhase) private var scenePhase
#if os(macOS)
    @ObservedObject var commandCenter: AppleCommandCenter
    @State private var windowId = UUID()
    @State private var handledConversationSelectionRequest = 0
    @State private var handledComposerFocusRequest = 0
    @State private var handledConversationSearchFocusRequest = 0
#endif
    @State private var settingsOpen = false
    @State private var settingsInitialTab = SettingsTab.appearance
    @State private var pickSourceImage = false
    @State private var pickMaskImage = false
    @State private var conversationSearch = ""
    @State private var conversationSearchPresented = false
    @State private var windowActiveConversationId: String?
    @FocusState private var composerFocused: Bool

#if os(macOS)
    init(
        model: ZeroChatViewModel,
        openSettingsWindow: ((SettingsTab) -> Void)? = nil,
        commandCenter: AppleCommandCenter
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.openSettingsWindow = openSettingsWindow
        _commandCenter = ObservedObject(wrappedValue: commandCenter)
    }
#else
    init(
        model: ZeroChatViewModel,
        openSettingsWindow: ((SettingsTab) -> Void)? = nil
    ) {
        _model = ObservedObject(wrappedValue: model)
        self.openSettingsWindow = openSettingsWindow
    }
#endif

    private var activeConversationId: String? {
        if let windowActiveConversationId,
           model.snapshot.conversations.contains(where: { $0.id == windowActiveConversationId }) {
            return windowActiveConversationId
        }

        return model.defaultActiveConversationId
    }

    private var activeConversation: Conversation? {
        model.conversation(id: activeConversationId)
    }

    private var setupSettingsTab: SettingsTab {
        guard let provider = model.activeProvider(conversationId: activeConversationId) else {
            return .providers
        }
        if model.providerKeyMissing(provider) {
            return .providers
        }
        if model.composerMode == .image {
            if provider.kind == .anthropic {
                return .providers
            }
            return model.imageModelForProvider(provider).isEmpty ? .models : .providers
        }

        let modelName = chatModelForConversation(activeConversation, provider: provider)
        return modelName.isEmpty ? .models : .providers
    }

    private func openSettings(_ tab: SettingsTab = .appearance) {
#if os(macOS)
        if let openSettingsWindow {
            model.settingsNotice = nil
            openSettingsWindow(tab)
            return
        }
#endif
        model.settingsNotice = nil
        settingsInitialTab = tab
        settingsOpen = true
    }

    private func createConversationAndFocusComposer() {
        if let id = model.createConversation() {
            windowActiveConversationId = id
        }
        DispatchQueue.main.async {
            composerFocused = true
        }
    }

    private func ensureWindowConversationSelection() {
        guard let windowActiveConversationId else {
            self.windowActiveConversationId = model.defaultActiveConversationId
            return
        }

        if !model.snapshot.conversations.contains(where: { $0.id == windowActiveConversationId }) {
            self.windowActiveConversationId = model.defaultActiveConversationId
        }
    }

    private func focusComposerIfSharedTextArrived() {
        if model.consumePendingSharedText() {
            composerFocused = true
        }
    }

    private var conversationSearchActive: Bool {
        !conversationSearch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func filteredConversations(_ i18n: NativeI18n) -> [Conversation] {
        let query = normalizeConversationSearchValue(
            conversationSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        guard !query.isEmpty else {
            return model.snapshot.conversations
        }

        return model.snapshot.conversations.filter { conversation in
            conversationMatchesSearch(conversation, normalizedQuery: query, i18n: i18n)
        }
    }

    private func focusConversationSearch() {
        DispatchQueue.main.async {
            conversationSearchPresented = true
        }
    }

#if os(macOS)
    private func commandTargetsThisWindow(_ target: UUID?) -> Bool {
        target == nil || target == windowId
    }

    private func handleConversationSelectionCommand() {
        guard handledConversationSelectionRequest != commandCenter.conversationSelectionRequest else {
            return
        }
        handledConversationSelectionRequest = commandCenter.conversationSelectionRequest
        guard commandTargetsThisWindow(commandCenter.conversationSelectionTargetWindowId) else {
            return
        }
        windowActiveConversationId = commandCenter.requestedConversationId
        ensureWindowConversationSelection()
    }

    private func handleComposerFocusCommand() {
        guard handledComposerFocusRequest != commandCenter.composerFocusRequest else {
            return
        }
        handledComposerFocusRequest = commandCenter.composerFocusRequest
        guard commandTargetsThisWindow(commandCenter.composerFocusTargetWindowId) else {
            return
        }
        DispatchQueue.main.async {
            composerFocused = true
        }
    }

    private func handleConversationSearchFocusCommand() {
        guard handledConversationSearchFocusRequest != commandCenter.conversationSearchFocusRequest else {
            return
        }
        handledConversationSearchFocusRequest = commandCenter.conversationSearchFocusRequest
        guard commandTargetsThisWindow(commandCenter.conversationSearchFocusTargetWindowId) else {
            return
        }
        focusConversationSearch()
    }

    private func chatTouchBar(_ i18n: NativeI18n) -> some View {
        HStack {
            Button {
                if model.isChatStreaming {
                    model.stopGenerating()
                } else {
                    _ = model.sendCurrentInput(conversationId: activeConversationId)
                }
            } label: {
                Label(
                    model.isChatStreaming ? i18n.t("action.stopGenerating") : i18n.t("action.send"),
                    systemImage: model.isChatStreaming ? "stop.fill" : "paperplane.fill"
                )
            }
            .disabled(!model.isChatStreaming && !model.canSubmitCurrentInput(conversationId: activeConversationId))
        }
    }
#endif

    private var focusConversationSearchShortcut: some View {
        Button {
            focusConversationSearch()
        } label: {
            EmptyView()
        }
        .keyboardShortcut("k", modifiers: .command)
        .accessibilityHidden(true)
    }

#if os(macOS)
    private var closeWindowShortcut: some View {
        Button {
            NSApp.keyWindow?.performClose(nil)
        } label: {
            EmptyView()
        }
        .keyboardShortcut("w", modifiers: .command)
        .accessibilityHidden(true)
    }
#endif

    private var stopGeneratingShortcut: some View {
        Button {
            model.stopGenerating()
        } label: {
            EmptyView()
        }
        .keyboardShortcut(".", modifiers: .command)
        .disabled(!model.isChatStreaming)
        .accessibilityHidden(true)
    }

    var body: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)
        let visibleConversations = filteredConversations(i18n)

        NavigationSplitView {
            AppleConversationSidebar(
                model: model,
                i18n: i18n,
                visibleConversations: visibleConversations,
                activeConversationId: activeConversationId,
                conversationSearchActive: conversationSearchActive,
                conversationSearch: $conversationSearch,
                conversationSearchPresented: $conversationSearchPresented,
                selectConversation: { windowActiveConversationId = $0 },
                createConversation: createConversationAndFocusComposer,
                deleteConversation: { conversation in
                    let nextId = model.deleteConversation(conversation.id)
                    if windowActiveConversationId == conversation.id {
                        windowActiveConversationId = nextId
                    }
                },
                openSyncSettings: { openSettings(.sync) }
            )
        } detail: {
            AppleChatConversationPane(
                model: model,
                i18n: i18n,
                activeConversation: activeConversation,
                activeConversationId: activeConversationId,
                setupSettingsTab: setupSettingsTab,
                settingsOpen: $settingsOpen,
                settingsInitialTab: $settingsInitialTab,
                pickSourceImage: $pickSourceImage,
                pickMaskImage: $pickMaskImage,
                composerFocused: $composerFocused,
                createConversation: createConversationAndFocusComposer,
                onConversationChange: { windowActiveConversationId = $0 },
                openSettings: openSettings
            )
        }
        .background(stopGeneratingShortcut.frame(width: 0, height: 0))
        .background(focusConversationSearchShortcut.frame(width: 0, height: 0))
        .onAppear {
            ensureWindowConversationSelection()
            focusComposerIfSharedTextArrived()
        }
        .task(id: model.snapshot.conversations.map(\.id)) {
            ensureWindowConversationSelection()
        }
        .task(id: scenePhase) {
            if scenePhase == .active {
                focusComposerIfSharedTextArrived()
            }
        }
        .onOpenURL { url in
            if AppleQuickAskRoute.isQuickAskOpenURL(url) {
                createConversationAndFocusComposer()
                return
            }

            if model.consumePendingSharedText(openedBy: url) {
                composerFocused = true
            }
        }
        .userActivity(
            AppleHandoffActivity.activityType,
            isActive: activeConversation != nil
        ) { activity in
            AppleHandoffActivity.update(activity, conversation: activeConversation, i18n: i18n)
        }
        .onContinueUserActivity(AppleHandoffActivity.activityType) { activity in
            guard let conversationId = AppleHandoffActivity.conversationId(from: activity),
                  model.conversation(id: conversationId) != nil else {
                return
            }

            windowActiveConversationId = conversationId
            composerFocused = true
        }
#if os(macOS)
        .background(WindowActivationReporter(windowId: windowId, commandCenter: commandCenter).frame(width: 0, height: 0))
        .background(closeWindowShortcut.frame(width: 0, height: 0))
        .frame(minWidth: 900, minHeight: 600)
        .touchBar {
            chatTouchBar(i18n)
        }
        .onAppear {
            handleConversationSelectionCommand()
            handleComposerFocusCommand()
            handleConversationSearchFocusCommand()
        }
        .onChange(of: commandCenter.conversationSelectionRequest) {
            handleConversationSelectionCommand()
        }
        .onChange(of: commandCenter.composerFocusRequest) {
            handleComposerFocusCommand()
        }
        .onChange(of: commandCenter.conversationSearchFocusRequest) {
            handleConversationSearchFocusCommand()
        }
#endif
        .preferredColorScheme(applePreferredColorScheme(for: model.snapshot.preferences.theme))
        .environment(\.layoutDirection, nativeLayoutDirection(for: i18n))
    }
}
