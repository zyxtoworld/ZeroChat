package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SkillSettings
import app.zerochat.data.SyncConfig
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill

internal fun acceptRemoteVault(
    remote: SyncVault,
    local: AppSnapshot,
    now: Long = System.currentTimeMillis(),
): SyncVault =
    remote.copy(data = remote.data.copy(sync = mergeSyncConfig(remote.data.sync, local.sync, now)))

internal fun acceptGistRemoteVault(
    remote: SyncVault,
    local: AppSnapshot,
    gistId: String?,
    gistFile: String,
    now: Long = System.currentTimeMillis(),
): SyncVault {
    val accepted = acceptRemoteVault(remote, local, now)
    return accepted.copy(
        data = accepted.data.copy(
            sync = accepted.data.sync.copy(
                mode = "gist",
                autoSync = local.sync.autoSync,
                gistId = gistId ?: local.sync.gistId ?: remote.data.sync.gistId,
                gistFile = gistFile,
            ),
        ),
    )
}

internal fun SyncVault.withGistSyncConfig(
    gistId: String?,
    gistFile: String,
    status: String,
    now: Long = System.currentTimeMillis(),
): SyncVault =
    copy(
        data = data.copy(
            sync = data.sync.copy(
                mode = "gist",
                encryptionEnabled = true,
                gistId = gistId,
                gistFile = gistFile,
                lastSyncAt = now,
                lastSyncStatus = status,
            ),
        ),
    )

internal fun mergeSyncConfig(
    remote: SyncConfig,
    local: SyncConfig,
    now: Long = System.currentTimeMillis(),
): SyncConfig =
    remote.copy(
        mode = local.mode.ifBlank { remote.mode },
        autoSync = local.autoSync,
        encryptionEnabled = true,
        gistId = local.gistId ?: remote.gistId,
        gistFile = local.gistFile.ifBlank { remote.gistFile },
        workerEndpoint = local.workerEndpoint ?: remote.workerEndpoint,
        lastSyncAt = now,
        lastSyncStatus = "Remote data restored",
    )

internal fun mergeFirstSyncVault(
    remote: SyncVault,
    local: SyncVault,
    now: Long = System.currentTimeMillis(),
): SyncVault {
    val conversations = mergeRecords(remote.data.conversations, local.data.conversations) { it.id }
        .sortedByDescending { it.updatedAt }
    val providers = mergeProviders(remote.data.providers, local.data.providers)
    val skills = mergeRecords(remote.data.skills, local.data.skills) { it.id }
        .sortedByDescending { it.updatedAt }

    return SyncVault(
        data = local.data.copy(
            providers = providers,
            conversations = conversations,
            skills = skills,
            skillSettings = mergeSkillSettings(remote.data.skillSettings, local.data.skillSettings),
            preferences = local.data.preferences,
            updatedAt = maxOf(remote.data.updatedAt, local.data.updatedAt, now),
        ),
        secrets = ProviderSecrets(
            providerKeys = remote.secrets.providerKeys + local.secrets.providerKeys,
        ),
    )
}

internal fun mergeCompletedSyncVault(
    remote: SyncVault,
    local: SyncVault,
    now: Long = System.currentTimeMillis(),
): SyncVault {
    val merged = mergeFirstSyncVault(remote, local, now)
    return merged.copy(
        data = merged.data.copy(
            sync = local.data.sync.copy(
                encryptionEnabled = true,
                lastSyncAt = now,
                lastSyncStatus = "Merged local and cloud changes",
            ),
            updatedAt = maxOf(merged.data.updatedAt, now),
        ),
    )
}

internal fun hasUnsyncedLocalChanges(snapshot: AppSnapshot): Boolean =
    snapshot.updatedAt > (snapshot.sync.lastSyncAt ?: 0L)

private fun mergeProviders(
    remote: List<ProviderConfig>,
    local: List<ProviderConfig>,
): List<ProviderConfig> =
    mergeRecords(remote, local) { it.id }

private fun mergeSkillSettings(remote: SkillSettings, local: SkillSettings): SkillSettings {
    val defaults = SkillSettings()
    return SkillSettings(
        autoMatch = if (local.autoMatch != defaults.autoMatch) local.autoMatch else remote.autoMatch,
        contextBudget = if (local.contextBudget != defaults.contextBudget) local.contextBudget else remote.contextBudget,
        maxAutoSkills = if (local.maxAutoSkills != defaults.maxAutoSkills) local.maxAutoSkills else remote.maxAutoSkills,
    )
}

private fun <T> mergeRecords(remote: List<T>, local: List<T>, id: (T) -> String): List<T>
    where T : Any {
    val merged = linkedMapOf<String, T>()
    remote.forEach { merged[id(it)] = it }
    local.forEach { item ->
        val key = id(item)
        val existing = merged[key]
        merged[key] = if (existing == null || updatedAt(item) >= updatedAt(existing)) {
            item
        } else {
            existing
        }
    }
    return merged.values.toList()
}

private fun updatedAt(value: Any): Long =
    when (value) {
        is Conversation -> value.updatedAt
        is ProviderConfig -> value.updatedAt
        is UserSkill -> value.updatedAt
        else -> 0L
    }
