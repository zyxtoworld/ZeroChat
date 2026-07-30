package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProviderKeySaveTransactionTest {
    @Test
    fun writesProviderKeyOnlyAfterSnapshotCas() = runBlocking {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val events = mutableListOf<String>()

        val commit = commitProviderKeySaveTransaction(
            source = source,
            candidate = candidate,
            sourceRevision = 3,
            currentRevision = { 3 },
            writeProviderKey = { events += "key" },
            compareAndSetSnapshot = { _, replacement ->
                events += "snapshot"
                SnapshotCompareAndSetResult(replacement, 8, committed = true)
            },
        )

        assertEquals(listOf("snapshot", "key"), events)
        assertEquals(candidate, commit.snapshot)
        assertEquals(8, commit.revision)
    }

    @Test
    fun staleSnapshotNeverWritesProviderKey() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        var keyWritten = false

        assertThrows(ProviderDeletionConflictException::class.java) {
            runBlocking {
                commitProviderKeySaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    writeProviderKey = { keyWritten = true },
                    compareAndSetSnapshot = { _, _ ->
                        SnapshotCompareAndSetResult(source, 2, committed = false)
                    },
                )
            }
        }

        assertFalse(keyWritten)
    }

    @Test
    fun visibleRevisionDriftRollsSnapshotBackBeforeKeyWrite() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val replacements = mutableListOf<AppSnapshot>()
        var keyWritten = false

        assertThrows(ProviderDeletionConflictException::class.java) {
            runBlocking {
                commitProviderKeySaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    writeProviderKey = { keyWritten = true },
                    compareAndSetSnapshot = { _, replacement ->
                        replacements += replacement
                        SnapshotCompareAndSetResult(replacement, 2, committed = true)
                    },
                )
            }
        }

        assertEquals(listOf(candidate, source), replacements)
        assertFalse(keyWritten)
    }

    @Test
    fun keyStoreFailureRollsSnapshotBack() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val replacements = mutableListOf<AppSnapshot>()

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderKeySaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    writeProviderKey = { throw IllegalStateException("key store failed") },
                    compareAndSetSnapshot = { _, replacement ->
                        replacements += replacement
                        SnapshotCompareAndSetResult(replacement, 2, committed = true)
                    },
                )
            }
        }

        assertEquals("key store failed", failure.message)
        assertEquals(listOf(candidate, source), replacements)
    }

    @Test
    fun rollbackCancellationRemainsPrimary() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        var call = 0

        val cancellation = assertThrows(CancellationException::class.java) {
            runBlocking {
                commitProviderKeySaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    writeProviderKey = {},
                    compareAndSetSnapshot = { _, replacement ->
                        call += 1
                        if (call == 2) {
                            throw CancellationException("cancel rollback")
                        }
                        SnapshotCompareAndSetResult(replacement, 2, committed = true)
                    },
                )
            }
        }

        assertEquals("cancel rollback", cancellation.message)
        assertTrue(cancellation.suppressed.single() is ProviderDeletionConflictException)
    }
}
