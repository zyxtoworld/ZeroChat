import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    static func defaultSnapshot() -> AppSnapshot {
        let preferences = Preferences(firstRunDone: true)
        let i18n = NativeI18n(mode: preferences.language)

        return AppSnapshot(
            providers: defaultProviders(customOpenAiRelayName: i18n.t("provider.preset.custom-openai-relay")),
            conversations: [],
            skills: [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(),
            preferences: preferences,
            updatedAt: nowMillis()
        )
    }
}
