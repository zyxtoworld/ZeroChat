package app.zerochat.ui.chat

import app.zerochat.ai.AiClient
import app.zerochat.ai.AiProviderHttpException
import app.zerochat.ai.ImageUpload
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.MAX_CHAT_AUTO_RETRIES
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.IOException

class ChatGenerationRunnerTest {
    @Test
    fun normalizeAssistantMessageContentStripsWritingArtifactEnvelope() {
        val content = """
            :::writing{variant="document" id="58391"}
            Keeping the completed reply visible helps users continue the conversation.
            :::
        """.trimIndent()

        assertEquals(
            "Keeping the completed reply visible helps users continue the conversation.",
            normalizeAssistantMessageContent(content),
        )
    }

    @Test
    fun normalizeAssistantMessageContentHidesIncompleteWritingArtifactEnvelope() {
        assertEquals(
            "",
            normalizeAssistantMessageContent(":::writing{variant=\"document\""),
        )
    }

    @Test
    fun normalizeAssistantMessageContentStripsAnInlineWritingArtifactEnvelope() {
        val content = """
            Here is the answer.:::writing{variant="document" id="48391"} The rest is the answer.:::
        """.trimIndent()

        assertEquals(
            "Here is the answer. The rest is the answer.",
            normalizeAssistantMessageContent(content),
        )
    }

    @Test
    fun normalizeAssistantMessageContentHidesAnIncompleteInlineWritingArtifactEnvelope() {
        assertEquals(
            "Here is the answer.",
            normalizeAssistantMessageContent("Here is the answer.:::writing{variant=\"document\""),
        )
    }

    @Test
    fun normalizeAssistantMessageContentPreservesOrdinaryMarkdown() {
        val content = "::: note\nThis is a normal message.\n:::"

        assertEquals(content, normalizeAssistantMessageContent(content))
    }

    @Test
    fun streamingChatRetriesTransientFailuresBeforeAnyVisibleText() = runBlocking {
        val receivedText = StringBuilder()
        val visibleTexts = mutableListOf<String>()
        val retryAttempts = mutableListOf<Int>()
        val retryDelays = mutableListOf<Int>()
        var streamCalls = 0

        val result = runStreamingChatGenerationWithRetry(
            receivedText = receivedText,
            onRetry = { attempt, total ->
                retryAttempts += attempt
                assertEquals(MAX_CHAT_AUTO_RETRIES, total)
            },
            onVisibleText = { visibleTexts += it },
            retryDelay = { retryDelays += it },
        ) { onDelta ->
            streamCalls += 1
            if (streamCalls == 1) {
                throw IOException("network timeout")
            }

            onDelta("Ze")
            onDelta("ro")
            ""
        }

        assertEquals("Zero", result)
        assertEquals("Zero", receivedText.toString())
        assertEquals(2, streamCalls)
        assertEquals(listOf(1), retryAttempts)
        assertEquals(listOf(0), retryDelays)
        assertEquals(listOf("Ze", "Zero"), visibleTexts)
    }

    @Test
    fun streamingChatDoesNotRetryAfterVisibleText() {
        val receivedText = StringBuilder()
        val retryAttempts = mutableListOf<Int>()
        var streamCalls = 0

        assertThrows(IOException::class.java) {
            runBlocking {
                runStreamingChatGenerationWithRetry(
                    receivedText = receivedText,
                    onRetry = { attempt, _ -> retryAttempts += attempt },
                    onVisibleText = {},
                    retryDelay = {},
                ) { onDelta ->
                    streamCalls += 1
                    onDelta("partial")
                    throw IOException("network timeout")
                }
            }
        }

        assertEquals("partial", receivedText.toString())
        assertEquals(1, streamCalls)
        assertEquals(emptyList<Int>(), retryAttempts)
    }

    @Test
    fun streamingChatKeepsCancellationCancellable() {
        val retryAttempts = mutableListOf<Int>()

        assertThrows(CancellationException::class.java) {
            runBlocking {
                runStreamingChatGenerationWithRetry(
                    receivedText = StringBuilder(),
                    onRetry = { attempt, _ -> retryAttempts += attempt },
                    onVisibleText = {},
                    retryDelay = {},
                ) {
                    throw CancellationException("stopped")
                }
            }
        }

        assertEquals(emptyList<Int>(), retryAttempts)
    }

    @Test
    fun imageRequestRunnerCallsProviderOnceForGenerateEditAndInpaint() {
        val provider = ProviderConfig(
            id = "provider-1",
            name = "Provider",
            kind = ProviderKind.OpenAICompatible,
            baseUrl = "https://api.example.test/v1",
            model = "gpt-5",
            imageModel = "gpt-image-1",
            enabled = true,
            needsApiKey = true,
            createdAt = 1,
            updatedAt = 1,
        )
        val upload = ImageUpload(
            bytes = byteArrayOf(1, 2, 3),
            fileName = "source.png",
            mimeType = "image/png",
        )
        val requests = listOf(
            PreparedImageMessageRequest.Generate(
                provider = provider,
                imageModel = "gpt-image-1",
                prompt = "Generate",
            ),
            PreparedImageMessageRequest.Edit(
                provider = provider,
                imageModel = "gpt-image-1",
                prompt = "Edit",
                sourceImage = upload,
            ),
            PreparedImageMessageRequest.Inpaint(
                provider = provider,
                imageModel = "gpt-image-1",
                prompt = "Inpaint",
                sourceImage = upload,
                maskImage = upload.copy(fileName = "mask.png"),
            ),
        )

        requests.forEach { request ->
            var providerCalls = 0
            val http = HttpClient(
                MockEngine {
                    providerCalls += 1
                    respond(
                        content = ByteReadChannel("""{"error":{"message":"slow down"}}"""),
                        status = HttpStatusCode.TooManyRequests,
                        headers = headersOf(
                            HttpHeaders.ContentType,
                            ContentType.Application.Json.toString(),
                        ),
                    )
                },
            )

            try {
                val failure = assertThrows(AiProviderHttpException::class.java) {
                    runBlocking {
                        executeImageRequest(
                            aiClient = AiClient(http),
                            request = request,
                            snapshot = AppSnapshot(providers = listOf(provider)),
                            apiKey = "provider-key",
                            proxyToken = "",
                        )
                    }
                }

                assertEquals(429, failure.status)
                assertEquals(1, providerCalls)
            } finally {
                http.close()
            }
        }
    }
}
