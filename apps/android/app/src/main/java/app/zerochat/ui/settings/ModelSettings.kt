package app.zerochat.ui.settings

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import app.zerochat.ai.AiClient
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.security.SecretStore
import app.zerochat.ui.NativeI18n

@Composable
internal fun ModelSettings(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot) -> Unit,
    secretStore: SecretStore,
    aiClient: AiClient,
    onNotice: (String, SettingsNoticeKind) -> Unit,
    i18n: NativeI18n,
    providerDisplayName: (ProviderConfig) -> String,
    providerRequest: (ProviderConfig, AppSnapshot) -> ProviderConfig,
) {
    var selectedProviderId by remember {
        mutableStateOf(snapshot.providers.firstOrNull()?.id.orEmpty())
    }
    val stableSelectedProviderId = modelSettingsStableSelectedProviderId(
        selectedProviderId,
        snapshot.providers,
    )
    LaunchedEffect(stableSelectedProviderId) {
        if (selectedProviderId != stableSelectedProviderId) {
            selectedProviderId = stableSelectedProviderId
        }
    }
    val provider = snapshot.providers.firstOrNull { it.id == stableSelectedProviderId }

    SettingsCard(i18n.t("setting.models")) {
        ModelProviderPicker(
            providers = snapshot.providers,
            selectedProviderId = provider?.id.orEmpty(),
            i18n = i18n,
            providerDisplayName = providerDisplayName,
            onSelected = { selectedProviderId = it },
        )
        if (provider == null) {
            Text(i18n.t("message.addProviderFirst"))
            return@SettingsCard
        }

        ModelDefaultChoices(
            snapshot = snapshot,
            provider = provider,
            onSnapshotChange = onSnapshotChange,
            i18n = i18n,
        )
        ModelCatalogEditor(
            snapshot = snapshot,
            provider = provider,
            onSnapshotChange = onSnapshotChange,
            onSnapshotReduce = onSnapshotReduce,
            secretStore = secretStore,
            aiClient = aiClient,
            onNotice = onNotice,
            i18n = i18n,
            providerRequest = providerRequest,
        )
    }
}
