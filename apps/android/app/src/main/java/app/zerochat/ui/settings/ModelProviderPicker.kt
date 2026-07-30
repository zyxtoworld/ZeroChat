package app.zerochat.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.data.ProviderConfig
import app.zerochat.ui.NativeI18n

@Composable
fun ModelProviderPicker(
    providers: List<ProviderConfig>,
    selectedProviderId: String,
    i18n: NativeI18n,
    providerDisplayName: (ProviderConfig) -> String,
    onSelected: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedProvider = providers.firstOrNull { it.id == selectedProviderId }
    Box(modifier = Modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.small,
        ) {
            ProviderModelCapabilitySummary(
                provider = selectedProvider,
                i18n = i18n,
                providerDisplayName = providerDisplayName,
                fallbackLabel = i18n.t("field.provider"),
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            providers.forEach { provider ->
                DropdownMenuItem(
                    text = {
                        ProviderModelCapabilitySummary(
                            provider = provider,
                            i18n = i18n,
                            providerDisplayName = providerDisplayName,
                            fallbackLabel = i18n.t("field.provider"),
                        )
                    },
                    onClick = {
                        expanded = false
                        onSelected(provider.id)
                    },
                )
            }
        }
    }
}

@Composable
private fun ProviderModelCapabilitySummary(
    provider: ProviderConfig?,
    i18n: NativeI18n,
    providerDisplayName: (ProviderConfig) -> String,
    fallbackLabel: String,
) {
    val providerName = if (provider != null) {
        providerDisplayName(provider)
    } else {
        fallbackLabel
    }
    val capabilitySummary = provider?.let {
        modelSettingsProviderCapabilitySummary(it, i18n::t)
    }.orEmpty()

    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            providerName,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (capabilitySummary.isNotBlank()) {
            Text(
                capabilitySummary,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
