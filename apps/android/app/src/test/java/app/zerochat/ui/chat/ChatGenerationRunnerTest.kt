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
    fun normalizeAssistantMessageContentConvertsHtmlToRenderedMarkdown() {
        val content = """
            <h2>Release notes</h2>
            <p>Hello <strong>world</strong><br>next &amp; ready.</p>
            <ol><li>one</li><li><a href="https://example.com/docs">Docs</a></li></ol>
        """.trimIndent()

        assertEquals(
            """
                ## Release notes

                Hello **world**
                next & ready.

                1. one
                2. [Docs](https://example.com/docs)
            """.trimIndent(),
            normalizeAssistantMessageContent(content),
        )
    }

    @Test
    fun normalizeAssistantMessageContentFlattensPresentationDslWithoutLeakingTagsOrCitationMetadata() {
        val content = """
            <box gap={2}>
            <text color="primary">天津天气</text>
            <grid columns={2} gap={2}>
            <grid-item><row align="center" gap={2}><icon name="cloud-rain" size="xl"/><box gap={1}><text color="secondary">降水概率</text> 约 10%</box></row></grid-item>
            <grid-item><row align="center" gap={2}><icon name="moon" size="xl"/><box gap={1}><text color="secondary">今晚</text> 气温逐渐下降</box></row></grid-item>
            </grid>
            <text color="secondary">天气参考：中国天气网天津站。<Cite refs={["turn0"]}/></text>
            </box>
        """.trimIndent()

        assertEquals(
            """
                天津天气

                降水概率 约 10%

                今晚 气温逐渐下降

                天气参考：中国天气网天津站。
            """.trimIndent(),
            normalizeAssistantMessageContent(content),
        )
    }

    @Test
    fun normalizeAssistantMessageContentPreservesHtmlInsideFencedCode() {
        val content = """
            <p>Before</p>
            ```html
            <div>Keep this code</div>
            ```
            <p>After</p>
        """.trimIndent()

        assertEquals(
            "Before\n```html\n<div>Keep this code</div>\n```\nAfter",
            normalizeAssistantMessageContent(content),
        )
    }

    @Test
    fun nextStreamingTextFrameRevealsOneUnicodeCodePointAtATime() {
        val target = "A🙂好"

        assertEquals("A", nextStreamingTextFrame("", target))
        assertEquals("A🙂", nextStreamingTextFrame("A", target))
        assertEquals(target, nextStreamingTextFrame("A🙂", target))
        assertEquals(target, nextStreamingTextFrame(target, target))
    }

    @Test
    fun nextStreamingTextFrameReplacesNonPrefixCorrections() {
        assertEquals("Corrected", nextStreamingTextFrame("Draft", "Corrected"))
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
        ) { onText ->
            streamCalls += 1
            if (streamCalls == 1) {
                throw IOException("network timeout")
            }

            onText("Ze")
            onText("Zero")
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
    fun streamingChatDoesNotPublishWhitespaceBeforeRetryingAnEmptyResponse() = runBlocking {
        val receivedText = StringBuilder()
        val visibleTexts = mutableListOf<String>()
        var streamCalls = 0

        val result = runStreamingChatGenerationWithRetry(
            receivedText = receivedText,
            onRetry = { _, _ -> },
            onVisibleText = { visibleTexts += it },
            retryDelay = {},
        ) { onText ->
            streamCalls += 1
            if (streamCalls == 1) {
                onText("  \n")
                throw IOException("empty provider response")
            }

            onText("Zero")
            "Zero"
        }

        assertEquals("Zero", result)
        assertEquals("Zero", receivedText.toString())
        assertEquals(listOf("Zero"), visibleTexts)
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
                ) { onText ->
                    streamCalls += 1
                    onText("partial")
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
