@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import app.zerochat.ui.NativeI18n

@Composable
fun DataBackupActions(
    passphrase: String,
    backupController: DataSettingsBackupController,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    onRequestImportBackup: () -> Unit,
    i18n: NativeI18n,
) {
    Text(i18n.t("message.backupEncryptedHint"), color = MaterialTheme.colorScheme.onSurfaceVariant)
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = {
                if (passphrase.isBlank()) {
                    onNotice(i18n.t("notice.backupExportNeedsPassphrase"), SettingsNoticeKind.Warning)
                } else {
                    backupController.exportEncryptedBackup(passphrase)
                }
            },
        ) {
            Text(i18n.t("action.exportEncryptedBackup"))
        }
        OutlinedButton(
            onClick = {
                if (passphrase.isBlank()) {
                    onNotice(i18n.t("notice.backupImportNeedsPassphrase"), SettingsNoticeKind.Warning)
                } else {
                    onRequestImportBackup()
                }
            },
        ) {
            Text(i18n.t("action.importEncryptedBackup"))
        }
    }
}
