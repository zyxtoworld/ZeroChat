@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.zerochat.ui.NativeI18n

@Composable
fun DataPassphraseSection(
    passphrase: String,
    onPassphraseChange: (String) -> Unit,
    onSaveSyncPassword: () -> Unit,
    onResetSyncPassword: () -> Unit,
    saving: Boolean,
    i18n: NativeI18n,
) {
    Text(
        i18n.t("settings.syncEncryptedNote"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    OutlinedTextField(
        value = passphrase,
        onValueChange = onPassphraseChange,
        enabled = !saving,
        label = { Text(i18n.t("field.dataPassphrase")) },
        modifier = Modifier
            .fillMaxWidth()
            .sensitiveCredential(),
        keyboardOptions = sensitiveCredentialKeyboardOptions,
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
    )
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(onClick = onSaveSyncPassword, enabled = !saving) {
            Text(i18n.t("action.saveSyncPassword"))
        }
        OutlinedButton(onClick = onResetSyncPassword, enabled = !saving) {
            Text(i18n.t("action.resetSyncPassword"))
        }
    }
}
