package app.zerochat.ai

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.ByteReadChannel
import io.ktor.utils.io.readAvailable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.ByteArrayOutputStream

const val MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES = 16_384
const val MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES = 8_000_000
const val MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES = 32_000_000
const val MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES = 32_000_000
const val MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES = 8_000_000

internal enum class AiProviderErrorCode(val value: String) {
    Auth("auth"),
    Quota("quota"),
    RateLimit("rate-limit"),
    Endpoint("endpoint"),
    Timeout("timeout"),
    Server("server"),
    Request("request"),
}

internal class AiProviderHttpException(
    val status: Int,
    val providerDetail: String,
    val code: AiProviderErrorCode,
    val retryable: Boolean,
    message: String,
) : IllegalStateException(message)

private fun aiProviderErrorCode(status: Int): AiProviderErrorCode = when {
    status == 401 || status == 403 -> AiProviderErrorCode.Auth
    status == 402 -> AiProviderErrorCode.Quota
    status == 408 || status == 504 -> AiProviderErrorCode.Timeout
    status == 429 -> AiProviderErrorCode.RateLimit
    status == 404 || status == 405 || status == 501 -> AiProviderErrorCode.Endpoint
    status >= 500 -> AiProviderErrorCode.Server
    else -> AiProviderErrorCode.Request
}

private fun aiProviderErrorMessage(code: AiProviderErrorCode, fallback: String): String = when (code) {
    AiProviderErrorCode.Auth -> "Invalid API key"
    AiProviderErrorCode.Quota -> "Insufficient quota"
    AiProviderErrorCode.RateLimit -> "Too many requests"
    AiProviderErrorCode.Endpoint -> "Provider endpoint not found"
    AiProviderErrorCode.Timeout -> "Request timed out"
    AiProviderErrorCode.Server -> "Service unavailable"
    AiProviderErrorCode.Request -> fallback
}

private fun JsonObject.aiProviderString(key: String): String? =
    (this[key] as? JsonPrimitive)
        ?.takeIf { value -> value.isString }
        ?.content
        ?.trim()
        ?.takeIf { value -> value.isNotEmpty() }

private fun aiProviderErrorDetail(body: String): String {
    val trimmed = body.trim()
    if (trimmed.isEmpty()) {
        return ""
    }

    val root = runCatching { Json.parseToJsonElement(trimmed) }.getOrNull() as? JsonObject
        ?: return trimmed
    val nestedError = root["error"]
    val nestedDetail = when (nestedError) {
        is JsonPrimitive -> nestedError.takeIf { value -> value.isString }?.content?.trim()
        is JsonObject -> listOfNotNull(
            nestedError.aiProviderString("message"),
            nestedError.aiProviderString("code"),
        ).joinToString(" ")
        else -> null
    }.orEmpty()

    return nestedDetail.ifEmpty {
        root.aiProviderString("message")
            ?: root.aiProviderString("detail")
            ?: trimmed
    }
}

private fun aiProviderAudioBytesHaveKnownSignature(bytes: ByteArray): Boolean {
    fun startsWith(vararg values: Int): Boolean =
        bytes.size >= values.size && values.indices.all { index ->
            (bytes[index].toInt() and 0xff) == values[index]
        }

    return startsWith(0x49, 0x44, 0x33) ||
        startsWith(0x52, 0x49, 0x46, 0x46) ||
        startsWith(0x4f, 0x67, 0x67, 0x53) ||
        startsWith(0x66, 0x4c, 0x61, 0x43) ||
        (bytes.size > 1 &&
            (bytes[0].toInt() and 0xff) == 0xff &&
            (bytes[1].toInt() and 0xff and 0xe0) == 0xe0) ||
        (bytes.size > 7 &&
            bytes[4].toInt() == 0x66 &&
            bytes[5].toInt() == 0x74 &&
            bytes[6].toInt() == 0x79 &&
            bytes[7].toInt() == 0x70)
}

private fun aiProviderAudioBytesLookLikeText(bytes: ByteArray): Boolean {
    val sample = bytes.copyOf(minOf(bytes.size, 96))
    val firstContentByte = sample.firstOrNull { byte ->
        val value = byte.toInt() and 0xff
        value != 0x09 && value != 0x0a && value != 0x0d && value != 0x20
    }?.toInt()?.and(0xff)

    if (firstContentByte == 0x7b || firstContentByte == 0x5b || firstContentByte == 0x3c) {
        return true
    }

    return sample.all { byte ->
        val value = byte.toInt() and 0xff
        value == 0x09 ||
            value == 0x0a ||
            value == 0x0d ||
            value in 0x20..0x7e
    }
}

internal fun aiProviderAudioResponseLooksValid(bytes: ByteArray, contentType: String): Boolean {
    if (bytes.isEmpty() || aiProviderAudioBytesLookLikeText(bytes)) {
        return false
    }

    val normalizedContentType = contentType.trim().lowercase()
    if (normalizedContentType.startsWith("audio/") || normalizedContentType.contains("octet-stream")) {
        return true
    }

    if (aiProviderAudioBytesHaveKnownSignature(bytes)) {
        return true
    }

    return !(
        normalizedContentType.contains("json") ||
            normalizedContentType.startsWith("text/") ||
            normalizedContentType.contains("html") ||
            normalizedContentType.contains("xml")
        )
}

internal fun accumulateAiProviderResponseBytes(
    currentBytes: Int,
    nextBytes: Int,
    maxBytes: Int,
    label: String,
): Int {
    require(currentBytes >= 0 && nextBytes >= 0 && maxBytes >= 0)

    if (currentBytes > maxBytes - nextBytes) {
        throw IllegalStateException("$label exceeded the $maxBytes-byte safety limit.")
    }

    return currentBytes + nextBytes
}

private suspend fun HttpResponse.boundedAiProviderChannel(
    maxBytes: Int,
    label: String,
): ByteReadChannel {
    require(maxBytes >= 0)
    val declaredLength = headers[HttpHeaders.ContentLength]
        ?.toLongOrNull()
        ?.takeIf { it >= 0 }

    if (declaredLength != null && declaredLength > maxBytes) {
        val failure = IllegalStateException("$label exceeded the $maxBytes-byte safety limit.")
        cancel(CancellationException(failure.message))
        throw failure
    }

    return bodyAsChannel()
}

internal suspend fun HttpResponse.readBoundedAiProviderBytes(
    maxBytes: Int,
    label: String,
): ByteArray {
    val channel = boundedAiProviderChannel(maxBytes, label)
    val declaredLength = headers[HttpHeaders.ContentLength]
        ?.toLongOrNull()
        ?.takeIf { it >= 0 }
    val initialCapacity = declaredLength
        ?.coerceAtMost(maxBytes.toLong())
        ?.toInt()
        ?: 8_192
    val output = ByteArrayOutputStream(initialCapacity)
    val buffer = ByteArray(8_192)
    var totalBytes = 0

    while (true) {
        val read = channel.readAvailable(buffer, 0, buffer.size)
        if (read == -1) {
            break
        }
        if (read == 0) {
            continue
        }

        try {
            totalBytes = accumulateAiProviderResponseBytes(
                currentBytes = totalBytes,
                nextBytes = read,
                maxBytes = maxBytes,
                label = label,
            )
        } catch (error: IllegalStateException) {
            channel.cancel(error)
            throw error
        }

        output.write(buffer, 0, read)
    }

    return output.toByteArray()
}

internal suspend fun HttpResponse.readBoundedAiProviderText(
    maxBytes: Int,
    label: String,
): String = readBoundedAiProviderBytes(maxBytes, label).decodeToString()

internal suspend fun HttpResponse.readAiProviderHttpException(
    fallbackMessage: String,
): AiProviderHttpException {
    val providerDetail = try {
        aiProviderErrorDetail(
            readBoundedAiProviderText(
                maxBytes = MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES,
                label = "AI provider error response",
            ),
        )
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        ""
    }
    val code = aiProviderErrorCode(status.value)

    return AiProviderHttpException(
        status = status.value,
        providerDetail = providerDetail,
        code = code,
        retryable = code == AiProviderErrorCode.Timeout ||
            code == AiProviderErrorCode.RateLimit ||
            code == AiProviderErrorCode.Server,
        message = aiProviderErrorMessage(code, fallbackMessage),
    )
}

internal fun HttpResponse.discardAiProviderBody() {
    cancel(CancellationException("AI provider fallback selected"))
}

internal suspend fun HttpResponse.boundedAiProviderSseLineReader(
    maxBytes: Int = MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES,
    label: String = "AI provider stream response",
    idleTimeoutMs: Long = AI_STREAM_IDLE_TIMEOUT_MS,
): BoundedAiProviderSseLineReader = BoundedAiProviderSseLineReader(
    channel = boundedAiProviderChannel(maxBytes, label),
    maxBytes = maxBytes,
    label = label,
    idleTimeoutMs = idleTimeoutMs,
)

internal class BoundedAiProviderSseLineReader(
    private val channel: ByteReadChannel,
    private val maxBytes: Int,
    private val label: String,
    private val idleTimeoutMs: Long,
) {
    private val readBuffer = ByteArray(8_192)
    private val lineBuffer = ByteArrayOutputStream(256)
    private var readOffset = 0
    private var readLength = 0
    private var totalBytes = 0
    private var exhausted = false
    private var closed = false

    internal fun close() {
        if (closed) {
            return
        }

        closed = true
        exhausted = true
        channel.cancel(CancellationException("AI provider SSE reader closed"))
    }

    suspend fun readLine(): String? {
        while (true) {
            if (readOffset < readLength) {
                var newlineIndex = readOffset
                while (
                    newlineIndex < readLength &&
                    readBuffer[newlineIndex] != '\n'.code.toByte()
                ) {
                    newlineIndex += 1
                }

                if (newlineIndex < readLength) {
                    lineBuffer.write(readBuffer, readOffset, newlineIndex - readOffset)
                    readOffset = newlineIndex + 1
                    return lineBuffer.toByteArray().decodeToString().also {
                        lineBuffer.reset()
                    }
                }

                lineBuffer.write(readBuffer, readOffset, readLength - readOffset)
                readOffset = readLength
            }

            if (exhausted) {
                if (lineBuffer.size() == 0) {
                    return null
                }

                return lineBuffer.toByteArray().decodeToString().also {
                    lineBuffer.reset()
                }
            }

            val read = withTimeout(idleTimeoutMs) {
                channel.readAvailable(readBuffer, 0, readBuffer.size)
            }
            if (read == -1) {
                exhausted = true
                continue
            }
            if (read == 0) {
                continue
            }

            try {
                totalBytes = accumulateAiProviderResponseBytes(
                    currentBytes = totalBytes,
                    nextBytes = read,
                    maxBytes = maxBytes,
                    label = label,
                )
            } catch (error: IllegalStateException) {
                channel.cancel(error)
                throw error
            }

            readOffset = 0
            readLength = read
        }
    }
}
