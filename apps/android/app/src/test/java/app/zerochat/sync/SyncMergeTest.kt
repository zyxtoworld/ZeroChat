package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageRole
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SkillSettings
import app.zerochat.data.SyncConfig
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncMergeTest {
    @Test
    fun acceptRemoteVaultKeepsLocalSyncControlsAndMarksRestoreStatus() {
        val remote = SyncVault(
            data = AppSnapshot(
                conversations = listOf(conversation("remote", 20)),
                sync = SyncConfig(
                    mode = "cloudflare",
                    autoSync = false,
                    gistId = "remote-gist",
                    gistFile = "remote.json",
                    workerEndpoint = "https://remote.example.workers.dev",
                ),
                updatedAt = 20,
            ),
        )
        val local = AppSnapshot(
            sync = SyncConfig(
                mode = "gist",
                autoSync = true,
                gistId = "local-gist",
                gistFile = "local.json",
                workerEndpoint = "https://local.example.workers.dev",
            ),
        )

        val accepted = acceptRemoteVault(remote, local, now = 123)

        assertEquals(listOf("remote"), accepted.data.conversations.map { it.id })
        assertEquals("gist", accepted.data.sync.mode)
        assertTrue(accepted.data.sync.autoSync)
        assertTrue(accepted.data.sync.encryptionEnabled)
        assertEquals("local-gist", accepted.data.sync.gistId)
        assertEquals("local.json", accepted.data.sync.gistFile)
        assertEquals("https://local.example.workers.dev", accepted.data.sync.workerEndpoint)
        assertEquals(123, accepted.data.sync.lastSyncAt)
        assertEquals("Remote data restored", accepted.data.sync.lastSyncStatus)
    }

    @Test
    fun acceptGistRemoteVaultUsesResolvedGistAndRequestedFile() {
        val remote = SyncVault(
            data = AppSnapshot(
                sync = SyncConfig(mode = "local", gistId = "remote-gist"),
                updatedAt = 20,
            ),
        )
        val local = AppSnapshot(
            sync = SyncConfig(mode = "gist", autoSync = true, gistId = "local-gist", gistFile = "local.json"),
        )

        val accepted = acceptGistRemoteVault(remote, local, gistId = "resolved-gist", gistFile = "zerochat.json", now = 321)

        assertEquals("gist", accepted.data.sync.mode)
        assertTrue(accepted.data.sync.autoSync)
        assertEquals("resolved-gist", accepted.data.sync.gistId)
        assertEquals("zerochat.json", accepted.data.sync.gistFile)
        assertEquals(321, accepted.data.sync.lastSyncAt)
        assertEquals("Remote data restored", accepted.data.sync.lastSyncStatus)
    }

    @Test
    fun withGistSyncConfigWritesEncryptedGistStatusWithoutTouchingVaultContent() {
        val vault = SyncVault(
            data = AppSnapshot(
                conversations = listOf(conversation("local", 5)),
                sync = SyncConfig(mode = "local"),
                updatedAt = 5,
            ),
        )

        val updated = vault.withGistSyncConfig(
            gistId = "gist-1",
            gistFile = "vault.json",
            status = "Sync complete",
            now = 456,
        )

        assertEquals(listOf("local"), updated.data.conversations.map { it.id })
        assertEquals("gist", updated.data.sync.mode)
        assertTrue(updated.data.sync.encryptionEnabled)
        assertEquals("gist-1", updated.data.sync.gistId)
        assertEquals("vault.json", updated.data.sync.gistFile)
        assertEquals(456, updated.data.sync.lastSyncAt)
        assertEquals("Sync complete", updated.data.sync.lastSyncStatus)
    }

    @Test
    fun mergeFirstSyncVaultKeepsNewestRecordsLocalPreferencesAndLocalSecrets() {
        val remote = SyncVault(
            data = AppSnapshot(
                providers = listOf(
                    provider("shared-provider", "remote-model", updatedAt = 10),
                    provider("remote-provider", "remote-only", updatedAt = 20),
                ),
                conversations = listOf(
                    conversation("shared-conversation", 20),
                    conversation("remote-conversation", 30),
                ),
                skills = listOf(
                    skill("shared-skill", "Remote", updatedAt = 10),
                    skill("remote-skill", "Remote only", updatedAt = 30),
                ),
                skillSettings = SkillSettings(autoMatch = false, contextBudget = 1200, maxAutoSkills = 2),
                preferences = Preferences(language = "fr-FR"),
                updatedAt = 80,
            ),
            secrets = ProviderSecrets(
                providerKeys = mapOf(
                    "shared-provider" to "remote-key",
                    "remote-provider" to "remote-only-key",
                ),
            ),
        )
        val local = SyncVault(
            data = AppSnapshot(
                providers = listOf(
                    provider("shared-provider", "local-model", updatedAt = 60),
                    provider("local-provider", "local-only", updatedAt = 40),
                ),
                conversations = listOf(
                    conversation("shared-conversation", 50),
                    conversation("local-conversation", 40),
                ),
                skills = listOf(
                    skill("shared-skill", "Local", updatedAt = 70),
                    skill("local-skill", "Local only", updatedAt = 40),
                ),
                skillSettings = SkillSettings(contextBudget = 3200),
                preferences = Preferences(language = "zh-CN", compactMode = true),
                updatedAt = 70,
            ),
            secrets = ProviderSecrets(
                providerKeys = mapOf(
                    "shared-provider" to "local-key",
                    "local-provider" to "local-only-key",
                ),
            ),
        )

        val merged = mergeFirstSyncVault(remote, local, now = 100)

        assertEquals(
            listOf("shared-conversation", "local-conversation", "remote-conversation"),
            merged.data.conversations.map { it.id },
        )
        assertEquals("local-model", merged.data.providers.first { it.id == "shared-provider" }.model)
        assertEquals(
            listOf("shared-provider", "remote-provider", "local-provider"),
            merged.data.providers.map { it.id },
        )
        assertEquals(
            listOf("shared-skill", "local-skill", "remote-skill"),
            merged.data.skills.map { it.id },
        )
        assertEquals("Local", merged.data.skills.first { it.id == "shared-skill" }.name)
        assertEquals(false, merged.data.skillSettings.autoMatch)
        assertEquals(3200, merged.data.skillSettings.contextBudget)
        assertEquals(2, merged.data.skillSettings.maxAutoSkills)
        assertEquals("zh-CN", merged.data.preferences.language)
        assertTrue(merged.data.preferences.compactMode)
        assertEquals(100, merged.data.updatedAt)
        assertEquals("local-key", merged.secrets.providerKeys["shared-provider"])
        assertEquals("remote-only-key", merged.secrets.providerKeys["remote-provider"])
        assertEquals("local-only-key", merged.secrets.providerKeys["local-provider"])
    }

    @Test
    fun mergeCompletedSyncVaultKeepsOfflineLocalSkillWhenRemoteHeadIsNewer() {
        val remote = SyncVault(
            data = AppSnapshot(
                skills = listOf(skill("remote-skill", "Remote skill", updatedAt = 90)),
                sync = SyncConfig(
                    mode = "cloudflare",
                    autoSync = true,
                    workerEndpoint = "https://sync.example.workers.dev",
                    lastSyncAt = 80,
                ),
                updatedAt = 120,
            ),
            secrets = ProviderSecrets(providerKeys = mapOf("remote-provider" to "remote-key")),
        )
        val local = SyncVault(
            data = AppSnapshot(
                skills = listOf(skill("offline-skill", "Offline Skill", updatedAt = 110)),
                sync = SyncConfig(
                    mode = "cloudflare",
                    autoSync = true,
                    workerEndpoint = "https://sync.example.workers.dev",
                    lastSyncAt = 100,
                    lastSyncStatus = "Sync complete",
                ),
                updatedAt = 110,
            ),
            secrets = ProviderSecrets(providerKeys = mapOf("local-provider" to "local-key")),
        )

        val merged = mergeCompletedSyncVault(remote, local, now = 130)

        assertEquals(
            listOf("offline-skill", "remote-skill"),
            merged.data.skills.map { it.id },
        )
        assertEquals("cloudflare", merged.data.sync.mode)
        assertTrue(merged.data.sync.autoSync)
        assertEquals("https://sync.example.workers.dev", merged.data.sync.workerEndpoint)
        assertEquals(130, merged.data.sync.lastSyncAt)
        assertEquals("Merged local and cloud changes", merged.data.sync.lastSyncStatus)
        assertEquals(130, merged.data.updatedAt)
        assertEquals("remote-key", merged.secrets.providerKeys["remote-provider"])
        assertEquals("local-key", merged.secrets.providerKeys["local-provider"])
    }

    @Test
    fun hasUnsyncedLocalChangesUsesThePreSyncSnapshotTimestamp() {
        assertTrue(
            hasUnsyncedLocalChanges(
                AppSnapshot(
                    sync = SyncConfig(lastSyncAt = 100),
                    updatedAt = 101,
                ),
            ),
        )
        assertFalse(
            hasUnsyncedLocalChanges(
                AppSnapshot(
                    sync = SyncConfig(lastSyncAt = 100),
                    updatedAt = 100,
                ),
            ),
        )
    }

    @Test
    fun providerKeyReplacementsForSyncedVaultClearsMissingLocalAndDefaultProviderSecrets() {
        val local = AppSnapshot(
            providers = listOf(
                provider("old-provider", "old-model", updatedAt = 10),
                provider("shared-provider", "local-model", updatedAt = 20),
            ),
        )
        val synced = AppSnapshot(
            providers = listOf(
                provider("shared-provider", "remote-model", updatedAt = 30),
                provider("new-provider", "new-model", updatedAt = 40),
            ),
        )

        val replacements = providerKeyReplacementsForSyncedVault(
            local = local,
            synced = synced,
            providerKeys = mapOf(
                "shared-provider" to "remote-shared-key",
                "new-provider" to "remote-new-key",
                "orphan-provider" to "orphan-key",
            ),
        )

        assertEquals("remote-shared-key", replacements["shared-provider"])
        assertEquals("remote-new-key", replacements["new-provider"])
        assertEquals("", replacements["old-provider"])
        assertEquals("", replacements["openai"])
        assertFalse(replacements.containsKey("orphan-provider"))
    }

    private fun provider(id: String, model: String, updatedAt: Long): ProviderConfig = ProviderConfig(
        id = id,
        name = id,
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.com/v1",
        model = model,
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = updatedAt,
    )

    private fun conversation(id: String, updatedAt: Long): Conversation = Conversation(
        id = id,
        title = id,
        providerId = "provider-1",
        model = "gpt-4o",
        messages = listOf(
            ChatMessage(
                id = "$id-message",
                role = MessageRole.User,
                content = id,
                createdAt = updatedAt,
            ),
        ),
        createdAt = 1,
        updatedAt = updatedAt,
    )

    private fun skill(id: String, name: String, updatedAt: Long): UserSkill = UserSkill(
        id = id,
        name = name,
        chunks = listOf(
            UserSkillChunk(
                id = "$id-chunk",
                heading = "Body",
                content = name,
                tokenEstimate = 1,
            ),
        ),
        createdAt = 1,
        updatedAt = updatedAt,
    )
}
