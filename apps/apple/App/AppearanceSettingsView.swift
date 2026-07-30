import SwiftUI
import ZeroChatCore

struct AppearanceSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n

    var body: some View {
        Section(i18n.t("setting.appearance")) {
            Picker(i18n.t("field.theme"), selection: bindingPreference(\.theme)) {
                Text(i18n.t("theme.system")).tag("system")
                Text(i18n.t("theme.light")).tag("light")
                Text(i18n.t("theme.dark")).tag("dark")
            }
            Picker(i18n.t("field.language"), selection: bindingPreference(\.language)) {
                ForEach(NativeI18n.languageModes, id: \.self) {
                    Text(i18n.languageLabel($0)).tag($0)
                }
            }
            Toggle(i18n.t("field.compactDisplay"), isOn: Binding(
                get: { model.snapshot.preferences.compactMode },
                set: { value in
                    var next = model.snapshot
                    next.preferences.compactMode = value
                    model.commit(next)
                }
            ))
        }
    }

    private func bindingPreference(_ keyPath: WritableKeyPath<Preferences, String>) -> Binding<String> {
        Binding(
            get: { model.snapshot.preferences[keyPath: keyPath] },
            set: { value in
                var next = model.snapshot
                next.preferences[keyPath: keyPath] = value
                model.commit(next)
            }
        )
    }
}
