package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.ui.NativeI18n

@Composable
fun ModelDefaultChoices(
    snapshot: AppSnapshot,
    provider: ProviderConfig,
    onSnapshotChange: (AppSnapshot) -> Unit,
    i18n: NativeI18n,
) {
    ModelChoice(
        title = i18n.t("field.defaultModel"),
        models = provider.models,
        selected = provider.model,
        i18n = i18n,
        onSelected = {
            onSnapshotChange(
                snapshot.copy(
                    providers = modelSettingsReplaceProvider(
                        snapshot.providers,
                        modelSettingsSelectChatModel(provider, it, nowMillis()),
                    ),
                ),
            )
        },
    )
    ModelChoice(
        title = i18n.t("field.imageModel"),
        models = provider.models,
        selected = provider.imageModel.orEmpty(),
        i18n = i18n,
        onSelected = {
            onSnapshotChange(
                snapshot.copy(
                    providers = modelSettingsReplaceProvider(
                        snapshot.providers,
                        modelSettingsSelectImageModel(provider, it, nowMillis()),
                    ),
                ),
            )
        },
    )
}

@Composable
private fun ModelChoice(
    title: String,
    models: List<String>,
    selected: String,
    i18n: NativeI18n,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold)
        Box {
            OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
                Text(selected.ifBlank { i18n.t("option.emptyModel") }, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                DropdownMenuItem(text = { Text(i18n.t("option.none")) }, onClick = {
                    expanded = false
                    onSelected("")
                })
                models.forEach {
                    DropdownMenuItem(text = { Text(it) }, onClick = {
                        expanded = false
                        onSelected(it)
                    })
                }
            }
        }
    }
}

private fun nowMillis(): Long = System.currentTimeMillis()
