package app.zerochat.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ProviderKeyImportRecoveryTest {
    @Test
    fun restoresPreviousKeysWhenSnapshotStillMatchesSource() {
        assertEquals(
            ProviderKeyImportRecoveryAction.RestorePreviousKeys,
            providerKeyImportRecoveryAction(intent("source", "replacement"), "source"),
        )
    }

    @Test
    fun keepsReplacementKeysWhenSnapshotMatchesImportedCandidate() {
        assertEquals(
            ProviderKeyImportRecoveryAction.KeepReplacementKeys,
            providerKeyImportRecoveryAction(intent("source", "replacement"), "replacement"),
        )
    }

    @Test
    fun blocksUnknownSnapshot() {
        assertEquals(
            ProviderKeyImportRecoveryAction.Block,
            providerKeyImportRecoveryAction(intent("source", "replacement"), "other"),
        )
    }

    @Test
    fun sourceLessRecoveryIntentOnlyAcceptsReplacementSnapshot() {
        val intent = intent(null, "replacement")

        assertEquals(
            ProviderKeyImportRecoveryAction.KeepReplacementKeys,
            providerKeyImportRecoveryAction(intent, "replacement"),
        )
        assertEquals(
            ProviderKeyImportRecoveryAction.Block,
            providerKeyImportRecoveryAction(intent, "source"),
        )
    }

    private fun intent(source: String?, replacement: String) =
        ProviderKeyImportIntentMetadata(
            sourceFingerprint = source,
            replacementFingerprint = replacement,
            replacementUpdatedAt = 20,
        )
}
