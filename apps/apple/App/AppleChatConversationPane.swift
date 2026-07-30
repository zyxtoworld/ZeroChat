import SwiftUI
import ZeroChatCore

struct AppleChatConversationPane: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    let activeConversation: Conversation?
    let activeConversationId: String?
    let setupSettingsTab: SettingsTab
    @Binding var settingsOpen: Bool
    @Binding var settingsInitialTab: SettingsTab
    @Binding var pickSourceImage: Bool
    @Binding var pickMaskImage: Bool
    @FocusState.Binding var composerFocused: Bool
    let createConversation: () -> Void
    let onConversationChange: (String?) -> Void
    let openSettings: (SettingsTab) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ChatHeader(
                model: model,
                activeConversationId: activeConversationId,
                onConversationChange: onConversationChange,
                openSettings: { openSettings(.appearance) }
            )

            if let notice = model.localSnapshotNotice {
                NoticeView(notice: notice)
                    .padding(.horizontal)
                    .padding(.bottom, 6)
            }

            if let notice = model.notice {
                NoticeView(notice: notice)
                    .padding(.horizontal)
                    .padding(.bottom, 6)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if activeConversation == nil || (activeConversation?.messages.isEmpty ?? true) {
                            let setupActionLabel = model.emptyStateSettingsActionLabel(
                                i18n,
                                conversationId: activeConversationId
                            )
                            ZeroChatEmptyState(
                                model.emptyStateTitle(i18n, conversationId: activeConversationId),
                                systemImage: "message",
                                description: model.emptyStateDescription(i18n, conversationId: activeConversationId),
                                actions: {
                                    if let setupActionLabel {
                                        Button {
                                            openSettings(setupSettingsTab)
                                        } label: {
                                            Label(
                                                setupActionLabel,
                                                systemImage: model.emptyStateSettingsActionSystemImage(
                                                    conversationId: activeConversationId
                                                )
                                            )
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .zeroChatFirstUseTip(
                                            title: setupActionLabel,
                                            message: model.emptyStateDescription(
                                                i18n,
                                                conversationId: activeConversationId
                                            ),
                                            systemImage: "key.fill"
                                        )
                                    }
                                }
                            )
                            .padding(.top, 80)
                        }

                        ForEach(activeConversation?.messages ?? []) { message in
                            MessageBubble(
                                message: message,
                                i18n: i18n,
                                isSpeaking: model.speakingMessageId == message.id,
                                speak: {
                                    model.speakMessage(message, conversationId: activeConversationId)
                                },
                                stopSpeaking: {
                                    model.stopSpeaking()
                                },
                                edit: {
                                    model.beginEdit(message)
                                    composerFocused = true
                                },
                                regenerate: { model.regenerate(from: message.id, conversationId: activeConversationId) },
                                delete: { model.deleteMessage(message.id, conversationId: activeConversationId) }
                            )
                            .id(message.id)
                        }
                    }
                    .padding()
                }
                .refreshable {
                    await model.pullToRefreshSync()
                }
                .onChange(of: activeConversation?.messages.count ?? 0) { _ in
                    if let id = activeConversation?.messages.last?.id {
                        proxy.scrollTo(id, anchor: .bottom)
                    }
                }
            }

            ComposerView(
                model: model,
                i18n: i18n,
                activeConversationId: activeConversationId,
                promptFocused: $composerFocused,
                pickSourceImage: { pickSourceImage = true },
                pickMaskImage: { pickMaskImage = true }
            )
        }
        .navigationTitle(activeConversation?.title ?? i18n.t("title.newChat"))
        .toolbar {
            ToolbarItemGroup {
                Button {
                    createConversation()
                } label: {
                    Image(systemName: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)
                .accessibilityLabel(i18n.t("title.newChat"))
                .accessibilityHint("Cmd+N")
                Button {
                    openSettings(.appearance)
                } label: {
                    Image(systemName: "gearshape")
                }
                .keyboardShortcut(",", modifiers: .command)
                .accessibilityLabel(i18n.t("action.openSettings"))
                .accessibilityHint("Cmd+,")
            }
        }
#if !os(macOS)
        .sheet(
            isPresented: $settingsOpen,
            onDismiss: {
                model.settingsNotice = nil
            }
        ) {
            SettingsView(model: model, initialTab: settingsInitialTab)
                .id(settingsInitialTab)
        }
#endif
        .fileImporter(isPresented: $pickSourceImage, allowedContentTypes: [.image]) { result in
            model.setImageUpload(result: result, target: .source)
        }
        .fileImporter(isPresented: $pickMaskImage, allowedContentTypes: [.image]) { result in
            model.setImageUpload(result: result, target: .mask)
        }
    }
}
