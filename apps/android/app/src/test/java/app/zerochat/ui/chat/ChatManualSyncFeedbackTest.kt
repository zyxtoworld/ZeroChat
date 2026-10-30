package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ChatManualSyncFeedbackTest {
    @Test
    fun manualCloudSyncBlockerMessageKeyPreservesUserFacingSetupReasons() {
        assertEquals("message.generating", manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.Generating))
        assertEquals("sync.requirement.local", manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.LocalOnly))
        assertEquals(
            "message.dataPasswordRequired",
            manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.SyncPasswordRequired),
        )
        assertEquals(
            "error.syncGithubTokenRequired",
            manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.GithubTokenRequired),
        )
        assertEquals(
            "message.cloudflareWorkerRequired",
            manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.CloudflareWorkerRequired),
        )
        assertEquals(
            "message.dataPasswordRequired",
            manualCloudSyncBlockerMessageKey(ManualCloudSyncBlocker.CloudflareAccessKeyRequired),
        )
    }

    @Test
    fun manualCloudSyncStatusNoticeUsesSuccessOnlyForCompletedStatuses() {
        val complete = manualCloudSyncStatusNotice(null) { status -> "localized $status" }
        val restored = manualCloudSyncStatusNotice("Remote data restored") { status -> "localized $status" }
        val warning = manualCloudSyncStatusNotice("Waiting for manual refresh smoke") { status ->
            "localized $status"
        }

        assertEquals("localized Sync complete", complete.message)
        assertEquals(NoticeKind.Success, complete.kind)
        assertEquals("localized Remote data restored", restored.message)
        assertEquals(NoticeKind.Success, restored.kind)
        assertEquals("localized Waiting for manual refresh smoke", warning.message)
        assertEquals(NoticeKind.Warning, warning.kind)
    }

    @Test
    fun settingsManualSyncNoticeDefersPersistedFirstSyncConflictToItsActionSection() {
        val conflict = manualCloudSyncSettingsStatusNotice(
            status = "Local and cloud both have data. Choose local, cloud, or merge before syncing.",
            isFirstSyncConflict = true,
            syncStatusMessage = { status -> "localized $status" },
        )
        val complete = manualCloudSyncSettingsStatusNotice(
            status = "Sync complete",
            isFirstSyncConflict = false,
            syncStatusMessage = { status -> "localized $status" },
        )

        assertNull(conflict)
        assertEquals("localized Sync complete", complete?.message)
        assertEquals(NoticeKind.Success, complete?.kind)
    }

    @Test
    fun manualCloudSyncErrorNoticeKeepsReadableErrorFallbacks() {
        val explicit = manualCloudSyncErrorNotice(IllegalStateException("Worker down")) { value ->
            "error: $value"
        }
        val fallback = manualCloudSyncErrorNotice(IllegalArgumentException()) { value ->
            "error: $value"
        }

        assertEquals("error: Worker down", explicit.message)
        assertEquals(NoticeKind.Error, explicit.kind)
        assertEquals("error: IllegalArgumentException", fallback.message)
        assertEquals(NoticeKind.Error, fallback.kind)
    }

    @Test
    fun manualSyncActionStaysDisabledWhileSyncIsRunningEvenIfSnapshotIsLocal() {
        assertEquals(
            false,
            manualSyncActionEnabled(
                manualSyncRunning = true,
                cloudSyncConfigured = false,
                manualSyncBlockedReason = null,
            ),
        )
    }

    @Test
    fun manualSyncActionRequiresNoBlockerWhenCloudSyncIsConfigured() {
        assertEquals(
            true,
            manualSyncActionEnabled(
                manualSyncRunning = false,
                cloudSyncConfigured = true,
                manualSyncBlockedReason = null,
            ),
        )
        assertEquals(
            false,
            manualSyncActionEnabled(
                manualSyncRunning = false,
                cloudSyncConfigured = true,
                manualSyncBlockedReason = "Setup required",
            ),
        )
    }

    @Test
    fun manualSyncActionRemainsAvailableForOpeningCloudSyncSettings() {
        assertEquals(
            true,
            manualSyncActionEnabled(
                manualSyncRunning = false,
                cloudSyncConfigured = false,
                manualSyncBlockedReason = "Local-only mode",
            ),
        )
    }

    @Test
    fun cloudSyncStatusDoesNotRepeatItsCurrentBlocker() {
        assertEquals(
            false,
            shouldShowCloudSyncBlockedReason(
                syncStatus = "Data encryption password is required.",
                blockedReason = "Data encryption password is required.",
            ),
        )
        assertEquals(
            true,
            shouldShowCloudSyncBlockedReason(
                syncStatus = "Sync complete",
                blockedReason = "Data encryption password is required.",
            ),
        )
        assertEquals(
            false,
            shouldShowCloudSyncBlockedReason(
                syncStatus = "Sync complete",
                blockedReason = null,
            ),
        )
    }
}
