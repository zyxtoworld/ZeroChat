package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LocalResetTransactionTest {
    @Test
    fun stagesCredentialsCommitsSnapshotThenFinishesReset() = runBlocking {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val events = mutableListOf<String>()

        val commit = transaction(
            source = source,
            candidate = candidate,
            events = events,
            compare = { _, replacement ->
                events += "snapshot"
                SnapshotCompareAndSetResult(replacement, 8, committed = true)
            },
        )

        assertEquals(listOf("stage", "snapshot", "finish"), events)
        assertEquals(SnapshotCommit(candidate, 8), commit)
    }

    @Test
    fun staleSnapshotRestoresCredentials() {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val events = mutableListOf<String>()

        assertThrows(LocalResetConflictException::class.java) {
            runBlocking {
                transaction(source, candidate, events) { _, _ ->
                    events += "snapshot"
                    SnapshotCompareAndSetResult(snapshot(3), 9, committed = false)
                }
            }
        }

        assertEquals(listOf("stage", "snapshot", "restore"), events)
    }

    @Test
    fun snapshotWriteFailureRestoresCredentials() {
        val failure = IllegalStateException("disk failed")
        val events = mutableListOf<String>()

        val thrown = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                transaction(snapshot(1), snapshot(2), events) { _, _ ->
                    events += "snapshot"
                    throw failure
                }
            }
        }

        assertTrue(thrown === failure)
        assertEquals(listOf("stage", "snapshot", "restore"), events)
    }

    @Test
    fun visibleRevisionDriftRollsSnapshotBackBeforeRestoringCredentials() {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val events = mutableListOf<String>()
        var calls = 0

        assertThrows(LocalResetConflictException::class.java) {
            runBlocking {
                commitLocalResetTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 4,
                    currentRevision = { 5 },
                    stageCredentials = { events += "stage" },
                    finishCredentials = { events += "finish" },
                    restoreCredentials = { events += "restore" },
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        events += if (calls == 1) "commit" else "rollback"
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals(listOf("stage", "commit", "rollback", "restore"), events)
    }

    @Test
    fun credentialFinishFailureCompensatesSnapshotAndCredentials() {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val events = mutableListOf<String>()
        var calls = 0

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitLocalResetTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 4,
                    currentRevision = { 4 },
                    stageCredentials = { events += "stage" },
                    finishCredentials = {
                        events += "finish"
                        throw IllegalStateException("credential cleanup failed")
                    },
                    restoreCredentials = { events += "restore" },
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        events += if (calls == 1) "commit" else "rollback"
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("credential cleanup failed", failure.message)
        assertEquals(listOf("stage", "commit", "finish", "rollback", "restore"), events)
    }

    @Test
    fun rollbackCancellationRemainsPrimary() {
        var calls = 0

        val cancellation = assertThrows(CancellationException::class.java) {
            runBlocking {
                commitLocalResetTransaction(
                    source = snapshot(1),
                    candidate = snapshot(2),
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    stageCredentials = {},
                    finishCredentials = {},
                    restoreCredentials = {},
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        if (calls == 2) throw CancellationException("cancel rollback")
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("cancel rollback", cancellation.message)
        assertTrue(cancellation.suppressed.single() is LocalResetConflictException)
    }

    @Test
    fun recoverySaveFailureRestoresCredentialsButFinishFailureKeepsIntent() {
        val saveEvents = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitLocalResetRecoveryTransaction(
                    stageCredentials = { saveEvents += "stage" },
                    saveSnapshot = {
                        saveEvents += "save"
                        error("save failed")
                    },
                    finishCredentials = { saveEvents += "finish" },
                    restoreCredentials = { saveEvents += "restore" },
                )
            }
        }
        assertEquals(listOf("stage", "save", "restore"), saveEvents)

        val finishEvents = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitLocalResetRecoveryTransaction(
                    stageCredentials = { finishEvents += "stage" },
                    saveSnapshot = {
                        finishEvents += "save"
                        SnapshotCommit(snapshot(2), 3)
                    },
                    finishCredentials = {
                        finishEvents += "finish"
                        error("finish failed")
                    },
                    restoreCredentials = { finishEvents += "restore" },
                )
            }
        }
        assertEquals(listOf("stage", "save", "finish"), finishEvents)
    }

    private suspend fun transaction(
        source: AppSnapshot,
        candidate: AppSnapshot,
        events: MutableList<String>,
        compare: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
    ): SnapshotCommit = commitLocalResetTransaction(
        source = source,
        candidate = candidate,
        sourceRevision = 4,
        currentRevision = { 4 },
        stageCredentials = { events += "stage" },
        finishCredentials = { events += "finish" },
        restoreCredentials = { events += "restore" },
        compareAndSetSnapshot = compare,
    )

    private fun snapshot(updatedAt: Long) = AppSnapshot(updatedAt = updatedAt)
}
