import SwiftUI
import Foundation
import ZeroChatCore

struct SyncSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    @State private var showCloudflareAccessKey = false
    @State private var syncNowRunning = false

    var body: some View {
        Section(i18n.t("setting.sync")) {
            Text(i18n.t("sync.compare.encrypted"))
                .foregroundStyle(.secondary)
            Picker(i18n.t("field.composeMode"), selection: bindingSyncMode()) {
                Text(i18n.t("mode.local")).tag("local")
                Text(i18n.t("mode.gist")).tag("gist")
                Text(i18n.t("mode.cloudflare")).tag("cloudflare")
            }
            .pickerStyle(.segmented)
            Text(syncExplanation)
                .foregroundStyle(.secondary)
            if model.snapshot.sync.mode != "local" {
                Toggle(i18n.t("field.autoSync"), isOn: bindingAutoSync())
                Text(model.snapshot.sync.autoSync ? i18n.t("sync.autoSync.on") : i18n.t("sync.autoSync.off"))
                    .foregroundStyle(.secondary)
            }
            Button(i18n.t("button.syncNow")) {
                syncNowRunning = true
                Task {
                    await model.syncNowFromSettings()
                    syncNowRunning = false
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(syncNowRunning || model.manualSyncBlockedMessage() != nil)
            if model.localSnapshotSaveError != nil {
                Button(i18n.t("button.retry")) {
                    model.retryLocalSnapshotSave()
                }
            }
            if let reason = model.manualSyncBlockedMessage() {
                Text(reason)
                    .foregroundStyle(.secondary)
            }
            if model.snapshot.sync.mode == "gist" {
                TextField(i18n.t("field.gistId"), text: bindingSyncOptional(\.gistId))
                Text(i18n.t("settings.gistIdHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                TextField(i18n.t("field.gistFile"), text: bindingSyncOptional(\.gistFile, fallback: "zerochat-sync.json"))
                Text(i18n.t("settings.gistFileHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                SecureField(i18n.t("field.githubToken"), text: secretBinding("github-token"))
                Text(i18n.t("settings.githubTokenHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if model.snapshot.sync.mode == "cloudflare" {
                let accessKey = model.cloudflareAccessKey()
                TextField(i18n.t("field.cloudflareWorkerUrl"), text: bindingSyncOptional(\.workerEndpoint))
                Text(i18n.t("settings.cloudflareWorkerUrlHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if showCloudflareAccessKey {
                    TextField(i18n.t("field.cloudflareAccessKey"), text: .constant(accessKey))
                        .textSelection(.enabled)
                } else {
                    SecureField(i18n.t("field.cloudflareAccessKey"), text: .constant(accessKey))
                }
                Text(i18n.t("settings.cloudflareAccessKeyFieldHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack {
                    Button(i18n.t(showCloudflareAccessKey ? "button.hideSecret" : "button.showSecret")) {
                        showCloudflareAccessKey.toggle()
                    }
                    .disabled(accessKey.isEmpty)

                    Button(i18n.t("button.copy")) {
                        copyToPasteboard(accessKey)
                        model.settingsNotice = AppNotice(message: i18n.t("notice.accessKeyCopied"), kind: .success)
                    }
                    .disabled(accessKey.isEmpty)
                }
                Text(i18n.t("settings.cloudflareAccessKeyNote"))
                    .foregroundStyle(.secondary)
            }
            if appleShouldShowCloudSyncStatus(snapshot: model.snapshot),
               let status = model.snapshot.sync.lastSyncStatus,
               !i18n.syncStatusMessage(status).isEmpty {
                Text(
                    [
                        i18n.syncStatusMessage(status),
                        model.snapshot.sync.lastSyncAt.map {
                            Date(timeIntervalSince1970: TimeInterval($0) / 1000)
                                .formatted(date: .numeric, time: .shortened)
                        },
                    ].compactMap { $0 }.joined(separator: " · ")
                )
                .foregroundStyle(.secondary)
            }
            if appleShouldShowFirstSyncConflict(snapshot: model.snapshot, i18n: i18n) {
                Text(i18n.t("error.firstSyncConflict"))
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.red)
                HStack {
                    Button(i18n.t("button.mergeData")) {
                        model.requestAutoSync(firstSyncStrategy: .merge)
                    }
                    Button(i18n.t("button.useCloudData")) {
                        model.requestAutoSync(firstSyncStrategy: .useRemote)
                    }
                    Button(i18n.t("button.uploadThisDevice"), role: .destructive) {
                        model.requestAutoSync(firstSyncStrategy: .useLocal)
                    }
                }
            }
        }
    }

    private var syncExplanation: String {
        switch model.snapshot.sync.mode {
        case "gist":
            return i18n.t("sync.compare.gist.fit")
        case "cloudflare":
            return i18n.t("sync.compare.cloudflare.fit")
        default:
            return i18n.t("sync.requirement.local")
        }
    }

    private func bindingSyncMode() -> Binding<String> {
        Binding(
            get: { model.snapshot.sync.mode },
            set: { value in
                var next = model.snapshot
                next.sync.mode = value
                next.sync.autoSync = value != "local"
                model.commit(next)
            }
        )
    }

    private func bindingAutoSync() -> Binding<Bool> {
        Binding(
            get: { model.snapshot.sync.autoSync },
            set: { value in
                var next = model.snapshot
                next.sync.autoSync = next.sync.mode != "local" && value
                model.commit(next)
            }
        )
    }

    private func bindingSyncOptional(
        _ keyPath: WritableKeyPath<SyncConfig, String?>,
        fallback: String? = nil
    ) -> Binding<String> {
        Binding(
            get: { model.snapshot.sync[keyPath: keyPath] ?? fallback ?? "" },
            set: { value in
                let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
                var next = model.snapshot
                next.sync[keyPath: keyPath] = normalized.isEmpty ? fallback : normalized
                model.commit(next)
            }
        )
    }

    private func secretBinding(_ account: String) -> Binding<String> {
        Binding(
            get: { model.secret(account) },
            set: { model.setSecret(account, $0) }
        )
    }
}
