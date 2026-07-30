package app.zerochat.ui.settings

import androidx.compose.runtime.Composable
import app.zerochat.ui.NativeI18n

@Composable
fun DataSettingsDangerDialogs(
    confirmPasswordChange: Boolean,
    confirmPasswordReset: Boolean,
    confirmImportBackup: Boolean,
    confirmReset: Boolean,
    confirmCloudClear: Boolean,
    pendingPassphrase: String?,
    i18n: NativeI18n,
    onDismissPasswordChange: () -> Unit,
    onConfirmPasswordChange: (String) -> Unit,
    onDismissPasswordReset: () -> Unit,
    onConfirmPasswordReset: () -> Unit,
    onDismissImportBackup: () -> Unit,
    onConfirmImportBackup: () -> Unit,
    onDismissReset: () -> Unit,
    onConfirmReset: () -> Unit,
    onDismissCloudClear: () -> Unit,
    onConfirmCloudClear: () -> Unit,
) {
    if (confirmPasswordChange) {
        DangerDialog(
            title = i18n.t("danger.changeSyncPassword.title"),
            body = dangerBody(i18n, "danger.changeSyncPassword"),
            confirm = i18n.t("action.changeSyncPassword"),
            i18n = i18n,
            onDismiss = onDismissPasswordChange,
            onConfirm = {
                onConfirmPasswordChange(pendingPassphrase.orEmpty())
            },
        )
    }

    if (confirmPasswordReset) {
        DangerDialog(
            title = i18n.t("danger.resetSyncPassword.title"),
            body = dangerBody(i18n, "danger.resetSyncPassword"),
            confirm = i18n.t("action.resetSyncPassword"),
            i18n = i18n,
            onDismiss = onDismissPasswordReset,
            onConfirm = onConfirmPasswordReset,
        )
    }

    if (confirmImportBackup) {
        DangerDialog(
            title = i18n.t("danger.import.title"),
            body = dangerBody(i18n, "danger.import"),
            confirm = i18n.t("action.importEncryptedBackup"),
            i18n = i18n,
            onDismiss = onDismissImportBackup,
            onConfirm = onConfirmImportBackup,
        )
    }

    if (confirmReset) {
        DangerDialog(
            title = i18n.t("danger.resetLocalData.title"),
            body = dangerBody(i18n, "danger.resetLocalData"),
            confirm = i18n.t("action.resetLocalData"),
            i18n = i18n,
            onDismiss = onDismissReset,
            onConfirm = onConfirmReset,
        )
    }

    if (confirmCloudClear) {
        DangerDialog(
            title = i18n.t("danger.clearCloudData.title"),
            body = dangerBody(i18n, "danger.clearCloudData"),
            confirm = i18n.t("action.clearCloudData"),
            i18n = i18n,
            onDismiss = onDismissCloudClear,
            onConfirm = onConfirmCloudClear,
        )
    }
}
