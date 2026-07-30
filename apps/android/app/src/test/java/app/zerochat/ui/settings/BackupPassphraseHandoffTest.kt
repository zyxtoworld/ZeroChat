package app.zerochat.ui.settings

import org.junit.jupiter.api.Assertions.assertEquals
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
    fun aNewLaunchReplacesTheAbandonedPassphrase() {
        val handoff = BackupPassphraseHandoff()

        handoff.stageExport("old-secret")
        handoff.stageExport("new-secret")

        assertEquals("new-secret", handoff.consumeExport())
    }
}
