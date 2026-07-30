package app.zerochat.ai

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AiClientTimeoutTest {
    @Test
    fun aiClientTimeoutBudgetKeepsFastFailuresAndLongImageRoom() {
        assertEquals(30_000L, AI_CONNECT_TIMEOUT_MS)
        assertEquals(30_000L, AI_MODEL_LIST_TIMEOUT_MS)
        assertEquals(60_000L, AI_CHAT_REQUEST_TIMEOUT_MS)
        assertEquals(90_000L, AI_STREAM_IDLE_TIMEOUT_MS)
        assertEquals(180_000L, AI_IMAGE_REQUEST_TIMEOUT_MS)
        assertEquals(16_384, MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES)
        assertEquals(8_000_000, MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES)
        assertEquals(32_000_000, MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES)
        assertEquals(32_000_000, MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES)
        assertEquals(8_000_000, MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES)
        assertTrue(AI_CHAT_REQUEST_TIMEOUT_MS < AI_IMAGE_REQUEST_TIMEOUT_MS)
        assertTrue(AI_CONNECT_TIMEOUT_MS <= AI_STREAM_IDLE_TIMEOUT_MS)
    }
}
