package app.zerochat.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class LocalSnapshotRecoveryGateTest {
    @Test
    fun normalPersistenceRunsBeforeAnyLoadFailure() = runBlocking {
        val gate = LocalSnapshotRecoveryGate()
        var writes = 0

        val result = gate.persist { writes += 1 }

        assertTrue(result.isSuccess)
        assertEquals(1, writes)
        assertNull(gate.issue)
    }

    @Test
    fun loadFailureBlocksOrdinaryPersistenceWithoutCallingTheWriter() = runBlocking {
        val gate = LocalSnapshotRecoveryGate()
        var writes = 0
        gate.markLoadFailed()

        val result = gate.persist { writes += 1 }

        assertTrue(result.exceptionOrNull() is LocalSnapshotRecoveryRequiredException)
        assertEquals(0, writes)
        assertEquals(LocalSnapshotRecoveryIssue.LoadFailed, gate.issue)
    }

    @Test
    fun failedRecoveryKeepsWriteProtectionActive() = runBlocking {
        val gate = LocalSnapshotRecoveryGate()
        gate.markLoadFailed()

        val result = gate.persist(recovery = true) {
            error("disk still unavailable")
        }

        assertTrue(result.isFailure)
        assertEquals(LocalSnapshotRecoveryIssue.LoadFailed, gate.issue)
    }

    @Test
    fun successfulRecoveryClearsWriteProtection() = runBlocking {
        val gate = LocalSnapshotRecoveryGate()
        gate.markLoadFailed()

        assertTrue(gate.persist(recovery = true) {}.isSuccess)

        assertNull(gate.issue)
        assertFalse(gate.persist {}.isFailure)
    }

    @Test
    fun cancelledRecoveryRethrowsAndKeepsWriteProtectionActive() {
        val gate = LocalSnapshotRecoveryGate()
        gate.markLoadFailed()
        val cancellation = CancellationException("cancelled")

        val thrown = assertThrows(CancellationException::class.java) {
            runBlocking {
                gate.persist(recovery = true) {
                    throw cancellation
                }
            }
        }

        assertEquals(cancellation, thrown)
        assertEquals(LocalSnapshotRecoveryIssue.LoadFailed, gate.issue)
    }
}
