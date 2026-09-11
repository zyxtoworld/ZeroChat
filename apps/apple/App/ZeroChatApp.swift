import SwiftUI
import ZeroChatCore

#if canImport(TipKit)
import TipKit

private enum AppleTipKitRuntime {
    static func configureIfAvailable() {
        if #available(iOS 17.0, macOS 14.0, *) {
            try? Tips.configure()
        }
    }
}
#endif

#if os(macOS)
import AppKit

@MainActor
final class AppleCommandCenter: ObservableObject {
    @Published var activeWindowId: UUID?
    @Published var conversationSelectionRequest = 0
    @Published var conversationSelectionTargetWindowId: UUID?
    @Published var requestedConversationId: String?
    @Published var composerFocusRequest = 0
    @Published var composerFocusTargetWindowId: UUID?
    @Published var conversationSearchFocusRequest = 0
    @Published var conversationSearchFocusTargetWindowId: UUID?
    private var liveWindowIds = Set<UUID>()

    var commandTargetWindowId: UUID? {
        guard let activeWindowId, liveWindowIds.contains(activeWindowId) else { return nil }
        return activeWindowId
    }

    func registerWindow(_ id: UUID) {
        liveWindowIds.insert(id)
    }

    func activateWindow(_ id: UUID) {
        registerWindow(id)
        activeWindowId = id
    }

    func unregisterWindow(_ id: UUID) {
        liveWindowIds.remove(id)
        if activeWindowId == id {
            activeWindowId = nil
        }
    }

    func selectConversation(_ id: String?, targetWindowId: UUID?) {
        requestedConversationId = id
        conversationSelectionTargetWindowId = targetWindowId
        conversationSelectionRequest += 1
    }

    func focusComposer(targetWindowId: UUID? = nil) {
        composerFocusTargetWindowId = targetWindowId
        composerFocusRequest += 1
    }

    func focusConversationSearch(targetWindowId: UUID? = nil) {
        conversationSearchFocusTargetWindowId = targetWindowId
        conversationSearchFocusRequest += 1
    }
}

@MainActor
private final class AppleSettingsWindowCoordinator: ObservableObject {
    @Published var selectedTab = SettingsTab.appearance
    @Published var requestSeed = 0

    func open(_ tab: SettingsTab) {
        selectedTab = tab
        requestSeed += 1
    }
}
#endif

@main
struct ZeroChatApp: App {
    @StateObject private var model = ZeroChatViewModel()

#if os(macOS)
    @StateObject private var commandCenter = AppleCommandCenter()
    @StateObject private var settingsWindow = AppleSettingsWindowCoordinator()
    @Environment(\.openWindow) private var openWindow

    private func showMainWindow() {
        openWindow(id: "main")
        NSApp.activate(ignoringOtherApps: true)
    }

    private func openSettingsWindow(_ tab: SettingsTab = .appearance) {
        model.settingsNotice = nil
        settingsWindow.open(tab)
        openWindow(id: "settings")
        NSApp.activate(ignoringOtherApps: true)
    }

    private func createCommandConversation() {
        let targetWindowId = commandCenter.commandTargetWindowId
        let conversationId = model.createConversation()
        showMainWindow()
        commandCenter.selectConversation(conversationId, targetWindowId: targetWindowId)
        commandCenter.focusComposer(targetWindowId: targetWindowId)
    }

    private func focusConversationSearchCommand() {
        let targetWindowId = commandCenter.commandTargetWindowId
        showMainWindow()
        commandCenter.focusConversationSearch(targetWindowId: targetWindowId)
    }

    private func createMenuBarConversation() {
        createCommandConversation()
    }
#endif

    init() {
#if os(macOS)
        NSWindow.allowsAutomaticWindowTabbing = true
#endif
#if canImport(TipKit)
        AppleTipKitRuntime.configureIfAvailable()
#endif
    }

    var body: some Scene {
#if os(macOS)
        WindowGroup(id: "main") {
            ChatView(
                model: model,
                openSettingsWindow: openSettingsWindow,
                commandCenter: commandCenter
            )
            .tint(ZeroChatTheme.accent)
        }
        .defaultSize(width: 1100, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {
                let i18n = NativeI18n(mode: model.snapshot.preferences.language)

                Button {
                    createCommandConversation()
                } label: {
                    Label(i18n.t("title.newChat"), systemImage: "plus")
                }
                .keyboardShortcut("n", modifiers: .command)

                Button {
                    showMainWindow()
                    commandCenter.focusComposer(targetWindowId: nil)
                } label: {
                    Label(i18n.t("action.newWindow"), systemImage: "macwindow.badge.plus")
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            }

            CommandGroup(replacing: .appSettings) {
                Button {
                    openSettingsWindow(.appearance)
                } label: {
                    Label(
                        NativeI18n(mode: model.snapshot.preferences.language).t("title.settings"),
                        systemImage: "gearshape"
                    )
                }
                .keyboardShortcut(",", modifiers: .command)
            }

            CommandMenu("Chat") {
                let i18n = NativeI18n(mode: model.snapshot.preferences.language)

                Button {
                    focusConversationSearchCommand()
                } label: {
                    Label(i18n.t("conversation.searchLabel"), systemImage: "magnifyingglass")
                }
                .keyboardShortcut("k", modifiers: .command)

                Button {
                    model.stopGenerating()
                } label: {
                    Label(i18n.t("action.stopGenerating"), systemImage: "stop.fill")
                }
                .keyboardShortcut(".", modifiers: .command)
                .disabled(!model.isChatStreaming)
            }
        }

        Window("Settings", id: "settings") {
            SettingsView(
                model: model,
                initialTab: settingsWindow.selectedTab,
                usesNativeTabView: true,
                showsDoneButton: false
            )
            .id(settingsWindow.requestSeed)
            .frame(minWidth: 720, minHeight: 560)
            .onDisappear {
                model.settingsNotice = nil
            }
        }
        .defaultSize(width: 860, height: 720)

        MenuBarExtra("ZeroChat", image: "MenuBarIcon") {
            let i18n = NativeI18n(mode: model.snapshot.preferences.language)

            Button {
                showMainWindow()
            } label: {
                Label(i18n.t("action.showMainWindow"), systemImage: "macwindow")
            }

            Button {
                createMenuBarConversation()
            } label: {
                Label(i18n.t("title.newChat"), systemImage: "plus")
            }

            Divider()

            Button {
                NSApp.terminate(nil)
            } label: {
                Label(i18n.t("action.quit"), systemImage: "power")
            }
        }
        .menuBarExtraStyle(.menu)
#else
        WindowGroup {
            ChatView(model: model)
                .tint(ZeroChatTheme.accent)
        }
#endif
    }
}
