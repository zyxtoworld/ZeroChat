package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderConfig
import app.zerochat.data.SkillSettings
import app.zerochat.data.SyncConfig
import app.zerochat.data.defaultProviderConfigs

fun dataSettingsProviderKeysForBackup(
    snapshot: AppSnapshot,
    providerKey: (String) -> String,
): Map<String, String> =
    snapshot.providers
        .mapNotNull { provider ->
            val value = providerKey(provider.id)
            if (value.isBlank()) null else provider.id to value
        }
        .toMap()

fun dataSettingsProviderIdsForImport(
    previous: AppSnapshot,
    imported: AppSnapshot,
    defaultProviders: List<ProviderConfig>,
): Set<String> {
    val providerIds = previous.providers.map { it.id } +
        imported.providers.map { it.id } +
        defaultProviders.map { it.id }

    return providerIds.toSet()
}

fun dataSettingsEmptySnapshot(
    customOpenAiRelayName: String,
    now: Long,
): AppSnapshot = AppSnapshot(
    providers = defaultProviderConfigs(customOpenAiRelayName),
    conversations = emptyList(),
    skills = emptyList(),
    skillSettings = SkillSettings(),
    sync = SyncConfig(mode = "local", autoSync = false, encryptionEnabled = true),
    preferences = Preferences(firstRunDone = true),
    updatedAt = now,
)

sealed class DataSettingsCloudClearRequest {
    data class Cloudflare(
        val endpoint: String,
        val accessKey: String,
    ) : DataSettingsCloudClearRequest()

    data class Gist(
        val gistId: String?,
        val gistFile: String,
        val token: String,
    ) : DataSettingsCloudClearRequest()

    data class Blocked(
        val noticeKey: String,
    ) : DataSettingsCloudClearRequest()
}

fun dataSettingsCloudClearRequest(
    snapshot: AppSnapshot,
    githubToken: String,
    cloudflareAccessKey: String,
): DataSettingsCloudClearRequest =
    when (snapshot.sync.mode) {
        "cloudflare" -> {
            val endpoint = snapshot.sync.workerEndpoint.orEmpty()
            if (endpoint.isBlank() || cloudflareAccessKey.isBlank()) {
                DataSettingsCloudClearRequest.Blocked("message.cloudflareWorkerAndPasswordRequired")
            } else {
                DataSettingsCloudClearRequest.Cloudflare(endpoint, cloudflareAccessKey)
            }
        }

        "gist" -> {
            if (githubToken.isBlank()) {
                DataSettingsCloudClearRequest.Blocked("error.syncGithubTokenRequired")
            } else {
                DataSettingsCloudClearRequest.Gist(
                    gistId = snapshot.sync.gistId,
                    gistFile = snapshot.sync.gistFile,
                    token = githubToken,
                )
            }
        }

        else -> DataSettingsCloudClearRequest.Blocked("sync.requirement.local")
    }
