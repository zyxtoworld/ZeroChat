package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SyncConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncSettingsHelpersTest {
    @Test
    fun syncSettingsSelectModeEnablesAutoSyncOnlyForCloudModesAndClearsOldStatus() {
        val snapshot = snapshot(sync = SyncConfig(mode = "local", lastSyncAt = 10, lastSyncStatus = "old"))

        val cloudflare = syncSettingsSelectMode(snapshot, "cloudflare")
        val local = syncSettingsSelectMode(cloudflare, "local")

        assertEquals("cloudflare", cloudflare.sync.mode)
        assertTrue(cloudflare.sync.autoSync)
        assertNull(cloudflare.sync.lastSyncAt)
        assertNull(cloudflare.sync.lastSyncStatus)
        assertEquals("local", local.sync.mode)
        assertFalse(local.sync.autoSync)
    }

    @Test
    fun syncSettingsSetAutoSyncPreservesCloudConfigurationAndClearsOldStatus() {
        val snapshot = snapshot(
            sync = SyncConfig(
                mode = "cloudflare",
                autoSync = true,
                workerEndpoint = "https://worker.example.com",
                lastSyncAt = 10,
                lastSyncStatus = "old",
            ),
        )

        val disabled = syncSettingsSetAutoSync(snapshot, false)

        assertFalse(disabled.sync.autoSync)
        assertEquals("cloudflare", disabled.sync.mode)
        assertEquals("https://worker.example.com", disabled.sync.workerEndpoint)
        assertNull(disabled.sync.lastSyncAt)
        assertNull(disabled.sync.lastSyncStatus)
    }

    @Test
    fun syncSettingsSetAutoSyncKeepsLocalModeManualOnly() {
        val snapshot = snapshot(sync = SyncConfig(mode = "local", autoSync = false))

        val enabled = syncSettingsSetAutoSync(snapshot, true)

        assertFalse(enabled.sync.autoSync)
        assertEquals("local", enabled.sync.mode)
    }

    @Test
    fun syncSettingsGistFieldsNormalizeBlankValuesAndClearOldStatus() {
        val snapshot = snapshot(
            sync = SyncConfig(
                mode = "gist",
                gistId = "old",
                gistFile = "old.json",
                lastSyncAt = 10,
                lastSyncStatus = "old",
            ),
        )

        val gistId = syncSettingsUpdateGistId(snapshot, "")
        val gistFile = syncSettingsUpdateGistFile(snapshot, "")

        assertNull(gistId.sync.gistId)
        assertNull(gistId.sync.lastSyncAt)
        assertNull(gistId.sync.lastSyncStatus)
        assertEquals("zerochat-sync.json", gistFile.sync.gistFile)
        assertNull(gistFile.sync.lastSyncAt)
        assertNull(gistFile.sync.lastSyncStatus)

        val pastedGistId = syncSettingsUpdateGistId(snapshot, "  abc123  ")
        val pastedGistFile = syncSettingsUpdateGistFile(snapshot, "  team-sync.json  ")

        assertEquals("abc123", pastedGistId.sync.gistId)
        assertEquals("team-sync.json", pastedGistFile.sync.gistFile)
    }

    @Test
    fun syncSettingsCloudflareEndpointNormalizesBlankValueAndClearsOldStatus() {
        val snapshot = snapshot(
            sync = SyncConfig(
                mode = "cloudflare",
                workerEndpoint = "https://worker.example.com",
                lastSyncAt = 10,
                lastSyncStatus = "old",
            ),
        )

        val updated = syncSettingsUpdateCloudflareEndpoint(snapshot, "")
        val pasted = syncSettingsUpdateCloudflareEndpoint(snapshot, "  https://worker.example.com  ")

        assertNull(updated.sync.workerEndpoint)
        assertNull(updated.sync.lastSyncAt)
        assertNull(updated.sync.lastSyncStatus)
        assertEquals("https://worker.example.com", pasted.sync.workerEndpoint)
    }

    @Test
    fun syncSettingsManualBlockerKeyReflectsCurrentCloudConfig() {
        val local = snapshot(sync = SyncConfig(mode = "local"))
        val cloudMissingPassword = snapshot(
            sync = SyncConfig(mode = "cloudflare", workerEndpoint = "https://worker.example.com"),
        )
        val cloudMissingEndpoint = snapshot(sync = SyncConfig(mode = "cloudflare"))
        val cloudMissingAccessKey = snapshot(
            sync = SyncConfig(mode = "cloudflare", workerEndpoint = "https://worker.example.com"),
        )
        val cloudReady = snapshot(
            sync = SyncConfig(mode = "cloudflare", workerEndpoint = "https://worker.example.com"),
        )

        assertEquals(
            "sync.requirement.local",
            syncSettingsManualBlockerKey(
                local,
                hasSyncPassphrase = true,
                hasGithubToken = false,
                hasCloudflareAccessKey = false,
            ),
        )
        assertEquals(
            "message.dataPasswordRequired",
            syncSettingsManualBlockerKey(
                cloudMissingPassword,
                hasSyncPassphrase = false,
                hasGithubToken = false,
                hasCloudflareAccessKey = false,
            ),
        )
        assertEquals(
            "message.cloudflareWorkerRequired",
            syncSettingsManualBlockerKey(
                cloudMissingEndpoint,
                hasSyncPassphrase = true,
                hasGithubToken = false,
                hasCloudflareAccessKey = true,
            ),
        )
        assertEquals(
            "message.dataPasswordRequired",
            syncSettingsManualBlockerKey(
                cloudMissingAccessKey,
                hasSyncPassphrase = true,
                hasGithubToken = false,
                hasCloudflareAccessKey = false,
            ),
        )
        assertNull(
            syncSettingsManualBlockerKey(
                cloudReady,
                hasSyncPassphrase = true,
                hasGithubToken = false,
                hasCloudflareAccessKey = true,
            ),
        )
    }

    @Test
    fun syncSettingsFirstSyncConflictMatchesRawOrLocalizedStatus() {
        val raw = SyncConfig(
            lastSyncStatus = "Local and cloud both have data. Choose local, cloud, or merge before syncing.",
        )
        val localized = SyncConfig(lastSyncStatus = "translated-by-i18n")
        val other = SyncConfig(lastSyncStatus = "Sync complete")

        assertTrue(
            syncSettingsIsFirstSyncConflict(
                raw,
                syncStatusMessage = { it.orEmpty() },
                localizedConflictMessage = "First sync conflict",
            ),
        )
        assertTrue(
            syncSettingsIsFirstSyncConflict(
                localized,
                syncStatusMessage = { "First sync conflict" },
                localizedConflictMessage = "First sync conflict",
            ),
        )
        assertFalse(
            syncSettingsIsFirstSyncConflict(
                other,
                syncStatusMessage = { it.orEmpty() },
                localizedConflictMessage = "First sync conflict",
            ),
        )
    }

    @Test
    fun syncSettingsStatusPresentationDoesNotRepeatFirstSyncConflictAsGeneralStatus() {
        val conflict = syncSettingsStatusPresentation(
            sync = SyncConfig(
                lastSyncStatus = "Local and cloud both have data. Choose local, cloud, or merge before syncing.",
            ),
            syncStatusMessage = { "localized $it" },
            localizedConflictMessage = "First sync conflict",
        )
        val complete = syncSettingsStatusPresentation(
            sync = SyncConfig(lastSyncStatus = "Sync complete"),
            syncStatusMessage = { "localized $it" },
            localizedConflictMessage = "First sync conflict",
        )

        assertTrue(conflict.isFirstSyncConflict)
        assertNull(conflict.statusMessage)
        assertFalse(complete.isFirstSyncConflict)
        assertEquals("localized Sync complete", complete.statusMessage)
    }

    private fun snapshot(sync: SyncConfig): AppSnapshot = AppSnapshot(
        sync = sync,
        updatedAt = 1,
    )
}
