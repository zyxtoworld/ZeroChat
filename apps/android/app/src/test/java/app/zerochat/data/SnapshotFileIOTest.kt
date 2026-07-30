package app.zerochat.data

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.ByteArrayInputStream
import java.nio.file.Path

class SnapshotFileIOTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun localSnapshotBudgetMatchesTheCrossPlatformContract() {
        assertEquals(64_000_000, MAX_LOCAL_SNAPSHOT_FILE_BYTES)
    }

    @Test
    fun boundedReaderAcceptsBoundaryAndRejectsActualOverflow() {
        val payload = "12345".toByteArray()

        assertArrayEquals(
            payload,
            readBoundedSnapshotInputStream(ByteArrayInputStream(payload), payload.size),
        )
        val failure = assertThrows(LocalSnapshotTooLargeException::class.java) {
            readBoundedSnapshotInputStream(ByteArrayInputStream(payload), payload.size - 1)
        }
        assertEquals(payload.size - 1, failure.maxBytes)
    }

    @Test
    fun atomicWriterRejectsOverflowWithoutReplacingTheCurrentSnapshot() {
        val file = tempDir.resolve("snapshot.v1.json").toFile()
        writeBoundedSnapshotTextAtomically(file, "old", maxBytes = 3)

        assertThrows(LocalSnapshotTooLargeException::class.java) {
            writeBoundedSnapshotTextAtomically(file, "newer", maxBytes = 3)
        }

        assertEquals("old", readBoundedSnapshotText(file, maxBytes = 3))
        assertFalse(snapshotTempFile(file).exists())
    }

    @Test
    fun validTempSnapshotCanBePromotedAfterAnInterruptedPublish() {
        val file = tempDir.resolve("snapshot.v1.json").toFile()
        val tempFile = snapshotTempFile(file)
        tempFile.writeText("recovered")

        assertEquals("recovered", readBoundedSnapshotText(tempFile, maxBytes = 9))
        replaceSnapshotFile(tempFile, file)

        assertTrue(file.exists())
        assertFalse(tempFile.exists())
        assertEquals("recovered", readBoundedSnapshotText(file, maxBytes = 9))
    }
}
