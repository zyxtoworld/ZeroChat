import SwiftUI
import ZeroChatCore

struct ChatHeader: View {
    @ObservedObject var model: ZeroChatViewModel
    let activeConversationId: String?
    let onConversationChange: (String?) -> Void
    let openSettings: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            ProviderModelMenu(
                model: model,
                activeConversationId: activeConversationId,
                onConversationChange: onConversationChange
            )
            Button(action: openSettings) {
                Image(systemName: "slider.horizontal.3")
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .background(.bar)
    }
}

private struct ProviderModelMenu: View {
    @ObservedObject var model: ZeroChatViewModel
    let activeConversationId: String?
    let onConversationChange: (String?) -> Void

    var body: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        Menu {
            ForEach(model.enabledProviders) { provider in
                Section(providerDisplayName(provider, i18n)) {
                    let models = model.composerMode == .image
                        ? model.imageModelOptions(provider)
                        : model.chatModelOptions(provider)
                    if models.isEmpty {
                        Text(
                            model.composerMode == .image
                                ? i18n.t("message.imageModelRequired")
                                : i18n.t("message.noModels")
                        )
                    } else {
                        ForEach(models, id: \.self) { item in
                            Button(item) {
                                if model.composerMode == .image {
                                    onConversationChange(
                                        model.selectImageModel(
                                            provider: provider,
                                            imageModel: item,
                                            conversationId: activeConversationId
                                        )
                                    )
                                } else {
                                    onConversationChange(
                                        model.select(
                                            provider: provider,
                                            model: item,
                                            conversationId: activeConversationId
                                        )
                                    )
                                }
                            }
                        }
                    }
                }
            }
        } label: {
            HStack {
                Text(model.activeProviderModelTitle(i18n, conversationId: activeConversationId))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.bordered)
        .disabled(model.enabledProviders.isEmpty)
    }
}
