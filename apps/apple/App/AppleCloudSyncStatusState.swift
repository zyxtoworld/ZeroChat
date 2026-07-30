import Foundation
import ZeroChatCore

@MainActor
extension ZeroChatViewModel {
    func manualSyncBlockedMessage() -> String? {
        if let localSnapshotNotice {
            return localSnapshotNotice.message
        }
        return appleManualSyncBlockedMessage(
            snapshot: snapshot,
            isChatStreaming: isChatStreaming,
            hasSyncPassphrase: hasSavedSyncPassphrase,
            hasCloudflareAccessKey: hasSavedCloudflareAccessKey,
            hasGitHubToken: hasSavedGitHubToken,
            i18n: i18n
        )
    }

    func cloudSyncSummary(_ i18n: NativeI18n) -> String {
        appleCloudSyncSummary(snapshot: snapshot, i18n: i18n)
    }
}
