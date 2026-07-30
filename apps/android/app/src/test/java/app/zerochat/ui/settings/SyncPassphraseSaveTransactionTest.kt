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

class SyncPassphraseSaveTransactionTest {
    @Test
    fun writesPassphraseOnlyAfterSnapshotCas() = runBlocking {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val events = mutableListOf<String>()

        val commit = commitSyncPassphraseSaveTransaction(
            source = source,
            candidate = candidate,
            sourceRevision = 4,
            currentRevision = { 4 },
            writeSyncPassphrase = { events += "passphrase" },
            compareAndSetSnapshot = { _, replacement ->
                events += "snapshot"
                SnapshotCompareAndSetResult(replacement, 9, committed = true)
            },
        )

        assertEquals(listOf("snapshot", "passphrase"), events)
        assertEquals(candidate, commit.snapshot)
        assertEquals(9, commit.revision)
    }

    @Test
    fun staleSnapshotNeverWritesPassphrase() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        var passphraseWritten = false

        assertThrows(CredentialSnapshotConflictException::class.java) {
            runBlocking {
                commitSyncPassphraseSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    writeSyncPassphrase = { passphraseWritten = true },
                    compareAndSetSnapshot = { _, _ ->
                        SnapshotCompareAndSetResult(source, 2, committed = false)
                    },
                )
            }
        }

        assertFalse(passphraseWritten)
    }

    @Test
    fun credentialFailureRollsSnapshotBack() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        val replacements = mutableListOf<AppSnapshot>()

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitSyncPassphraseSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    writeSyncPassphrase = { error("credential failed") },
                    compareAndSetSnapshot = { _, replacement ->
                        replacements += replacement
                        SnapshotCompareAndSetResult(replacement, 2, committed = true)
                    },
                )
            }
        }

        assertEquals("credential failed", failure.message)
        assertEquals(listOf(candidate, source), replacements)
    }

    @Test
    fun rollbackCancellationRemainsPrimary() {
        val source = AppSnapshot(updatedAt = 1)
        val candidate = AppSnapshot(updatedAt = 2)
        var call = 0

        val cancellation = assertThrows(CancellationException::class.java) {
            runBlocking {
                commitSyncPassphraseSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    writeSyncPassphrase = {},
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
        assertTrue(cancellation.suppressed.single() is CredentialSnapshotConflictException)
    }
}
