package app.zerochat.ui.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import app.zerochat.data.AppSnapshot
import app.zerochat.data.defaultProviderConfigs
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.security.SecretStore
import app.zerochat.sync.SyncClient
import app.zerochat.ui.NativeI18n
import kotlinx.coroutines.launch

@Composable
internal fun DataSettings(
    snapshot: AppSnapshot,
    onSaveSyncPassphrase: suspend (String) -> Result<Unit>,
    backupTaskViewModel: BackupTaskViewModel,
    onResetLocalData: suspend (AppSnapshot) -> Result<Unit>,
    secretStore: SecretStore,
    syncClient: SyncClient,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
) {
    val scope = rememberCoroutineScope()
    val backupTasks = backupTaskViewModel.tasks
    val currentOnNotice by rememberUpdatedState(onNotice)
    val backupController = rememberDataSettingsBackupController(
        snapshot = snapshot,
        backupTasks = backupTasks,
        secretStore = secretStore,
        i18n = i18n,
    )
    LaunchedEffect(backupTasks) {
        backupTasks.notices.collect { notices ->
            notices.forEach { notice ->
                currentOnNotice(notice.message, notice.kind)
                backupTasks.acknowledgeNotice(notice.id)
            }
        }
    }
    var committedPassphrase by remember { mutableStateOf(secretStore.syncPassphrase()) }
    var passphrase by remember { mutableStateOf(committedPassphrase) }
    var pendingPassphrase by remember { mutableStateOf<String?>(null) }
    var confirmPasswordChange by remember { mutableStateOf(false) }
    var confirmPasswordReset by remember { mutableStateOf(false) }
    var confirmImportBackup by remember { mutableStateOf(false) }
    var confirmReset by remember { mutableStateOf(false) }
    var confirmCloudClear by remember { mutableStateOf(false) }
    var savingPassphrase by remember { mutableStateOf(false) }
    var resettingLocalData by remember { mutableStateOf(false) }

    fun finishLocalReset() {
        committedPassphrase = ""
        passphrase = ""
        pendingPassphrase = null
        onNotice(i18n.t("message.localDataReset"), SettingsNoticeKind.Warning)
    }

    fun commitPassphrase(
        value: String,
        message: String,
        kind: SettingsNoticeKind = SettingsNoticeKind.Success,
    ) {
        if (savingPassphrase) {
            return
        }
        savingPassphrase = true
        scope.launch {
            try {
                onSaveSyncPassphrase(value).fold(
                    onSuccess = {
                        committedPassphrase = value
                        passphrase = value
                        pendingPassphrase = null
                        onNotice(message, kind)
                    },
                    onFailure = { error ->
                        onNotice(
                            "${i18n.t("message.localDataSaveFailedPrefix")}: " +
                                i18n.errorMessage(error.message),
                            SettingsNoticeKind.Error,
                        )
                    },
                )
            } finally {
                savingPassphrase = false
            }
        }
    }

    fun requestPassphraseSave() {
        if (passphrase.isBlank()) {
            onNotice(i18n.t("message.dataPasswordRequired"), SettingsNoticeKind.Warning)
            return
        }
        if (passphrase == committedPassphrase) {
            onNotice(i18n.t("message.syncPasswordAlreadySaved"), SettingsNoticeKind.Success)
            return
        }

        if (
            snapshot.sync.mode != "local" &&
            committedPassphrase.isNotBlank() &&
            passphrase.isNotBlank()
        ) {
            pendingPassphrase = passphrase
            confirmPasswordChange = true
            return
        }

        commitPassphrase(passphrase, i18n.t("message.syncPasswordSaved"))
    }

    SettingsCard(i18n.t("setting.dataPrivacy")) {
        DataPassphraseSection(
            passphrase = passphrase,
            onPassphraseChange = { passphrase = it },
            onSaveSyncPassword = { requestPassphraseSave() },
            onResetSyncPassword = { confirmPasswordReset = true },
            saving = savingPassphrase,
            i18n = i18n,
        )
        DataBackupActions(
            passphrase = passphrase,
            backupController = backupController,
            onNotice = onNotice,
            onRequestImportBackup = { confirmImportBackup = true },
            i18n = i18n,
        )
        DataDangerActions(
            onResetLocalData = { confirmReset = true },
            onClearCloudData = { confirmCloudClear = true },
            resetEnabled = !resettingLocalData,
            i18n = i18n,
        )
    }

    DataSettingsDangerDialogs(
        confirmPasswordChange = confirmPasswordChange,
        confirmPasswordReset = confirmPasswordReset,
        confirmImportBackup = confirmImportBackup,
        confirmReset = confirmReset,
        confirmCloudClear = confirmCloudClear,
        pendingPassphrase = pendingPassphrase,
        i18n = i18n,
        onDismissPasswordChange = {
            confirmPasswordChange = false
            pendingPassphrase = null
            passphrase = committedPassphrase
        },
        onConfirmPasswordChange = { value ->
            commitPassphrase(
                value,
                i18n.t("message.syncPasswordChanged"),
                SettingsNoticeKind.Warning,
            )
            confirmPasswordChange = false
        },
        onDismissPasswordReset = { confirmPasswordReset = false },
        onConfirmPasswordReset = {
            commitPassphrase(
                "",
                i18n.t("message.syncPasswordCleared"),
                SettingsNoticeKind.Warning,
            )
            confirmPasswordReset = false
        },
        onDismissImportBackup = { confirmImportBackup = false },
        onConfirmImportBackup = {
            confirmImportBackup = false
            backupController.importEncryptedBackup(passphrase)
        },
        onDismissReset = { confirmReset = false },
        onConfirmReset = {
            confirmReset = false
            if (resettingLocalData) {
                return@DataSettingsDangerDialogs
            }
            val replacement = emptySnapshot(i18n)
            resettingLocalData = true
            scope.launch {
                try {
                    onResetLocalData(replacement).fold(
                        onSuccess = { finishLocalReset() },
                        onFailure = { error ->
                            onNotice(i18n.errorMessage(error.message), SettingsNoticeKind.Error)
                        },
                    )
                } finally {
                    resettingLocalData = false
                }
            }
        },
        onDismissCloudClear = { confirmCloudClear = false },
        onConfirmCloudClear = {
            confirmCloudClear = false
            when (
                val request = dataSettingsCloudClearRequest(
                    snapshot,
                    githubToken = secretStore.githubToken(),
                    cloudflareAccessKey = secretStore.cloudflareAccessKey(),
                )
            ) {
                is DataSettingsCloudClearRequest.Cloudflare -> {
                    scope.launch {
                        reportCloudClearResult(
                            runCatchingPreservingCancellation {
                                syncClient.clearCloudflare(request.endpoint, request.accessKey)
                            },
                            onNotice,
                            i18n,
                        )
                    }
                }

                is DataSettingsCloudClearRequest.Gist -> {
                    scope.launch {
                        reportCloudClearResult(
                            runCatchingPreservingCancellation {
                                syncClient.clearGist(
                                    gistId = request.gistId,
                                    gistFile = request.gistFile,
                                    token = request.token,
                                )
                            },
                            onNotice,
                            i18n,
                        )
                    }
                }

                is DataSettingsCloudClearRequest.Blocked -> {
                    onNotice(i18n.t(request.noticeKey), SettingsNoticeKind.Warning)
                }
            }
        },
    )
}

private fun reportCloudClearResult(
    result: Result<Unit>,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
) {
    result.fold(
        onSuccess = { onNotice(i18n.t("message.cloudSyncCleared"), SettingsNoticeKind.Success) },
        onFailure = {
            val detail = i18n.errorMessage(it.message)
            val prefix = i18n.t("message.cloudClearFailedPrefix")
            onNotice(
                if (detail.startsWith(prefix)) detail else "$prefix: $detail",
                SettingsNoticeKind.Error,
            )
        },
    )
}

private fun emptySnapshot(i18n: NativeI18n): AppSnapshot =
    dataSettingsEmptySnapshot(i18n.t("provider.preset.custom-openai-relay"), nowMillis())

private fun nowMillis(): Long = System.currentTimeMillis()
