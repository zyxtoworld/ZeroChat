package app.zerochat.security

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class SecretStoreRecoveryTest {
    @Test
    fun loadFailureAttemptsLocalProviderAndSyncPendingRecovery() {
        val store = mockk<SecretStore>()
        every { store.restorePendingLocalResetAfterSnapshotLoadFailure() } returns true
        every { store.restorePendingProviderKeyImportAfterSnapshotLoadFailure() } returns true
        every { store.restorePendingSyncPassphraseAfterSnapshotLoadFailure() } returns true

        restorePendingSecretTransactionsAfterSnapshotLoadFailure(store)

        verify(exactly = 1) { store.restorePendingLocalResetAfterSnapshotLoadFailure() }
        verify(exactly = 1) { store.restorePendingProviderKeyImportAfterSnapshotLoadFailure() }
        verify(exactly = 1) { store.restorePendingSyncPassphraseAfterSnapshotLoadFailure() }
    }

    @Test
    fun oneRecoveryFailureDoesNotSkipTheOtherPendingKinds() {
        val store = mockk<SecretStore>()
        val first = IllegalStateException("local restore failed")
        every { store.restorePendingLocalResetAfterSnapshotLoadFailure() } throws first
        every { store.restorePendingProviderKeyImportAfterSnapshotLoadFailure() } returns true
        every { store.restorePendingSyncPassphraseAfterSnapshotLoadFailure() } returns true

        val thrown = org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException::class.java) {
            restorePendingSecretTransactionsAfterSnapshotLoadFailure(store)
        }

        assertSame(first, thrown)
        assertEquals(0, thrown.suppressed.size)
        verify(exactly = 1) { store.restorePendingProviderKeyImportAfterSnapshotLoadFailure() }
        verify(exactly = 1) { store.restorePendingSyncPassphraseAfterSnapshotLoadFailure() }
    }
}
