package app.zerochat.ui.settings

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class BackupPassphraseHandoffTest {
    @Test
    fun passphrasesAreConsumedExactlyOnce() {
        val handoff = BackupPassphraseHandoff()

        handoff.stageExport("export-secret")
        handoff.stageImport("import-secret")

        assertEquals("export-secret", handoff.consumeExport())
        assertEquals("", handoff.consumeExport())
        assertEquals("import-secret", handoff.consumeImport())
        assertEquals("", handoff.consumeImport())
    }

    @Test
    fun aSecondLaunchDoesNotReplaceTheActivePassphrase() {
        val handoff = BackupPassphraseHandoff()

        assertTrue(handoff.stageExport("old-secret"))
        assertFalse(handoff.stageExport("new-secret"))

        assertEquals("old-secret", handoff.consumeExport())
        assertTrue(handoff.stageExport("new-secret"))
        assertEquals("new-secret", handoff.consumeExport())
    }
}
