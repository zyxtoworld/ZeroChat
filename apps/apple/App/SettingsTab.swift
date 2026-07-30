enum SettingsTab: CaseIterable, Hashable {
    case appearance
    case providers
    case models
    case skills
    case sync
    case data

    func title(_ i18n: NativeI18n) -> String {
        switch self {
        case .appearance: i18n.t("setting.appearance")
        case .providers: i18n.t("setting.providers")
        case .models: i18n.t("setting.models")
        case .skills: i18n.t("setting.skills")
        case .sync: i18n.t("setting.sync")
        case .data: i18n.t("setting.data")
        }
    }

    var systemImage: String {
        switch self {
        case .appearance: "gearshape"
        case .providers: "server.rack"
        case .models: "plus.square.on.square"
        case .skills: "book"
        case .sync: "cloud"
        case .data: "externaldrive"
        }
    }
}
