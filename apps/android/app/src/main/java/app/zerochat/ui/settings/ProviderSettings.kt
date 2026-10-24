package app.zerochat.ui.settings

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.zerochat.ai.AiClient
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.defaultChatModelForProvider
import app.zerochat.data.customProvider
import app.zerochat.security.SecretStore
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.chat.providerProxyTokenForRequest
import kotlinx.coroutines.launch

private const val PROVIDER_LIST_INITIAL_RENDER_LIMIT = 4
private const val PROVIDER_LIST_RENDER_BATCH = 6

internal fun providerConnectivityFailureNotice(
    i18n: NativeI18n,
    @Suppress("UNUSED_PARAMETER") error: Throwable,
): String =
    i18n.t("notice.providerConnectivityFailed")
        .replace("{message}", i18n.t("error.apiRequestFailed"))

@Composable
fun ProviderSettings(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    onSaveProviderKey: suspend (String, String) -> Result<Unit>,
    onDeleteProvider: suspend (String) -> Result<Unit>,
    secretStore: SecretStore,
    aiClient: AiClient,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
    providerDisplayName: (ProviderConfig) -> String,
    providerRequest: (ProviderConfig, AppSnapshot) -> ProviderConfig,
) {
    val scope = rememberCoroutineScope()
    var checkingProviderId by remember { mutableStateOf("") }
    var savingProviderKeyId by remember { mutableStateOf("") }
    var deletingProviderId by remember { mutableStateOf("") }
    var expandedProviderId by rememberSaveable { mutableStateOf("") }
    var providerIdToBringIntoView by remember { mutableStateOf("") }
    var renderedProviderLimit by rememberSaveable {
        mutableIntStateOf(PROVIDER_LIST_INITIAL_RENDER_LIMIT)
    }
    fun openProviderEditor(providerId: String) {
        expandedProviderId = providerId
        providerIdToBringIntoView = providerId
    }
    val sortedProviders = snapshot.providers.sortedWith(
        compareByDescending<ProviderConfig> { it.enabled }
            .thenBy { providerDisplayName(it) },
    )
    val visibleProviderCount = sortedProviders.size.coerceAtMost(renderedProviderLimit)
    val visibleProviders = sortedProviders.take(visibleProviderCount)
    val activeExpandedProviderId = providerSettingsExpandedProviderId(
        sortedProviders = sortedProviders,
        visibleProviders = visibleProviders,
        requestedProviderId = expandedProviderId,
    )

    fun currentFetchOwner(current: AppSnapshot, providerId: String): ModelSettingsFetchOwner? {
        val currentProvider = current.providers.firstOrNull { it.id == providerId } ?: return null
        return runCatching {
            val currentRequestProvider = providerRequest(currentProvider, current)
            ModelSettingsFetchOwner(
                requestProvider = currentRequestProvider,
                apiKey = secretStore.providerKey(providerId),
                proxyToken = providerProxyTokenForRequest(currentRequestProvider) {
                    secretStore.cloudflareAccessKey()
                },
            )
        }.getOrNull()
    }

    SettingsCard(i18n.t("setting.providers")) {
        Button(
            onClick = {
                val provider = customProvider(i18n.t("provider.preset.custom-openai-relay"))
                openProviderEditor(provider.id)
                onSnapshotChange(snapshot.copy(providers = listOf(provider) + snapshot.providers))
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(i18n.t("button.addProvider"))
        }

        if (visibleProviderCount < sortedProviders.size) {
            Text(
                i18n.t("settings.listProgress")
                    .replace("{shown}", visibleProviderCount.toString())
                    .replace("{total}", sortedProviders.size.toString()),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        visibleProviders.forEach { provider ->
            ProviderEditor(
                provider = provider,
                providerDisplayName = providerDisplayName(provider),
                apiKey = secretStore.providerKey(provider.id),
                expanded = provider.id == activeExpandedProviderId,
                bringEditorIntoView = provider.id == providerIdToBringIntoView,
                onExpand = { openProviderEditor(provider.id) },
                onEditorBroughtIntoView = {
                    if (providerIdToBringIntoView == provider.id) {
                        providerIdToBringIntoView = ""
                    }
                },
                onProviderChange = { updated ->
                    if (provider.enabled && !updated.enabled &&
                        !providerSettingsCanDisableProvider(snapshot, provider.id)
                    ) {
                        onNotice(i18n.t("notice.providerMinimum"), SettingsNoticeKind.Warning)
                    } else {
                        onSnapshotChange(
                            providerSettingsApplyProviderChange(
                                snapshot = snapshot,
                                updated = updated,
                                fallbackModelForProvider = {
                                    defaultChatModelForProvider(it)
                                },
                                now = nowMillis(),
                            ),
                        )
                    }
                },
                onApiKeyChange = {
                    if (savingProviderKeyId.isEmpty()) {
                        savingProviderKeyId = provider.id
                        val value = it
                        scope.launch {
                            try {
                                onSaveProviderKey(provider.id, value).onFailure { error ->
                                    onNotice(
                                        "${i18n.t("message.localDataSaveFailedPrefix")}: " +
                                            i18n.errorMessage(error.message),
                                        SettingsNoticeKind.Error,
                                    )
                                }
                            } finally {
                                savingProviderKeyId = ""
                            }
                        }
                    }
                    Unit
                },
                checking = checkingProviderId == provider.id,
                savingKey = savingProviderKeyId == provider.id,
                deleting = deletingProviderId == provider.id || savingProviderKeyId == provider.id,
                i18n = i18n,
                onCheckConnectivity = check@{
                    val providerKey = secretStore.providerKey(provider.id)
                    val blockerKey = providerSettingsConnectivityBlockerKey(provider, providerKey)
                    if (blockerKey != null) {
                        onNotice(i18n.t(blockerKey), SettingsNoticeKind.Warning)
                        return@check
                    }
                    if (checkingProviderId.isNotEmpty()) {
                        return@check
                    }

                    checkingProviderId = provider.id
                    scope.launch {
                        var requestOwner: ModelSettingsFetchOwner? = null
                        try {
                            val result = runCatchingPreservingCancellation {
                                val requestProvider = providerRequest(provider, snapshot)
                                val proxyToken = providerProxyTokenForRequest(requestProvider) {
                                    secretStore.cloudflareAccessKey()
                                }
                                requestOwner = ModelSettingsFetchOwner(
                                    requestProvider = requestProvider,
                                    apiKey = providerKey,
                                    proxyToken = proxyToken,
                                )
                                val catalog = aiClient.listModelCatalog(
                                    provider = requestProvider,
                                    apiKey = providerKey,
                                    proxyToken = proxyToken,
                                )
                                catalog
                            }
                            result.onSuccess { catalog ->
                                val models = catalog.models
                                val expectedOwner = requestOwner ?: return@onSuccess
                                var applied = false
                                onSnapshotReduce { current ->
                                    val updated = providerSettingsApplyConnectivityModelsToSnapshot(
                                        snapshot = current,
                                        providerId = provider.id,
                                        models = models,
                                        modelMetadata = catalog.modelMetadata,
                                        now = nowMillis(),
                                        expectedOwner = expectedOwner,
                                        currentOwner = currentFetchOwner(current, provider.id),
                                    )
                                    applied = updated !== current
                                    updated
                                }
                                if (applied) {
                                    onNotice(
                                        i18n.t("notice.providerConnectivityPassed")
                                            .replace("{count}", models.size.toString()),
                                        SettingsNoticeKind.Success,
                                    )
                                }
                            }.onFailure { error ->
                                val expectedOwner = requestOwner
                                if (expectedOwner == null) {
                                    onNotice(
                                        providerConnectivityFailureNotice(i18n, error),
                                        SettingsNoticeKind.Error,
                                    )
                                } else {
                                    var current = false
                                    onSnapshotReduce { snapshot ->
                                        current = currentFetchOwner(snapshot, provider.id)?.let {
                                            modelSettingsFetchOwnerMatches(expectedOwner, it)
                                        } == true
                                        snapshot
                                    }
                                    if (current) {
                                        onNotice(
                                            providerConnectivityFailureNotice(i18n, error),
                                            SettingsNoticeKind.Error,
                                        )
                                    }
                                }
                            }
                        } finally {
                            checkingProviderId = ""
                        }
                    }
                },
                onDelete = {
                    if (snapshot.providers.size <= 1) {
                        onNotice(i18n.t("notice.providerMinimum"), SettingsNoticeKind.Warning)
                    } else if (deletingProviderId.isEmpty()) {
                        deletingProviderId = provider.id
                        scope.launch {
                            try {
                                onDeleteProvider(provider.id).fold(
                                    onSuccess = {
                                        providerIdToBringIntoView = ""
                                        expandedProviderId = sortedProviders
                                            .firstOrNull { it.id != provider.id }
                                            ?.id
                                            .orEmpty()
                                        onNotice(
                                            i18n.t("notice.providerDeleted"),
                                            SettingsNoticeKind.Warning,
                                        )
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
                                deletingProviderId = ""
                            }
                        }
                    }
                },
            )
        }

        if (visibleProviderCount < sortedProviders.size) {
            OutlinedButton(
                onClick = {
                    renderedProviderLimit = (renderedProviderLimit + PROVIDER_LIST_RENDER_BATCH)
                        .coerceAtMost(sortedProviders.size)
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(i18n.t("button.showMore"))
            }
        }
    }
}

private fun nowMillis(): Long = System.currentTimeMillis()
