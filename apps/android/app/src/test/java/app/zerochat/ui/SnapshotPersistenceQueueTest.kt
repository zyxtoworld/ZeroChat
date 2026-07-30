package app.zerochat.ui

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Preferences
import app.zerochat.data.SnapshotCommit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SnapshotPersistenceQueueTest {
    @Test
    fun queuedWritesRunInSubmissionOrder() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = SnapshotPersistenceQueue(scope)
        val firstMayFinish = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()

        val first = queue.enqueue {
            order += "first-start"
            firstMayFinish.await()
            order += "first-end"
        }
        val second = queue.enqueue { order += "second" }

        assertEquals(listOf("first-start"), order)
        firstMayFinish.complete(Unit)
        first.join()
        second.join()

        assertEquals(listOf("first-start", "first-end", "second"), order)
        scope.cancel()
    }

    @Test
    fun successfulSyncAdvancesRollbackBaselineBeforeLaterSaveFailure() {
        val initial = snapshot(updatedAt = 100, theme = "light")
        val synced = snapshot(updatedAt = 200, theme = "system")
        val failedLocal = snapshot(updatedAt = 300, theme = "dark")
        val baseline = CommittedSnapshotBaseline()
        baseline.initialize(initial)

        val published = baseline.acceptSynced(
            current = initial,
            source = initial,
            commit = SnapshotCommit(synced, revision = 2),
        )
        baseline.advance(SnapshotCommit(initial, revision = 1))
        val rolledBack = baseline.rollbackFailed(failedLocal, failedLocal)

        assertEquals(synced, published)
        assertEquals(synced, baseline.snapshot())
        assertEquals(synced, rolledBack)
    }

    private fun snapshot(updatedAt: Long, theme: String): AppSnapshot =
        AppSnapshot(
            preferences = Preferences(theme = theme),
            updatedAt = updatedAt,
        )
}
