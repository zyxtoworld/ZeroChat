package app.zerochat.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.NativeI18n

@Composable
fun ProviderEditor(
    provider: ProviderConfig,
    providerDisplayName: String,
    apiKey: String,
    expanded: Boolean,
    bringEditorIntoView: Boolean,
    onExpand: () -> Unit,
    onEditorBroughtIntoView: () -> Unit,
    onProviderChange: (ProviderConfig) -> Unit,
    onApiKeyChange: (String) -> Unit,
    checking: Boolean,
    deleting: Boolean,
    i18n: NativeI18n,
    onCheckConnectivity: () -> Unit,
    onDelete: () -> Unit,
) {
    var localKey by remember(provider.id) { mutableStateOf(apiKey) }
    val connected = providerSettingsIsConnected(provider, apiKey)
    var lastCommittedKey by remember(provider.id) { mutableStateOf(apiKey) }
    val editorTopRequester = remember(provider.id) { BringIntoViewRequester() }
    LaunchedEffect(provider.id, apiKey) {
        if (localKey == lastCommittedKey) {
            localKey = apiKey
        }
        lastCommittedKey = apiKey
    }

    if (!expanded) {
        ProviderSummaryCard(
            provider = provider,
            providerDisplayName = providerDisplayName,
            connected = connected,
            i18n = i18n,
            onExpand = onExpand,
        )
        return
    }

    LaunchedEffect(provider.id, bringEditorIntoView) {
        if (bringEditorIntoView) {
            editorTopRequester.bringIntoView()
            onEditorBroughtIntoView()
        }
    }

    Card(
        modifier = Modifier.testTag("zerochat-provider-editor-${provider.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .bringIntoViewRequester(editorTopRequester),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = providerDisplayName,
                    onValueChange = {
                        onProviderChange(provider.copy(name = it, updatedAt = providerEditorNowMillis()))
                    },
                    label = { Text(i18n.t("field.name")) },
                    supportingText = { Text(i18n.t("settings.providerNameHint")) },
                    modifier = Modifier.weight(1f),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Switch(
                    checked = provider.enabled,
                    onCheckedChange = {
                        onProviderChange(provider.copy(enabled = it, updatedAt = providerEditorNowMillis()))
                    },
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ProviderConnectionStatus(connected = connected, i18n = i18n)
                Text(
                    providerKindText(provider.kind, i18n),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            ProviderCapabilitySummary(provider = provider, i18n = i18n)
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(i18n.t("field.clientProvidesKey"), modifier = Modifier.weight(1f))
                Switch(
                    checked = provider.needsApiKey,
                    onCheckedChange = {
                        onProviderChange(provider.copy(needsApiKey = it, updatedAt = providerEditorNowMillis()))
                    },
                )
            }
            Text(
                i18n.t("settings.providerKeyToggleNote"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (provider.needsApiKey) {
                OutlinedTextField(
                    value = localKey,
                    onValueChange = {
                        localKey = it
                        onApiKeyChange(it)
                    },
                    label = { Text(i18n.t("field.providerKey")) },
                    supportingText = { Text(i18n.t("settings.providerKeyHint")) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .sensitiveCredential(),
                    keyboardOptions = sensitiveCredentialKeyboardOptions,
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                )
            }
            if (provider.kind != ProviderKind.Anthropic) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(i18n.t("field.useResponsesApiSpec"), modifier = Modifier.weight(1f))
                    Switch(
                        checked = provider.kind == ProviderKind.OpenAIResponses,
                        enabled = provider.custom,
                        onCheckedChange = {
                            onProviderChange(
                                provider.copy(
                                    kind = if (it) ProviderKind.OpenAIResponses else ProviderKind.OpenAICompatible,
                                    updatedAt = providerEditorNowMillis(),
                                ),
                            )
                        },
                    )
                }
                Text(
                    i18n.t("settings.responsesApiNote"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedTextField(
                value = provider.baseUrl,
                onValueChange = {
                    onProviderChange(provider.copy(baseUrl = it, updatedAt = providerEditorNowMillis()))
                },
                label = { Text(i18n.t("field.baseUrl")) },
                supportingText = { Text(i18n.t("settings.providerBaseUrlHint")) },
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = provider.proxyUrl.orEmpty(),
                onValueChange = {
                    onProviderChange(provider.copy(proxyUrl = it.ifBlank { null }, updatedAt = providerEditorNowMillis()))
                },
                label = { Text(i18n.t("field.proxyUrl")) },
                supportingText = { Text(i18n.t("settings.proxyUrlNote")) },
                modifier = Modifier.fillMaxWidth(),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(i18n.t("field.clientDirectRequest"), modifier = Modifier.weight(1f))
                Switch(
                    checked = provider.clientRequestMode,
                    onCheckedChange = {
                        onProviderChange(provider.copy(clientRequestMode = it, updatedAt = providerEditorNowMillis()))
                    },
                )
            }
            Text(
                i18n.t("settings.directRequestNote"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = onCheckConnectivity,
                enabled = !checking,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (checking) i18n.t("button.checking") else i18n.t("button.checkConnectivity"))
            }
            Text(
                i18n.t("settings.providerConnectivityPrivacy"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = onDelete,
                enabled = !deleting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(i18n.t("button.deleteProvider"))
            }
        }
    }
}

@Composable
private fun ProviderSummaryCard(
    provider: ProviderConfig,
    providerDisplayName: String,
    connected: Boolean,
    i18n: NativeI18n,
    onExpand: () -> Unit,
) {
    Card(
        modifier = Modifier.testTag("zerochat-provider-summary-${provider.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                providerDisplayName,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                ProviderConnectionStatus(connected = connected, i18n = i18n)
                Text(
                    providerKindText(provider.kind, i18n),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            OutlinedButton(
                onClick = onExpand,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("zerochat-provider-expand-${provider.id}")
                    .semantics {
                        contentDescription = providerEditActionDescription(
                            editProviderLabel = i18n.t("button.editProvider"),
                            providerDisplayName = providerDisplayName,
                        )
                    },
            ) {
                Text(i18n.t("button.editProvider"))
            }
        }
    }
}

internal fun providerEditActionDescription(
    editProviderLabel: String,
    providerDisplayName: String,
): String = "${editProviderLabel.trim()}: ${providerDisplayName.trim()}"

@Composable
private fun ProviderCapabilitySummary(
    provider: ProviderConfig,
    i18n: NativeI18n,
) {
    val capabilitySummary = providerSettingsCapabilitySummary(provider, i18n::t)
    val endpointSummary = providerSettingsEndpointSummary(provider)
    val capabilityChecks = providerSettingsCapabilityChecks(provider)
    val capabilityReadinessSummary = providerSettingsCapabilityReadinessSummary(provider, i18n::t)

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            i18n.t("settings.capabilities"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
        Text(
            capabilitySummary,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            i18n.t("settings.interfaces"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
        Text(
            endpointSummary,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
        if (capabilityChecks.isNotEmpty()) {
            Text(
                i18n.t("settings.capabilityReadiness"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Medium,
            )
            Text(
                capabilityReadinessSummary,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                i18n.t("settings.capabilityReadinessNote"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(
            i18n.t("settings.capabilityNote"),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun ProviderConnectionStatus(
    connected: Boolean,
    i18n: NativeI18n,
) {
    val label = i18n.t(if (connected) "status.providerConnected" else "status.providerNotConnected")
    val dotColor = if (connected) Color(0xFF10B981) else MaterialTheme.colorScheme.outline

    Row(
        modifier = Modifier.testTag("zerochat-provider-connection-status"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(dotColor, RoundedCornerShape(999.dp)),
        )
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
        )
    }
}

private fun providerKindText(kind: ProviderKind, i18n: NativeI18n): String = when (kind) {
    ProviderKind.OpenAICompatible -> i18n.t("provider.protocol.openaiCompatible")
    ProviderKind.OpenAIResponses -> i18n.t("provider.protocol.openaiResponses")
    ProviderKind.Anthropic -> i18n.t("provider.protocol.anthropic")
}

private fun providerEditorNowMillis(): Long = System.currentTimeMillis()
