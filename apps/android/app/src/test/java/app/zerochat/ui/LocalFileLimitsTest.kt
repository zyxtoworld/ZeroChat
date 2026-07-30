package app.zerochat.ui

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.ByteArrayInputStream

class LocalFileLimitsTest {
    @Test
    fun localFileBudgetsMatchTheCrossPlatformContract() {
        assertEquals(50_000_000, MAX_ENCRYPTED_BACKUP_FILE_BYTES)
        assertEquals(2_000_000, MAX_SKILL_FILE_BYTES)
        assertEquals(20_000_000, MAX_IMAGE_FILE_BYTES)
    }

    @Test
    fun boundedReaderAcceptsBoundaryAndRejectsOverflow() {
        val payload = "12345".toByteArray()

        assertArrayEquals(
            payload,
            readBoundedLocalInputStream(
                ByteArrayInputStream(payload),
                payload.size,
                "too large",
            ),
        )
        val failure = assertThrows(IllegalArgumentException::class.java) {
            readBoundedLocalInputStream(
                ByteArrayInputStream(payload),
                payload.size - 1,
                "too large",
            )
        }
        assertEquals("too large", failure.message)
    }

    @Test
    fun boundedReaderRejectsInvalidLimits() {
        val failure = assertThrows(IllegalArgumentException::class.java) {
            readBoundedLocalInputStream(ByteArrayInputStream(byteArrayOf()), -1, "too large")
        }

        assertEquals("Local file size limit must not be negative.", failure.message)
    }

    @Test
    fun byteSizeCheckKeepsExportsInsideTheImportBudget() {
        assertLocalByteSize(4, 4, "too large")
        val failure = assertThrows(IllegalArgumentException::class.java) {
            assertLocalByteSize(5, 4, "too large")
        }

        assertEquals("too large", failure.message)
    }
}
