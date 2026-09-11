package app.zerochat.data

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class SyncPassphraseRecoveryTest {
    private val intent = SyncPassphraseIntentMetadata(
        sourceFingerprint = "source",
        replacementFingerprint = "replacement",
        replacementUpdatedAt = 2,
    )

    @Test
    fun durableReplacementKeepsNewPassphrase() {
        assertEquals(
            SyncPassphraseRecoveryAction.KeepReplacement,
            syncPassphraseRecoveryAction(intent, "replacement"),
        )
    }

    @Test
    fun snapshotCasRejectRestoresPreviousPassphrase() {
        assertEquals(
            SyncPassphraseRecoveryAction.RestorePrevious,
            syncPassphraseRecoveryAction(intent, "source"),
        )
    }

    @Test
    fun unrelatedSnapshotBlocksAutomaticCredentialChoice() {
        assertEquals(
            SyncPassphraseRecoveryAction.Block,
            syncPassphraseRecoveryAction(intent, "unrelated"),
        )
    }
}
