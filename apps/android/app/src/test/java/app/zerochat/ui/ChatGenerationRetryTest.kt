package app.zerochat.ui

import app.zerochat.ai.AiProviderErrorCode
import app.zerochat.ai.AiProviderHttpException
import kotlinx.coroutines.CancellationException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

class ChatGenerationRetryTest {
    @Test
    fun chatRetryBudgetMatchesWebGenerationRetryBudget() {
        assertEquals(3, MAX_GENERATION_AUTO_RETRIES)
        assertEquals(MAX_GENERATION_AUTO_RETRIES, MAX_CHAT_AUTO_RETRIES)
        assertEquals(400L, chatAutoRetryDelayMs(0))
        assertEquals(900L, chatAutoRetryDelayMs(1))
        assertEquals(1_600L, chatAutoRetryDelayMs(2))
        assertEquals(1_600L, chatAutoRetryDelayMs(99))
    }

    @Test
    fun retriesOnlyTransientFailuresBeforeAnyStreamedText() {
        assertTrue(isRetryableChatGenerationError(IOException("network timeout"), ""))
        assertTrue(isRetryableChatGenerationError(IllegalStateException("too many requests"), ""))
        assertFalse(isRetryableChatGenerationError(IllegalStateException("AI request failed: HTTP 503"), ""))
        assertFalse(isRetryableChatGenerationError(IllegalStateException("Provider API key is required"), ""))
        assertFalse(isRetryableChatGenerationError(IllegalStateException("AI request failed: HTTP 401"), ""))
        assertFalse(isRetryableChatGenerationError(IOException("network timeout"), "partial answer"))
        assertFalse(isRetryableChatGenerationError(CancellationException("stopped"), ""))
    }

    @Test
    fun structuredHttpMetadataOverridesLegacyTextHeuristics() {
        val retryable = AiProviderHttpException(
            status = 503,
            providerDetail = "upstream overloaded",
            code = AiProviderErrorCode.Server,
            retryable = true,
            message = "opaque provider failure",
        )
        val notRetryable = AiProviderHttpException(
            status = 400,
            providerDetail = "invalid request",
            code = AiProviderErrorCode.Request,
            retryable = false,
            message = "too many requests",
        )

        assertTrue(isRetryableChatGenerationError(retryable, ""))
        assertFalse(isRetryableChatGenerationError(notRetryable, ""))
    }

}
