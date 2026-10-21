import SwiftUI
import ZeroChatCore

@MainActor
struct AppleConversationSidebar: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    let visibleConversations: [Conversation]
    let activeConversationId: String?
    let conversationSearchActive: Bool
    @Binding var conversationSearch: String
    @Binding var conversationSearchPresented: Bool
    let selectConversation: (String?) -> Void
    let createConversation: () -> Void
    let deleteConversation: (Conversation) -> Void
    let openSyncSettings: () -> Void

    @ViewBuilder
    private func applySearchable<Content: View>(to content: Content) -> some View {
        if #available(iOS 17.0, macOS 14.0, *) {
            content.searchable(
                text: $conversationSearch,
                isPresented: $conversationSearchPresented,
                prompt: i18n.t("conversation.searchPlaceholder")
            )
        } else {
            content.searchable(
                text: $conversationSearch,
                prompt: i18n.t("conversation.searchPlaceholder")
            )
        }
    }

    var body: some View {
        let selection = Binding<String?>(
            get: { activeConversationId },
            set: { value in selectConversation(value) }
        )

        return applySearchable(
            to: VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("ZeroChat")
                        .font(.title2.weight(.semibold))
                    Button {
                        createConversation()
                    } label: {
                        Label(i18n.t("title.newChat"), systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()

                AppleCloudSyncStatusStrip(
                    model: model,
                    i18n: i18n,
                    openSyncSettings: openSyncSettings
                )
                .padding(.horizontal)
                .padding(.bottom, 8)

                if visibleConversations.isEmpty && conversationSearchActive {
                    ZeroChatEmptyState(
                        i18n.t("conversation.searchNoResultsTitle"),
                        systemImage: "magnifyingglass",
                        description: i18n.t("conversation.searchNoResultsBody"),
                        actions: { EmptyView() }
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding()
                } else {
                    List(selection: selection) {
                        ForEach(visibleConversations) { conversation in
                            HStack {
                                Text(displayConversationTitle(conversation, i18n))
                                    .lineLimit(1)
                                Spacer()
                                Button(role: .destructive) {
                                    deleteConversation(conversation)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.borderless)
                            }
                            .tag(conversation.id as String?)
                        }
                    }
                    .refreshable {
                        await model.pullToRefreshSync()
                    }
                }
            }
            .navigationTitle(i18n.t("title.newChat"))
        )
    }
}
