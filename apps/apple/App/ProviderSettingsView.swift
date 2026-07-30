import SwiftUI
import ZeroChatCore

struct ProviderSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n

    var body: some View {
        Section(i18n.t("setting.providers")) {
            Button {
                addProvider()
            } label: {
                Label(i18n.t("button.addProvider"), systemImage: "plus")
            }

            ForEach(sortedProviders) { provider in
                ProviderEditor(model: model, provider: provider, i18n: i18n)
            }
        }
    }

    private var sortedProviders: [ProviderConfig] {
        model.snapshot.providers.sorted { lhs, rhs in
            lhs.enabled == rhs.enabled
                ? providerDisplayName(lhs, i18n) < providerDisplayName(rhs, i18n)
                : lhs.enabled && !rhs.enabled
        }
    }

    private func addProvider() {
        var next = model.snapshot
        next.providers.insert(customProvider(named: i18n.t("provider.preset.custom-openai-relay")), at: 0)
        model.commit(next)
    }
}
