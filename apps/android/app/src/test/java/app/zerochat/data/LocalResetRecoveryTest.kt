package app.zerochat.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Test

class LocalResetRecoveryTest {
    @Test
    fun fingerprintIsStableAndChangesWithSnapshotContent() {
        val source = AppSnapshot(updatedAt = 10)

        assertEquals(
            localResetSnapshotFingerprint(source),
            localResetSnapshotFingerprint(source.copy()),
        )
        assertNotEquals(
            localResetSnapshotFingerprint(source),
            localResetSnapshotFingerprint(source.copy(updatedAt = 11)),
        )
    }

    @Test
    fun restoresCredentialsWhenDurableSnapshotStillMatchesSource() {
        val intent = intent(source = "source", replacement = "replacement")

        assertEquals(
            LocalResetRecoveryAction.RestoreCredentials,
            localResetRecoveryAction(intent, "source"),
        )
    }

    @Test
    fun finishesResetWhenDurableSnapshotMatchesReplacement() {
        val intent = intent(source = "source", replacement = "replacement")

        assertEquals(
            LocalResetRecoveryAction.FinishReset,
            localResetRecoveryAction(intent, "replacement"),
        )
    }

    @Test
    fun blocksUnknownSnapshotAndSourceLessRecoveryIntent() {
        assertEquals(
            LocalResetRecoveryAction.Block,
            localResetRecoveryAction(intent("source", "replacement"), "other"),
        )
        assertEquals(
            LocalResetRecoveryAction.Block,
            localResetRecoveryAction(intent(null, "replacement"), "source"),
        )
    }

    private fun intent(source: String?, replacement: String) = LocalResetIntentMetadata(
        sourceFingerprint = source,
        replacementFingerprint = replacement,
        replacementUpdatedAt = 20,
    )
}
