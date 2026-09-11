package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProviderKeySaveTransactionTest {
    @Test
    fun stagesProviderKeyBeforeSnapshotAndFinishesIntent() = runBlocking {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val events = mutableListOf<String>()

        val commit = commitProviderKeySnapshotSaveTransaction(
            source = source,
            candidate = candidate,
            sourceRevision = 3,
            currentRevision = { 3 },
            stageProviderKey = { events += "stage" },
            finishProviderKey = { events += "finish" },
            restoreProviderKey = { events += "restore" },
            compareAndSetSnapshot = { _, replacement ->
                events += "snapshot"
                SnapshotCompareAndSetResult(replacement, 8, committed = true)
            },
        )

        assertEquals(listOf("stage", "snapshot", "finish"), events)
        assertEquals(candidate, commit.snapshot)
        assertEquals(8, commit.revision)
    }

    @Test
    fun snapshotCasRejectRestoresStagedProviderKey() {
        val events = mutableListOf<String>()

        assertThrows(ProviderKeySaveConflictException::class.java) {
            runBlocking {
                commitProviderKeySnapshotSaveTransaction(
                    source = AppSnapshot(updatedAt = 1),
                    candidate = AppSnapshot(updatedAt = 2),
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageProviderKey = { events += "stage" },
                    finishProviderKey = { events += "finish" },
                    restoreProviderKey = { events += "restore" },
                    compareAndSetSnapshot = { _, _ ->
                        events += "snapshot"
                        SnapshotCompareAndSetResult(AppSnapshot(updatedAt = 3), 2, committed = false)
                    },
                )
            }
        }

        assertEquals(listOf("stage", "snapshot", "restore"), events)
    }

    @Test
    fun snapshotCasFailureAfterDurableWriteRestoresStagedProviderKey() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val failure = IllegalStateException("snapshot response lost")
        val events = mutableListOf<String>()
        var durableSnapshot = source
        var compareCalls = 0

        val thrown = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeySnapshotSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageProviderKey = { events += "stage" },
                    finishProviderKey = { events += "finish" },
                    restoreProviderKey = { events += "restore" },
                    compareAndSetSnapshot = { expected, replacement ->
                        compareCalls += 1
                        if (compareCalls == 1) {
                            durableSnapshot = replacement
                            events += "snapshot"
                            throw failure
                        }
                        assertEquals(candidate, expected)
                        durableSnapshot = source
                        events += "rollback"
                        SnapshotCompareAndSetResult(source, 3, committed = true)
                    },
                )
            }
        }

        assertTrue(thrown === failure)
        assertEquals(source, durableSnapshot)
        assertEquals(listOf("stage", "snapshot", "rollback", "restore"), events)
    }

    @Test
    fun processStopAfterSnapshotCasLeavesPendingIntentForStartupRecovery() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val events = mutableListOf<String>()
        var pendingIntent = false

        assertThrows(ProcessStopped::class.java) {
            runBlocking {
                commitProviderKeySnapshotSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { throw ProcessStopped() },
                    stageProviderKey = {
                        pendingIntent = true
                        events += "stage"
                    },
                    finishProviderKey = { pendingIntent = false; events += "finish" },
                    restoreProviderKey = { pendingIntent = false; events += "restore" },
                    compareAndSetSnapshot = { _, replacement ->
                        events += "snapshot"
                        SnapshotCompareAndSetResult(replacement, 2, committed = true)
                    },
                )
            }
        }

        assertTrue(pendingIntent)
        assertEquals(listOf("stage", "snapshot"), events)
    }

    @Test
    fun finishFailureRollsSnapshotBackAndRestoresStagedProviderKey() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val events = mutableListOf<String>()
        var calls = 0

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeySnapshotSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageProviderKey = { events += "stage" },
                    finishProviderKey = {
                        events += "finish"
                        error("finish unavailable")
                    },
                    restoreProviderKey = { events += "restore" },
                    compareAndSetSnapshot = { _, replacement ->
                        calls += 1
                        events += if (calls == 1) "snapshot" else "rollback"
                        SnapshotCompareAndSetResult(replacement, calls.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("finish unavailable", failure.message)
        assertEquals(listOf("stage", "snapshot", "finish", "rollback", "restore"), events)
    }

    private class ProcessStopped : RuntimeException()
}
