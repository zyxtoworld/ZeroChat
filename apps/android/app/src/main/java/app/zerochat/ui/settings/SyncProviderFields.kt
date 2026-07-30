@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import app.zerochat.data.AppSnapshot
import app.zerochat.security.SecretStore
import app.zerochat.ui.NativeI18n
import kotlinx.coroutines.launch

@Composable
fun GistSyncFields(
    snapshot: AppSnapshot,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    secretStore: SecretStore,
    onSaveGithubToken: suspend (String) -> Result<Unit>,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
) {
    var committedGithubToken by remember { mutableStateOf(secretStore.githubToken()) }
    var githubToken by remember { mutableStateOf(committedGithubToken) }
    var savingGithubToken by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    OutlinedTextField(
        value = snapshot.sync.gistId.orEmpty(),
        onValueChange = {
            onLocalSnapshotChange(syncSettingsUpdateGistId(snapshot, it))
        },
        label = { Text(i18n.t("field.gistId")) },
        supportingText = { Text(i18n.t("settings.gistIdHint")) },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = snapshot.sync.gistFile ?: "zerochat-sync.json",
        onValueChange = {
            onLocalSnapshotChange(syncSettingsUpdateGistFile(snapshot, it))
        },
        label = { Text(i18n.t("field.gistFile")) },
        supportingText = { Text(i18n.t("settings.gistFileHint")) },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        value = githubToken,
        onValueChange = { githubToken = it },
        label = { Text(i18n.t("field.githubToken")) },
        supportingText = { Text(i18n.t("settings.githubTokenHint")) },
        modifier = Modifier
            .fillMaxWidth()
            .sensitiveCredential(),
        keyboardOptions = sensitiveCredentialKeyboardOptions,
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
    )
    OutlinedButton(
        onClick = {
            if (savingGithubToken) {
                return@OutlinedButton
            }
            val value = githubToken
            savingGithubToken = true
            scope.launch {
                try {
                    onSaveGithubToken(value).fold(
                        onSuccess = { committedGithubToken = value.trim() },
                        onFailure = { error ->
                            onNotice(
                                "${i18n.t("message.localDataSaveFailedPrefix")}: " +
                                    i18n.errorMessage(error.message),
                                SettingsNoticeKind.Error,
                            )
                        },
                    )
                } finally {
                    savingGithubToken = false
                }
            }
        },
        enabled = githubToken.trim() != committedGithubToken && !savingGithubToken,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("button.save"))
    }
}

@Composable
fun CloudflareSyncFields(
    snapshot: AppSnapshot,
    onLocalSnapshotChange: (AppSnapshot) -> Unit,
    cloudflareAccessKey: String,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
) {
    var showCloudflareAccessKey by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()

    OutlinedTextField(
        value = snapshot.sync.workerEndpoint.orEmpty(),
        onValueChange = {
            onLocalSnapshotChange(syncSettingsUpdateCloudflareEndpoint(snapshot, it))
        },
        label = { Text(i18n.t("field.cloudflareWorkerUrl")) },
        supportingText = { Text(i18n.t("settings.cloudflareWorkerUrlHint")) },
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        singleLine = true,
    )
    OutlinedTextField(
        value = cloudflareAccessKey,
        onValueChange = {},
        label = { Text(i18n.t("field.cloudflareAccessKey")) },
        supportingText = { Text(i18n.t("settings.cloudflareAccessKeyFieldHint")) },
        modifier = Modifier
            .fillMaxWidth()
            .sensitiveCredential(),
        keyboardOptions = sensitiveCredentialKeyboardOptions,
        readOnly = true,
        singleLine = true,
        visualTransformation = if (showCloudflareAccessKey) {
            VisualTransformation.None
        } else {
            PasswordVisualTransformation()
        },
    )
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedButton(
            onClick = { showCloudflareAccessKey = !showCloudflareAccessKey },
            enabled = cloudflareAccessKey.isNotBlank(),
        ) {
            Text(
                i18n.t(
                    if (showCloudflareAccessKey) "button.hideSecret" else "button.showSecret",
                ),
            )
        }
        OutlinedButton(
            onClick = {
                scope.launch {
                    clipboard.setClipEntry(
                        ClipEntry(
                            sensitivePlainTextClip(
                                i18n.t("field.cloudflareAccessKey"),
                                cloudflareAccessKey,
                            ),
                        ),
                    )
                    onNotice(i18n.t("notice.accessKeyCopied"), SettingsNoticeKind.Success)
                }
            },
            enabled = cloudflareAccessKey.isNotBlank(),
        ) {
            Text(i18n.t("button.copy"))
        }
    }
    Text(
        i18n.t("settings.cloudflarePasswordKeyNote"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(
        i18n.t("settings.cloudflareAccessKeyNote"),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
