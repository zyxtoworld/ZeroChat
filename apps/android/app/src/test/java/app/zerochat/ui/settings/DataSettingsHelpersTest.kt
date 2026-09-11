package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.SyncConfig
import app.zerochat.ui.NativeI18n
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class DataSettingsHelpersTest {
    @Test
    fun dataSettingsProviderKeysForBackupKeepsOnlyNonBlankProviderSecrets() {
        val snapshot = AppSnapshot(
            providers = listOf(
                provider("openai"),
                provider("empty"),
                provider("missing"),
                provider("custom"),
            ),
        )
        val keys = mapOf(
            "openai" to "sk-openai",
            "empty" to "",
            "custom" to "  sk-custom  ",
        )

        val backupKeys = dataSettingsProviderKeysForBackup(snapshot) { providerId ->
            keys[providerId].orEmpty()
        }

        assertEquals(
            mapOf(
                "openai" to "sk-openai",
                "custom" to "  sk-custom  ",
            ),
            backupKeys,
        )
    }

    @Test
    fun dataSettingsProviderIdsForImportCoversRemovedImportedAndDefaultProviders() {
        val previous = AppSnapshot(
            providers = listOf(provider("old"), provider("shared")),
        )
        val imported = AppSnapshot(
            providers = listOf(provider("shared"), provider("new")),
        )
        val defaults = listOf(provider("openai"), provider("new"))

        assertEquals(
            setOf("old", "shared", "new", "openai"),
            dataSettingsProviderIdsForImport(previous, imported, defaults),
        )
    }

    @Test
    fun dataSettingsEmptySnapshotRestoresLocalFirstRunDefaults() {
        val snapshot = dataSettingsEmptySnapshot(
            customOpenAiRelayName = "Custom relay",
            now = 1234,
        )

        assertEquals(1, snapshot.version)
        assertTrue(snapshot.preferences.firstRunDone)
        assertEquals("local", snapshot.sync.mode)
        assertEquals(false, snapshot.sync.autoSync)
        assertTrue(snapshot.sync.encryptionEnabled)
        assertEquals(emptyList<app.zerochat.data.Conversation>(), snapshot.conversations)
        assertEquals(emptyList<app.zerochat.data.UserSkill>(), snapshot.skills)
        assertEquals(1234, snapshot.updatedAt)
        assertTrue(snapshot.providers.any { it.id == "openai" })
        assertEquals(
            "Custom relay",
            snapshot.providers.first { it.id == "custom-openai" }.name,
        )
        assertFalse(snapshot.providers.any { it.name.isBlank() })
    }

    @Test
    fun dataSettingsCloudClearRequestBlocksLocalMode() {
        val request = dataSettingsCloudClearRequest(
            AppSnapshot(sync = SyncConfig(mode = "local")),
            githubToken = "gh-token",
            cloudflareAccessKey = "cf-key",
        )

        val blocked = assertInstanceOf(DataSettingsCloudClearRequest.Blocked::class.java, request)
        assertEquals("sync.requirement.local", blocked.noticeKey)
    }

    @Test
    fun dataSettingsCloudClearRequestRequiresCloudflareEndpointAndAccessKey() {
        val missingEndpoint = dataSettingsCloudClearRequest(
            AppSnapshot(sync = SyncConfig(mode = "cloudflare")),
            githubToken = "",
            cloudflareAccessKey = "cf-key",
        )
        val missingKey = dataSettingsCloudClearRequest(
            AppSnapshot(sync = SyncConfig(mode = "cloudflare", workerEndpoint = "https://worker.example.com")),
            githubToken = "",
            cloudflareAccessKey = "",
        )
        val ready = dataSettingsCloudClearRequest(
            AppSnapshot(sync = SyncConfig(mode = "cloudflare", workerEndpoint = "https://worker.example.com")),
            githubToken = "",
            cloudflareAccessKey = "cf-key",
        )

        assertEquals(
            "message.cloudflareWorkerAndPasswordRequired",
            assertInstanceOf(DataSettingsCloudClearRequest.Blocked::class.java, missingEndpoint).noticeKey,
        )
        assertEquals(
            "message.cloudflareWorkerAndPasswordRequired",
            assertInstanceOf(DataSettingsCloudClearRequest.Blocked::class.java, missingKey).noticeKey,
        )
        val cloudflare = assertInstanceOf(DataSettingsCloudClearRequest.Cloudflare::class.java, ready)
        assertEquals("https://worker.example.com", cloudflare.endpoint)
        assertEquals("cf-key", cloudflare.accessKey)
    }

    @Test
    fun dataSettingsCloudClearRequestRequiresGistTokenAndKeepsGistConfig() {
        val snapshot = AppSnapshot(
            sync = SyncConfig(
                mode = "gist",
                gistId = "abc123",
                gistFile = "zerochat-sync.json",
            ),
        )

        val missingToken = dataSettingsCloudClearRequest(snapshot, githubToken = "", cloudflareAccessKey = "")
        val ready = dataSettingsCloudClearRequest(snapshot, githubToken = "gh-token", cloudflareAccessKey = "")

        assertEquals(
            "error.syncGithubTokenRequired",
            assertInstanceOf(DataSettingsCloudClearRequest.Blocked::class.java, missingToken).noticeKey,
        )
        val gist = assertInstanceOf(DataSettingsCloudClearRequest.Gist::class.java, ready)
        assertEquals("abc123", gist.gistId)
        assertEquals("zerochat-sync.json", gist.gistFile)
        assertEquals("gh-token", gist.token)
    }

    @Test
    fun backupFailureNoticeUsesLocalizedCopyWithoutExceptionText() {
        val sentinel =
            "C:\\private\\backup\\secret.json /home/runner/.config/token https://provider.invalid/v1 " +
                "sk-test-not-a-real-key"
        val zh = NativeI18n.forMode("zh-CN")
        val en = NativeI18n.forMode("en-US")

        val exportNotice = backupFailureNotice(zh, BackupOperation.Export)
        val importNotice = backupFailureNotice(en, BackupOperation.Import)

        assertEquals(zh.t("notice.backupExportFailedPrefix"), exportNotice)
        assertEquals(en.t("notice.backupImportFailedPrefix"), importNotice)
        assertFalse(exportNotice.contains(sentinel))
        assertFalse(importNotice.contains(sentinel))
    }

    private fun provider(id: String): ProviderConfig = ProviderConfig(
        id = id,
        name = id,
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.com/v1",
        model = "gpt-4o-mini",
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )
}
