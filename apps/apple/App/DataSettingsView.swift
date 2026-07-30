import SwiftUI
import Foundation
import UniformTypeIdentifiers
import ZeroChatCore

struct DataSettingsView: View {
    @ObservedObject var model: ZeroChatViewModel
    let i18n: NativeI18n
    @State private var syncPassphraseDraft = ""
    @State private var committedSyncPassphrase = ""
    @State private var pendingSyncPassphrase: String?
    @State private var confirmSyncPasswordChange = false
    @State private var confirmSyncPasswordReset = false
    @State private var confirmBackupImport = false
    @State private var confirmReset = false
    @State private var confirmClearCloud = false
    @State private var backupImporterPresented = false
    @State private var backupExporterPresented = false
    @State private var backupDocument = ZeroChatBackupDocument()
    @State private var backupExportFileName = "zerochat-encrypted.json"

    var body: some View {
        Section(i18n.t("setting.dataPrivacy")) {
            Text(i18n.t("settings.syncEncryptedNote"))
                .foregroundStyle(.secondary)
            SecureField(i18n.t("field.dataPassphrase"), text: $syncPassphraseDraft)
            VStack(alignment: .leading) {
                Button(i18n.t("action.saveSyncPassword")) {
                    saveSyncPassphrase()
                }
                Button(i18n.t("action.resetSyncPassword")) {
                    confirmSyncPasswordReset = true
                }
            }
            Text(i18n.t("message.backupEncryptedHint"))
                .foregroundStyle(.secondary)
            Button {
                prepareEncryptedBackupExport()
            } label: {
                Label(i18n.t("action.exportEncryptedBackup"), systemImage: "square.and.arrow.up")
            }
            Button {
                requestEncryptedBackupImport()
            } label: {
                Label(i18n.t("action.importEncryptedBackup"), systemImage: "square.and.arrow.down")
            }
            .disabled(model.recoveringLocalSnapshot)
            Button(i18n.t("action.resetLocalData"), role: .destructive) {
                confirmReset = true
            }
            .disabled(model.recoveringLocalSnapshot)
            Button(i18n.t("action.clearCloudData"), role: .destructive) {
                confirmClearCloud = true
            }
        }
        .confirmationDialog(i18n.t("danger.resetLocalData.title"), isPresented: $confirmReset, titleVisibility: .visible) {
            Button(i18n.t("action.resetLocalData"), role: .destructive) {
                Task {
                    do {
                        try await model.resetLocalData()
                        committedSyncPassphrase = ""
                        syncPassphraseDraft = ""
                        pendingSyncPassphrase = nil
                        model.settingsNotice = AppNotice(
                            message: i18n.t("message.localDataReset"),
                            kind: .warning
                        )
                    } catch {
                        model.settingsNotice = AppNotice(
                            message: i18n.errorMessage(error),
                            kind: .error
                        )
                    }
                }
            }
            Button(i18n.t("action.cancel"), role: .cancel) {}
        } message: {
            Text(dangerText("danger.resetLocalData", i18n))
        }
        .confirmationDialog(i18n.t("danger.clearCloudData.title"), isPresented: $confirmClearCloud, titleVisibility: .visible) {
            Button(i18n.t("action.clearCloudData"), role: .destructive) {
                model.clearCloudData()
            }
            Button(i18n.t("action.cancel"), role: .cancel) {}
        } message: {
            Text(dangerText("danger.clearCloudData", i18n))
        }
        .confirmationDialog(i18n.t("danger.changeSyncPassword.title"), isPresented: $confirmSyncPasswordChange, titleVisibility: .visible) {
            Button(i18n.t("action.changeSyncPassword"), role: .destructive) {
                commitSyncPassphrase(
                    pendingSyncPassphrase ?? "",
                    message: i18n.t("message.syncPasswordChanged"),
                    kind: .warning
                )
                confirmSyncPasswordChange = false
            }
            Button(i18n.t("action.cancel"), role: .cancel) {
                pendingSyncPassphrase = nil
                syncPassphraseDraft = committedSyncPassphrase
            }
        } message: {
            Text(dangerText("danger.changeSyncPassword", i18n))
        }
        .confirmationDialog(i18n.t("danger.resetSyncPassword.title"), isPresented: $confirmSyncPasswordReset, titleVisibility: .visible) {
            Button(i18n.t("action.resetSyncPassword"), role: .destructive) {
                commitSyncPassphrase(
                    "",
                    message: i18n.t("message.syncPasswordCleared"),
                    kind: .warning
                )
                confirmSyncPasswordReset = false
            }
            Button(i18n.t("action.cancel"), role: .cancel) {}
        } message: {
            Text(dangerText("danger.resetSyncPassword", i18n))
        }
        .confirmationDialog(i18n.t("danger.import.title"), isPresented: $confirmBackupImport, titleVisibility: .visible) {
            Button(i18n.t("action.importEncryptedBackup"), role: .destructive) {
                backupImporterPresented = true
            }
            Button(i18n.t("action.cancel"), role: .cancel) {}
        } message: {
            Text(dangerText("danger.import", i18n))
        }
        .onAppear {
            committedSyncPassphrase = model.secret("sync-passphrase")
            syncPassphraseDraft = committedSyncPassphrase
        }
        .fileImporter(
            isPresented: $backupImporterPresented,
            allowedContentTypes: [.json, .data],
            allowsMultipleSelection: false
        ) { result in
            importEncryptedBackup(result)
        }
        .fileExporter(
            isPresented: $backupExporterPresented,
            document: backupDocument,
            contentType: .json,
            defaultFilename: backupExportFileName
        ) { result in
            switch result {
            case .success:
                model.settingsNotice = AppNotice(message: i18n.t("notice.backupExportStarted"), kind: .success)
            case .failure(let error):
                model.settingsNotice = AppNotice(message: i18n.errorMessage(error), kind: .error)
            }
        }
    }

    private func saveSyncPassphrase() {
        if syncPassphraseDraft == committedSyncPassphrase {
            model.settingsNotice = AppNotice(message: i18n.t("message.syncPasswordAlreadySaved"), kind: .success)
            return
        }

        if model.snapshot.sync.mode != "local",
           !committedSyncPassphrase.isEmpty,
           !syncPassphraseDraft.isEmpty {
            pendingSyncPassphrase = syncPassphraseDraft
            confirmSyncPasswordChange = true
            return
        }

        commitSyncPassphrase(syncPassphraseDraft, message: i18n.t("message.syncPasswordSaved"))
    }

    private func commitSyncPassphrase(
        _ value: String,
        message: String,
        kind: AppNotice.Kind = .success
    ) {
        guard model.setSecret("sync-passphrase", value) else {
            return
        }
        committedSyncPassphrase = value
        syncPassphraseDraft = value
        pendingSyncPassphrase = nil
        model.settingsNotice = AppNotice(message: message, kind: kind)
    }

    private func prepareEncryptedBackupExport() {
        guard !syncPassphraseDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            model.settingsNotice = AppNotice(message: i18n.t("notice.backupExportNeedsPassphrase"), kind: .warning)
            return
        }

        let passphrase = syncPassphraseDraft
        Task {
            do {
                let data = try await model.exportEncryptedBackup(passphrase: passphrase)
                try assertLocalFileByteCount(
                    data.count,
                    maxBytes: maxEncryptedBackupFileBytes
                )
                backupDocument = ZeroChatBackupDocument(data: data)
                backupExportFileName = backupFileName()
                backupExporterPresented = true
            } catch {
                model.settingsNotice = AppNotice(message: i18n.errorMessage(error), kind: .error)
            }
        }
    }

    private func requestEncryptedBackupImport() {
        guard !syncPassphraseDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            model.settingsNotice = AppNotice(message: i18n.t("notice.backupImportNeedsPassphrase"), kind: .warning)
            return
        }

        confirmBackupImport = true
    }

    private func importEncryptedBackup(_ result: Result<[URL], Error>) {
        let passphrase = syncPassphraseDraft

        Task {
            do {
                guard let url = try result.get().first else { return }
                let shouldStop = url.startAccessingSecurityScopedResource()
                defer {
                    if shouldStop {
                        url.stopAccessingSecurityScopedResource()
                    }
                }

                let data = try readBoundedLocalFileData(
                    at: url,
                    maxBytes: maxEncryptedBackupFileBytes
                )
                try await model.importEncryptedBackup(data, passphrase: passphrase)
                model.settingsNotice = AppNotice(message: i18n.t("notice.backupImported"), kind: .success)
            } catch {
                model.settingsNotice = AppNotice(message: i18n.errorMessage(error), kind: .error)
            }
        }
    }
}
