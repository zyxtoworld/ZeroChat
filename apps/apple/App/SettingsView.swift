import SwiftUI
import ZeroChatCore

struct SettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var tab: SettingsTab
    private let usesNativeTabView: Bool
    private let showsDoneButton: Bool
    private let settingsTabColumns = [
        GridItem(.adaptive(minimum: 112, maximum: 180), spacing: 8, alignment: .top)
    ]

    private var i18n: NativeI18n {
        NativeI18n(mode: model.snapshot.preferences.language)
    }

    init(
        model: ZeroChatViewModel,
        initialTab: SettingsTab = .appearance,
        usesNativeTabView: Bool = false,
        showsDoneButton: Bool = true
    ) {
        self.model = model
        self.usesNativeTabView = usesNativeTabView
        self.showsDoneButton = showsDoneButton
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        NavigationStack {
            Group {
                if usesNativeTabView {
                    nativeTabSettings(i18n)
                } else {
                    compactGridSettings(i18n)
                }
            }
            .toolbar {
                if showsDoneButton {
                    ToolbarItem {
                        Button(i18n.t("action.done")) { dismiss() }
                    }
                }
            }
            .environment(\.layoutDirection, nativeLayoutDirection(for: i18n))
        }
    }

    private func selectSettingsTab(_ item: SettingsTab) {
        if tab != item {
            model.settingsNotice = nil
        }
        tab = item
    }

    @ViewBuilder
    private func compactGridSettings(_ i18n: NativeI18n) -> some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text(i18n.t("title.settings"))
                    .font(.largeTitle.weight(.semibold))
                Text(i18n.t("settings.changesSaved"))
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: settingsTabColumns, alignment: .leading, spacing: 8) {
                    ForEach(SettingsTab.allCases, id: \.self) { item in
                        Button {
                            selectSettingsTab(item)
                        } label: {
                            VStack(spacing: 4) {
                                Image(systemName: item.systemImage)
                                    .font(.caption.weight(.semibold))
                                Text(item.title(i18n))
                                    .font(.callout.weight(.semibold))
                                    .lineLimit(2)
                                    .minimumScaleFactor(0.82)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(
                                tab == item
                                    ? Color.accentColor.opacity(0.16)
                                    : Color.secondary.opacity(0.10),
                                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                            )
                            .overlay {
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(
                                        tab == item
                                            ? Color.accentColor.opacity(0.28)
                                            : Color.secondary.opacity(0.08),
                                        lineWidth: 1
                                    )
                            }
                            .foregroundStyle(tab == item ? Color.accentColor : Color.primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.title(i18n))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
            .background(.bar)

            settingsNoticeBanner
            settingsForm(for: tab)
        }
    }

    @ViewBuilder
    private func nativeTabSettings(_ i18n: NativeI18n) -> some View {
        VStack(spacing: 0) {
            settingsNoticeBanner
            TabView(
                selection: Binding(
                    get: { tab },
                    set: { selectSettingsTab($0) }
                )
            ) {
                ForEach(SettingsTab.allCases, id: \.self) { item in
                    settingsForm(for: item)
                        .tabItem {
                            Label(item.title(i18n), systemImage: item.systemImage)
                        }
                        .tag(item)
                }
            }
        }
        .navigationTitle(i18n.t("title.settings"))
    }

    @ViewBuilder
    private var settingsNoticeBanner: some View {
        if let notice = model.localSnapshotNotice {
            NoticeView(notice: notice)
                .padding(.horizontal)
                .padding(.vertical, 8)
        }
        if let notice = model.settingsNotice {
            NoticeView(notice: notice)
                .padding(.horizontal)
                .padding(.vertical, 8)
        }
    }

    private func settingsForm(for item: SettingsTab) -> some View {
        Form {
            switch item {
            case .appearance:
                appearance
            case .providers:
                providers
            case .models:
                models
            case .skills:
                skills
            case .sync:
                sync
            case .data:
                data
            }
        }
        .id(item)
    }

    private var appearance: some View {
        AppearanceSettingsView(model: model, i18n: i18n)
    }

    private var providers: some View {
        ProviderSettingsView(model: model, i18n: i18n)
    }

    private var models: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        return ModelSettingsView(model: model, i18n: i18n)
    }

    private var sync: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        return SyncSettingsView(model: model, i18n: i18n)
    }

    private var skills: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        return SkillSettingsView(model: model, i18n: i18n)
    }

    private var data: some View {
        let i18n = NativeI18n(mode: model.snapshot.preferences.language)

        return DataSettingsView(model: model, i18n: i18n)
    }

}
