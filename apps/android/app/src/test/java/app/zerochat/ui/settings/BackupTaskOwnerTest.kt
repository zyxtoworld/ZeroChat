package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Preferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.withLock
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class BackupTaskOwnerTest {
    @Test
    fun importRequestSurvivesCollectorCancellation() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = BackupTaskOwner(scope)
        val snapshot = AppSnapshot(
            preferences = Preferences(theme = "dark"),
            updatedAt = 100,
        )
        val result = scope.async {
            owner.requestImport(snapshot, mapOf("openai" to "masked-test-key"))
        }
        val request = owner.importRequests
            .mapNotNull { requests -> requests.singleOrNull() }
            .first()
        val firstCollector = scope.launch {
            request.executionMutex.withLock { awaitCancellation() }
        }

        firstCollector.cancelAndJoin()
        request.executionMutex.withLock {
            owner.completeImport(request.id, Result.success(Unit))
        }

        assertTrue(result.await().isSuccess)
        assertEquals(emptyList<BackupImportRequest>(), owner.importRequests.value)
        scope.cancel()
    }

    @Test
    fun noticeRemainsReplayableUntilAcknowledged() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = BackupTaskOwner(scope)

        owner.publishNotice("Backup imported", SettingsNoticeKind.Success)

        val notice = owner.notices.value.single()
        assertEquals("Backup imported", notice.message)
        owner.acknowledgeNotice(notice.id)
        assertEquals(emptyList<BackupTaskNotice>(), owner.notices.value)
        scope.cancel()
    }
}
