package app.zerochat.ui.chat

import app.zerochat.ai.AiClient
import app.zerochat.ai.GeneratedImage
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.ui.MAX_CHAT_AUTO_RETRIES
import app.zerochat.ui.chatAutoRetryDelayMs
import app.zerochat.ui.isRetryableChatGenerationError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private const val WRITING_ARTIFACT_PREFIX = ":::writing{"

internal fun normalizeAssistantMessageContent(content: String): String {
    var sourceIndex = 0
    var removedWritingEnvelope = false
    val normalized = StringBuilder(content.length)

    while (true) {
        val envelopeStart = content.indexOf(WRITING_ARTIFACT_PREFIX, sourceIndex)
        if (envelopeStart < 0) {
            normalized.append(content, sourceIndex, content.length)
            break
        }

        normalized.append(content, sourceIndex, envelopeStart)
        val envelopeEnd = content.indexOf('}', envelopeStart + WRITING_ARTIFACT_PREFIX.length)
        if (envelopeEnd < 0) {
            break
        }

        val envelope = content.substring(envelopeStart, envelopeEnd + 1)
        if (envelope.contains("variant=") || envelope.contains("id=")) {
            removedWritingEnvelope = true
            sourceIndex = envelopeEnd + 1
            while (normalized.isBlank() && sourceIndex < content.length && content[sourceIndex].isWhitespace()) {
                sourceIndex += 1
            }
        } else {
            normalized.append(envelope)
            sourceIndex = envelopeEnd + 1
        }
    }

    val result = normalized.toString()
    if (!removedWritingEnvelope) {
        return result
    }

    val trimmedResult = result.trimEnd()
    return if (trimmedResult.endsWith(":::")) {
        trimmedResult.dropLast(3).trimEnd()
    } else {
        result
    }
}

internal suspend fun runStreamingChatGenerationWithRetry(
    receivedText: StringBuilder,
    onRetry: suspend (attempt: Int, total: Int) -> Unit,
    onVisibleText: suspend (String) -> Unit,
    retryDelay: suspend (retryIndex: Int) -> Unit = { retryIndex ->
        delay(chatAutoRetryDelayMs(retryIndex))
    },
    stream: suspend (onDelta: suspend (String) -> Unit) -> String,
): String {
    var retryIndex = 0

    while (true) {
        try {
            val finalText = stream { delta ->
                receivedText.append(delta)
                val visibleText = receivedText.toString()
                if (visibleText.isNotBlank()) {
                    onVisibleText(visibleText)
                }
            }

            return finalText.ifBlank { receivedText.toString() }
        } catch (error: Throwable) {
            if (error is CancellationException) {
                throw error
            }
            if (
                retryIndex < MAX_CHAT_AUTO_RETRIES &&
                isRetryableChatGenerationError(error, receivedText)
            ) {
                receivedText.clear()
                retryIndex += 1
                onRetry(retryIndex, MAX_CHAT_AUTO_RETRIES)
                retryDelay(retryIndex - 1)
                continue
            }
            throw error
        }
    }
}

internal suspend fun streamChatGenerationWithRetry(
    aiClient: AiClient,
    request: PreparedChatMessageRequest,
    apiKey: String,
    proxyToken: String,
    messages: List<ChatMessage>,
    contextMessageLimit: Int,
    receivedText: StringBuilder,
    onRetry: suspend (attempt: Int, total: Int) -> Unit,
    onVisibleText: suspend (String) -> Unit,
): String = runStreamingChatGenerationWithRetry(
    receivedText = receivedText,
    onRetry = onRetry,
    onVisibleText = onVisibleText,
) { onDelta ->
    aiClient.stream(
        provider = request.requestProvider,
        apiKey = apiKey,
        proxyToken = proxyToken,
        model = request.model,
        messages = messages,
        contextMessageLimit = contextMessageLimit,
        onDelta = onDelta,
    )
}

internal suspend fun executeImageRequest(
    aiClient: AiClient,
    request: PreparedImageMessageRequest,
    snapshot: AppSnapshot,
    apiKey: String,
    proxyToken: String,
): GeneratedImage = when (request) {
        is PreparedImageMessageRequest.Generate -> aiClient.generateImage(
            provider = providerRequest(request.provider, snapshot),
            apiKey = apiKey,
            proxyToken = proxyToken,
            model = request.imageModel,
            responsesModel = request.responsesModel,
            prompt = request.prompt,
        )
        is PreparedImageMessageRequest.Edit -> aiClient.editImage(
            provider = providerRequest(request.provider, snapshot),
            apiKey = apiKey,
            proxyToken = proxyToken,
            model = request.imageModel,
            responsesModel = request.responsesModel,
            prompt = request.prompt,
            image = request.sourceImage,
        )
        is PreparedImageMessageRequest.Inpaint -> aiClient.editImage(
            provider = providerRequest(request.provider, snapshot),
            apiKey = apiKey,
            proxyToken = proxyToken,
            model = request.imageModel,
            responsesModel = request.responsesModel,
            prompt = request.prompt,
            image = request.sourceImage,
            mask = request.maskImage,
        )
}
