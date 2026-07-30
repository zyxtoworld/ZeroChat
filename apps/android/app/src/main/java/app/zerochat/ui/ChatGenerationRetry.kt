package app.zerochat.ui

import app.zerochat.ai.AiProviderHttpException
import kotlinx.coroutines.CancellationException
import java.io.IOException

internal const val STREAMING_UI_FRAME_MS = 16L
internal const val MAX_GENERATION_AUTO_RETRIES = 3
internal const val MAX_CHAT_AUTO_RETRIES = MAX_GENERATION_AUTO_RETRIES
private val CHAT_AUTO_RETRY_DELAYS_MS = longArrayOf(400L, 900L, 1_600L)

internal fun chatAutoRetryDelayMs(retryIndex: Int): Long =
    CHAT_AUTO_RETRY_DELAYS_MS.getOrElse(retryIndex) { CHAT_AUTO_RETRY_DELAYS_MS.last() }

internal fun isRetryableChatGenerationError(
    error: Throwable,
    receivedText: CharSequence,
): Boolean = isRetryableGenerationError(error, receivedText)

private fun isRetryableGenerationError(
    error: Throwable,
    receivedText: CharSequence,
): Boolean {
    if (receivedText.isNotBlank() || error is CancellationException) {
        return false
    }

    if (error is AiProviderHttpException) {
        return error.retryable
    }

    val typeName = error::class.java.name.lowercase()
    val message = buildString {
        append(error.message.orEmpty())
        append(' ')
        append(error.cause?.message.orEmpty())
    }.lowercase()

    if (error is IOException || "timeout" in typeName || "timeout" in message) {
        return true
    }

    return listOf(
        "network",
        "connection reset",
        "connection refused",
        "failed to connect",
        "temporarily unavailable",
        "temporary failure",
        "socket",
        "unavailable",
        "too many requests",
        "rate limit",
    ).any { marker -> marker in message }
}

internal fun NativeI18n.networkRetryingNotice(attempt: Int, total: Int): String =
    t("notice.networkRetrying")
        .replace("{attempt}", attempt.toString())
        .replace("{total}", total.toString())
