package app.zerochat.ui.settings

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import app.zerochat.ai.AiClient
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.security.SecretStore
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.sync.SyncClient
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.chat.GenerationTaskOwner

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatSettingsSheet(
    snapshot: AppSnapshot,
    initialTabName: String,
    noticeContent: @Composable () -> Unit,
    onTabChanged: () -> Unit,
    onDismiss: () -> Unit,
    onDismissKeyboard: () -> Unit,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    onSaveProviderKey: suspend (String, String) -> Result<Unit>,
    onDeleteProvider: suspend (String) -> Result<Unit>,
    onSaveGithubToken: suspend (String) -> Result<Unit>,
    onSaveSyncPassphrase: suspend (String) -> Result<Unit>,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    backupTaskViewModel: BackupTaskViewModel,
    onResetLocalData: suspend (AppSnapshot) -> Result<Unit>,
    onFirstSyncStrategy: (FirstSyncStrategy) -> Unit,
    secretStore: SecretStore,
    syncClient: SyncClient,
    aiClient: AiClient,
    manualSyncRunning: Boolean,
    manualSyncBlockedReason: String?,
    onManualSyncClick: () -> Unit,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    providerDisplayName: (ProviderConfig) -> String,
    providerRequest: (ProviderConfig, AppSnapshot) -> ProviderConfig,
    i18n: NativeI18n,
    generationTasks: GenerationTaskOwner,
) {
    val settingsSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = settingsSheetState,
    ) {
        SettingsScreen(
            initialTab = SettingsTab.entries.firstOrNull { it.name == initialTabName }
                ?: SettingsTab.Appearance,
            noticeContent = noticeContent,
            onTabChanged = onTabChanged,
            onDismissKeyboard = onDismissKeyboard,
            i18n = i18n,
        ) { tab, requestContentScrollTop ->
            when (tab) {
                SettingsTab.Appearance -> AppearanceSettings(snapshot, onSnapshotChange, i18n)
                SettingsTab.Providers -> ProviderSettings(
                    snapshot,
                    onSnapshotChange,
                    onSnapshotReduce,
                    onSaveProviderKey,
                    onDeleteProvider,
                    secretStore,
                    aiClient,
                    onNotice,
                    i18n,
                    providerDisplayName,
                    providerRequest,
                )
                SettingsTab.Models -> ModelSettings(
                    snapshot,
                    onSnapshotChange,
                    onSnapshotReduce,
                    secretStore,
                    aiClient,
                    onNotice,
                    i18n,
                    providerDisplayName,
                    providerRequest,
                )
                SettingsTab.Skills -> SkillsSettings(
                    snapshot,
                    onSnapshotChange,
                    onSnapshotReduce,
                    onNotice,
                    i18n,
                    requestContentScrollTop,
                    generationTasks,
                )
                SettingsTab.Sync -> SyncSettings(
                    snapshot,
                    onSnapshotChange,
                    onLocalSnapshotChange,
                    onFirstSyncStrategy,
                    secretStore,
                    onSaveGithubToken,
                    manualSyncRunning,
                    manualSyncBlockedReason,
                    onManualSyncClick = onManualSyncClick,
                    onNotice = onNotice,
                    i18n = i18n,
                )
                SettingsTab.Data -> DataSettings(
                    snapshot,
                    onSaveSyncPassphrase,
                    backupTaskViewModel,
                    onResetLocalData,
                    secretStore,
                    syncClient,
                    onNotice,
                    i18n,
                )
            }
        }
    }
}
