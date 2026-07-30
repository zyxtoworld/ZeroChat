package app.zerochat.ui.settings

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import app.zerochat.data.AppSnapshot
import app.zerochat.security.SecretStore
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.sync.LocalUserTriggeredSyncAction
import app.zerochat.ui.NativeI18n

@Composable
fun SyncSettings(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    onFirstSyncStrategy: (FirstSyncStrategy) -> Unit,
    secretStore: SecretStore,
    onSaveGithubToken: suspend (String) -> Result<Unit>,
    manualSyncRunning: Boolean,
    manualSyncBlockedReason: String?,
    onManualSyncClick: () -> Unit,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
) {
    val userTriggeredSyncAction = LocalUserTriggeredSyncAction.current
    val cloudflareAccessKey = secretStore.cloudflareAccessKey()
    val settingsManualBlockerKey = syncSettingsManualBlockerKey(
        snapshot = snapshot,
        hasSyncPassphrase = secretStore.syncPassphrase().isNotBlank(),
        hasGithubToken = secretStore.githubToken().isNotBlank(),
        hasCloudflareAccessKey = cloudflareAccessKey.isNotBlank(),
    )
    val settingsManualSyncBlockedReason = settingsManualBlockerKey?.let { i18n.t(it) }
    val effectiveManualSyncBlockedReason = manualSyncBlockedReason ?: settingsManualSyncBlockedReason

    SettingsCard(i18n.t("setting.sync")) {
        Text(
            i18n.t("sync.compare.encrypted"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SyncModeSection(
            snapshot = snapshot,
            onLocalSnapshotChange = onLocalSnapshotChange,
            manualSyncRunning = manualSyncRunning,
            manualSyncBlockedReason = effectiveManualSyncBlockedReason,
            onManualSyncClick = {
                userTriggeredSyncAction.run(onManualSyncClick)
            },
            i18n = i18n,
        )
        when (snapshot.sync.mode) {
            "gist" -> GistSyncFields(
                snapshot = snapshot,
                onLocalSnapshotChange = onLocalSnapshotChange,
                secretStore = secretStore,
                onSaveGithubToken = onSaveGithubToken,
                onNotice = onNotice,
                i18n = i18n,
            )
            "cloudflare" -> CloudflareSyncFields(
                snapshot = snapshot,
                onLocalSnapshotChange = onLocalSnapshotChange,
                cloudflareAccessKey = cloudflareAccessKey,
                onNotice = onNotice,
                i18n = i18n,
            )
        }
        if (snapshot.sync.mode != "local") {
            AutoSyncControl(
                snapshot = snapshot,
                onLocalSnapshotChange = { updatedSnapshot ->
                    if (!snapshot.sync.autoSync && updatedSnapshot.sync.autoSync) {
                        userTriggeredSyncAction.run {
                            onLocalSnapshotChange(updatedSnapshot)
                        }
                    } else {
                        onLocalSnapshotChange(updatedSnapshot)
                    }
                },
                i18n = i18n,
            )
            SyncStatusSection(
                sync = snapshot.sync,
                onFirstSyncStrategy = onFirstSyncStrategy,
                i18n = i18n,
            )
        }
    }
}
