package app.zerochat.sync

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class CryptoDecompressionLimitTest {
    @Test
    fun decompressedSyncJsonBudgetMatchesTheCrossPlatformContract() {
        assertEquals(32_000_000, MAX_DECOMPRESSED_SYNC_JSON_BYTES)
    }

    @Test
    fun gzipDecompressionAcceptsBoundaryAndRejectsOverflowBeforeAppend() {
        val payload = "12345".toByteArray()
        val compressed = gzip(payload)

        assertArrayEquals(payload, decompressJsonPayload(compressed, "gzip", payload.size))
        val failure = assertThrows(IllegalArgumentException::class.java) {
            decompressJsonPayload(compressed, "gzip", payload.size - 1)
        }
        assertEquals(
            "Encrypted sync data exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    @Test
    fun uncompressedAuthenticatedObjectsUseTheSameBudget() {
        val payload = "12345".toByteArray()

        assertArrayEquals(payload, decompressJsonPayload(payload, "none", payload.size))
        val failure = assertThrows(IllegalArgumentException::class.java) {
            decompressJsonPayload(payload, "none", payload.size - 1)
        }
        assertEquals(
            "Encrypted sync data exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    private fun gzip(bytes: ByteArray): ByteArray {
        val output = ByteArrayOutputStream()
        GZIPOutputStream(output).use { it.write(bytes) }
        return output.toByteArray()
    }
}
