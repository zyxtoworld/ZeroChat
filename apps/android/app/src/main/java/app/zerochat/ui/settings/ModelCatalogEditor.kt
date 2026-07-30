@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.zerochat.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AssistChip
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.zerochat.ai.AiClient
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.security.SecretStore
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.chat.providerProxyTokenForRequest
import kotlinx.coroutines.launch

@Composable
fun ModelCatalogEditor(
    snapshot: AppSnapshot,
    provider: ProviderConfig,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    secretStore: SecretStore,
    aiClient: AiClient,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
    providerRequest: (ProviderConfig, AppSnapshot) -> ProviderConfig,
) {
    val scope = rememberCoroutineScope()
    var manualInput by remember(provider.id) { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    fun commitManualModels(input: String = manualInput) {
        val models = modelSettingsManualModels(input)
        if (models.isEmpty()) {
            manualInput = ""
            return
        }
        onSnapshotChange(
            snapshot.copy(
                providers = modelSettingsReplaceProvider(
                    snapshot.providers,
                    modelSettingsApplyModels(provider, models, nowMillis()),
                ),
            ),
        )
        manualInput = ""
    }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(i18n.t("field.models"), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        OutlinedButton(
            enabled = !loading,
            onClick = {
                val providerKey = secretStore.providerKey(provider.id)
                val blockerKey = modelSettingsFetchBlockerKey(provider, providerKey)
                if (blockerKey != null) {
                    onNotice(i18n.t(blockerKey), SettingsNoticeKind.Warning)
                    return@OutlinedButton
                }
                loading = true
                scope.launch {
                    try {
                        val result = runCatchingPreservingCancellation {
                            val requestProvider = providerRequest(provider, snapshot)
                            aiClient.listModels(
                                provider = requestProvider,
                                apiKey = providerKey,
                                proxyToken = providerProxyTokenForRequest(requestProvider) {
                                    secretStore.cloudflareAccessKey()
                                },
                            )
                        }
                        result.onSuccess { models ->
                            onSnapshotReduce { current ->
                                val provider = current.providers.firstOrNull { it.id == provider.id }
                                    ?: return@onSnapshotReduce current
                                current.copy(
                                    providers = modelSettingsReplaceProvider(
                                        current.providers,
                                        modelSettingsApplyFetchedModels(provider, models, nowMillis()),
                                    ),
                                )
                            }
                            onNotice(
                                i18n.t("notice.modelsFetched").replace("{count}", models.size.toString()),
                                SettingsNoticeKind.Success,
                            )
                        }.onFailure {
                            onNotice(
                                i18n.t("notice.modelsFetchFailed").replace("{message}", it.message.orEmpty()),
                                SettingsNoticeKind.Error,
                            )
                        }
                    } finally {
                        loading = false
                    }
                }
            },
        ) {
            Text(if (loading) i18n.t("button.fetching") else i18n.t("button.fetchModels"))
        }
    }
    OutlinedTextField(
        value = manualInput,
        onValueChange = { value ->
            if (value.lastOrNull()?.isWhitespace() == true) {
                commitManualModels(value)
            } else {
                manualInput = value
            }
        },
        label = { Text(i18n.t("placeholder.modelList")) },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedButton(
        enabled = modelSettingsManualModels(manualInput).isNotEmpty(),
        onClick = { commitManualModels() },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(i18n.t("action.addModel"), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        provider.models.forEachIndexed { index, model ->
            val capabilitySummary = modelSettingsModelCapabilitySummary(model, i18n::t)
            AssistChip(
                onClick = {},
                label = {
                    Column {
                        Text(model, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (capabilitySummary.isNotBlank()) {
                            Text(
                                capabilitySummary,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                trailingIcon = {
                    Row {
                        Text(
                            i18n.t("action.moveUp"),
                            modifier = Modifier.clickable {
                                if (index > 0) {
                                    onSnapshotChange(
                                        snapshot.copy(
                                            providers = modelSettingsReplaceProvider(
                                                snapshot.providers,
                                                modelSettingsApplyConfiguredModels(
                                                    provider = provider,
                                                    models = modelSettingsMoveModel(
                                                        provider.models,
                                                        index,
                                                        index - 1,
                                                    ),
                                                    now = nowMillis(),
                                                ),
                                            ),
                                        ),
                                    )
                                }
                            },
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            "X",
                            modifier = Modifier.clickable {
                                onSnapshotChange(
                                    snapshot.copy(
                                        providers = modelSettingsReplaceProvider(
                                            snapshot.providers,
                                            modelSettingsRemoveModel(provider, model, nowMillis()),
                                        ),
                                    ),
                                )
                            },
                        )
                    }
                },
            )
        }
    }
}

private fun nowMillis(): Long = System.currentTimeMillis()
