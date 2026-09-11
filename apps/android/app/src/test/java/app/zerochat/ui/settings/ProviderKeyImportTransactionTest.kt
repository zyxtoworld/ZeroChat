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

class ProviderKeyImportTransactionTest {
    @Test
    fun stagesKeysCommitsSnapshotThenFinishesIntent() = runBlocking {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val events = mutableListOf<String>()

        val commit = transaction(source, candidate, events) { _, replacement ->
            events += "snapshot"
            SnapshotCompareAndSetResult(replacement, 8, committed = true)
        }

        assertEquals(listOf("stage", "snapshot", "finish"), events)
        assertEquals(SnapshotCommit(candidate, 8), commit)
    }

    @Test
    fun staleSnapshotRestoresPreviousKeys() {
        val events = mutableListOf<String>()

        assertThrows(ProviderKeyImportConflictException::class.java) {
            runBlocking {
                transaction(snapshot(1), snapshot(2), events) { _, _ ->
                    events += "snapshot"
                    SnapshotCompareAndSetResult(snapshot(3), 9, committed = false)
                }
            }
        }

        assertEquals(listOf("stage", "snapshot", "restore"), events)
    }

    @Test
    fun snapshotWriteFailureRestoresPreviousKeys() {
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
        assertEquals(listOf("stage", "snapshot", "snapshot"), events)
    }

    @Test
    fun visibleRevisionDriftRollsSnapshotBackBeforeRestoringKeys() {
        val events = mutableListOf<String>()
        var calls = 0

        assertThrows(ProviderKeyImportConflictException::class.java) {
            runBlocking {
                commitProviderKeyImportTransaction(
                    source = snapshot(1),
                    candidate = snapshot(2),
                    sourceRevision = 4,
                    currentRevision = { 5 },
                    stageProviderKeys = { events += "stage" },
                    finishProviderKeys = { events += "finish" },
                    restoreProviderKeys = { events += "restore" },
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
    fun finishFailureCompensatesSnapshotAndProviderKeys() {
        val events = mutableListOf<String>()
        var calls = 0

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeyImportTransaction(
                    source = snapshot(1),
                    candidate = snapshot(2),
                    sourceRevision = 4,
                    currentRevision = { 4 },
                    stageProviderKeys = { events += "stage" },
                    finishProviderKeys = {
                        events += "finish"
                        error("credential finalization failed")
                    },
                    restoreProviderKeys = { events += "restore" },
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        events += if (calls == 1) "commit" else "rollback"
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("credential finalization failed", failure.message)
        assertEquals(listOf("stage", "commit", "finish", "rollback", "restore"), events)
    }

    @Test
    fun rollbackCancellationRemainsPrimary() {
        var calls = 0

        val cancellation = assertThrows(CancellationException::class.java) {
            runBlocking {
                commitProviderKeyImportTransaction(
                    source = snapshot(1),
                    candidate = snapshot(2),
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    stageProviderKeys = {},
                    finishProviderKeys = {},
                    restoreProviderKeys = {},
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        if (calls == 2) throw CancellationException("cancel rollback")
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("cancel rollback", cancellation.message)
        assertTrue(cancellation.suppressed.single() is ProviderKeyImportConflictException)
    }

    @Test
    fun recoverySaveFailureRestoresKeysButFinishFailureKeepsIntent() {
        val saveEvents = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeyImportRecoveryTransaction(
                    stageProviderKeys = { saveEvents += "stage" },
                    saveSnapshot = {
                        saveEvents += "save"
                        error("save failed")
                    },
                    finishProviderKeys = { saveEvents += "finish" },
                    restoreProviderKeys = { saveEvents += "restore" },
                )
            }
        }
        assertEquals(listOf("stage", "save", "restore"), saveEvents)

        val finishEvents = mutableListOf<String>()
        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeyImportRecoveryTransaction(
                    stageProviderKeys = { finishEvents += "stage" },
                    saveSnapshot = {
                        finishEvents += "save"
                        SnapshotCommit(snapshot(2), 3)
                    },
                    finishProviderKeys = {
                        finishEvents += "finish"
                        error("finish failed")
                    },
                    restoreProviderKeys = { finishEvents += "restore" },
                )
            }
        }
        assertEquals(listOf("stage", "save", "finish"), finishEvents)
    }

    @Test
    fun snapshotFailureAfterDurableWriteRestoresStagedKeysAndSnapshot() {
        val source = snapshot(1)
        val candidate = snapshot(2)
        val failure = IllegalStateException("snapshot response lost")
        var durableSnapshot = source
        var storedKey = "old-key"
        var compareCalls = 0

        val thrown = runCatching {
            runBlocking {
                commitProviderKeyImportTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageProviderKeys = { storedKey = "new-key" },
                    finishProviderKeys = {},
                    restoreProviderKeys = { storedKey = "old-key" },
                    compareAndSetSnapshot = { expected, replacement ->
                        compareCalls += 1
                        if (compareCalls == 1) {
                            assertEquals(source, expected)
                            durableSnapshot = replacement
                            throw failure
                        }

                        assertEquals(candidate, expected)
                        durableSnapshot = replacement
                        SnapshotCompareAndSetResult(
                            snapshot = replacement,
                            revision = 2,
                            committed = true,
                        )
                    },
                )
            }
        }.exceptionOrNull()

        assertTrue(thrown === failure)
        assertEquals(source, durableSnapshot)
        assertEquals("old-key", storedKey)
        assertEquals(2, compareCalls)
    }

    private suspend fun transaction(
        source: AppSnapshot,
        candidate: AppSnapshot,
        events: MutableList<String>,
        compare: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
    ): SnapshotCommit = commitProviderKeyImportTransaction(
        source = source,
        candidate = candidate,
        sourceRevision = 4,
        currentRevision = { 4 },
        stageProviderKeys = { events += "stage" },
        finishProviderKeys = { events += "finish" },
        restoreProviderKeys = { events += "restore" },
        compareAndSetSnapshot = compare,
    )

    private fun snapshot(updatedAt: Long) = AppSnapshot(updatedAt = updatedAt)
}
