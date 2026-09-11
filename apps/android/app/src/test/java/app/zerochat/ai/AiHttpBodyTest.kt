package app.zerochat.ai

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.isRetryableChatGenerationError
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.prepareGet
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteChannel
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AiHttpBodyTest {
    @Test
    fun audioResponseValidationRejectsTextualBodiesEvenWhenProviderMislabelsMime() {
        assertFalse(
            aiProviderAudioResponseLooksValid(
                """{"error":"upstream"}""".encodeToByteArray(),
                "audio/mpeg",
            ),
        )
        assertFalse(
            aiProviderAudioResponseLooksValid(
                "<html>upstream failure</html>".encodeToByteArray(),
                "application/octet-stream",
            ),
        )
        assertFalse(aiProviderAudioResponseLooksValid("audio-bytes".encodeToByteArray(), ""))
        assertTrue(
            aiProviderAudioResponseLooksValid(
                byteArrayOf(0x49, 0x44, 0x33, 0x04),
                "application/octet-stream",
            ),
        )
        assertTrue(
            aiProviderAudioResponseLooksValid(
                byteArrayOf(0x00, 0x01, 0x02, 0x03),
                "audio/mpeg",
            ),
        )
    }

    @Test
    fun providerResponseBudgetsMatchTheCrossPlatformContract() {
        assertEquals(16_384, MAX_AI_PROVIDER_ERROR_RESPONSE_BYTES)
        assertEquals(8_000_000, MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES)
        assertEquals(32_000_000, MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES)
        assertEquals(32_000_000, MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES)
        assertEquals(8_000_000, MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES)
    }

    @Test
    fun byteAccumulatorAcceptsTheBoundaryAndRejectsOverflow() {
        assertEquals(
            4,
            accumulateAiProviderResponseBytes(2, 2, 4, "AI test response"),
        )

        val failure = assertThrows(IllegalStateException::class.java) {
            accumulateAiProviderResponseBytes(4, 1, 4, "AI test response")
        }
        assertEquals(
            "AI test response exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    @Test
    fun boundedReaderRejectsOversizedDeclaredLengthBeforeReading() {
        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel("ok"),
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentLength, "5"),
                        )
                    },
                ).use { client ->
                    client.prepareGet("https://api.example.test").execute { response ->
                        response.readBoundedAiProviderText(
                            maxBytes = 4,
                            label = "AI test response",
                        )
                    }
                }
            }
        }

        assertEquals(
            "AI test response exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    @Test
    fun boundedReaderRejectsStreamedBytesWithoutDeclaredLength() {
        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel("12345"),
                            status = HttpStatusCode.OK,
                        )
                    },
                ).use { client ->
                    client.prepareGet("https://api.example.test").execute { response ->
                        response.readBoundedAiProviderText(
                            maxBytes = 4,
                            label = "AI test response",
                        )
                    }
                }
            }
        }

        assertEquals(
            "AI test response exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    @Test
    fun sseReaderPreservesLinesAndRejectsTotalOverflow() {
        runBlocking {
            val reader = BoundedAiProviderSseLineReader(
                channel = ByteReadChannel("data: one\r\n\r\n"),
                maxBytes = 64,
                label = "AI test stream",
                idleTimeoutMs = 1_000,
            )

            assertEquals("data: one\r", reader.readLine())
            assertEquals("\r", reader.readLine())
            assertEquals(null, reader.readLine())
        }

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                BoundedAiProviderSseLineReader(
                    channel = ByteReadChannel("12345"),
                    maxBytes = 4,
                    label = "AI test stream",
                    idleTimeoutMs = 1_000,
                ).readLine()
            }
        }
        assertEquals(
            "AI test stream exceeded the 4-byte safety limit.",
            failure.message,
        )
    }

    @Test
    fun sseReaderCloseCancelsTheUnderlyingResponseChannel() {
        val channel = ByteChannel()
        val reader = BoundedAiProviderSseLineReader(
            channel = channel,
            maxBytes = 64,
            label = "AI test stream",
            idleTimeoutMs = 1_000,
        )

        reader.close()
        reader.close()

        assertTrue(channel.isClosedForRead)
    }

    @Test
    fun aiClient503WithJsonErrorBodyRemainsRetryable() {
        val failure = aiClientFailure(
            status = HttpStatusCode.ServiceUnavailable,
            body = """{"error":{"message":"upstream overloaded","code":"capacity"}}""",
        )

        assertEquals(503, failure.status)
        assertEquals("upstream overloaded capacity", failure.providerDetail)
        assertEquals(AiProviderErrorCode.Server, failure.code)
        assertEquals("server", failure.code.value)
        assertTrue(failure.retryable)
        assertTrue(isRetryableChatGenerationError(failure, ""))
    }

    @Test
    fun aiClientSuccessfulEmptyStreamIsTypedRetryableProviderFailure() {
        val provider = provider()
        val failure = assertThrows(AiProviderHttpException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel(
                                """data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n""" +
                                    """data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n""" +
                                    "data: [DONE]\n\n",
                            ),
                            status = HttpStatusCode.OK,
                            headers = headersOf(HttpHeaders.ContentType, "text/event-stream"),
                        )
                    },
                ).use { client ->
                    AiClient(client).stream(
                        provider = provider,
                        apiKey = "provider-key",
                        model = provider.model,
                        messages = emptyList(),
                        onDelta = {},
                    )
                }
            }
        }

        assertEquals(200, failure.status)
        assertEquals(AiProviderErrorCode.Server, failure.code)
        assertTrue(failure.retryable)
        assertTrue(isRetryableChatGenerationError(failure, ""))
    }

    @Test
    fun aiClient401And429KeepClassificationMetadata() {
        val unauthorized = aiClientFailure(
            status = HttpStatusCode.Unauthorized,
            body = """{"error":{"message":"credential rejected","code":"invalid_key"}}""",
        )
        assertEquals(401, unauthorized.status)
        assertEquals("credential rejected invalid_key", unauthorized.providerDetail)
        assertEquals(AiProviderErrorCode.Auth, unauthorized.code)
        assertEquals("auth", unauthorized.code.value)
        assertFalse(unauthorized.retryable)
        assertFalse(isRetryableChatGenerationError(unauthorized, ""))

        val rateLimited = aiClientFailure(
            status = HttpStatusCode.TooManyRequests,
            body = """{"message":"slow down"}""",
        )
        assertEquals(429, rateLimited.status)
        assertEquals("slow down", rateLimited.providerDetail)
        assertEquals(AiProviderErrorCode.RateLimit, rateLimited.code)
        assertEquals("rate-limit", rateLimited.code.value)
        assertTrue(rateLimited.retryable)
        assertTrue(isRetryableChatGenerationError(rateLimited, ""))
    }

    @Test
    fun aiClientRejectsOversizedDeclaredModelAndStreamResponses() {
        val provider = provider()
        val modelFailure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel("{}"),
                            status = HttpStatusCode.OK,
                            headers = headersOf(
                                HttpHeaders.ContentLength,
                                (MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES + 1).toString(),
                            ),
                        )
                    },
                ).use { client ->
                    AiClient(client).listModels(provider, "provider-key")
                }
            }
        }
        assertEquals(
            "AI model list response exceeded the 8000000-byte safety limit.",
            modelFailure.message,
        )

        val streamFailure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel("data: [DONE]\n\n"),
                            status = HttpStatusCode.OK,
                            headers = headersOf(
                                HttpHeaders.ContentLength,
                                (MAX_AI_PROVIDER_STREAM_RESPONSE_BYTES + 1).toString(),
                            ),
                        )
                    },
                ).use { client ->
                    AiClient(client).stream(
                        provider = provider,
                        apiKey = "provider-key",
                        model = provider.model,
                        messages = emptyList(),
                        onDelta = {},
                    )
                }
            }
        }
        assertEquals(
            "AI provider stream response exceeded the 8000000-byte safety limit.",
            streamFailure.message,
        )
    }

    private fun aiClientFailure(
        status: HttpStatusCode,
        body: String,
    ): AiProviderHttpException {
        val provider = provider()
        return assertThrows(AiProviderHttpException::class.java) {
            runBlocking {
                HttpClient(
                    MockEngine {
                        respond(
                            content = ByteReadChannel(body),
                            status = status,
                            headers = headersOf(HttpHeaders.ContentType, "application/json"),
                        )
                    },
                ).use { client ->
                    AiClient(client).send(
                        provider = provider,
                        apiKey = "test-key",
                        model = provider.model,
                        messages = emptyList(),
                    )
                }
            }
        }
    }

    private fun provider(): ProviderConfig = ProviderConfig(
        id = "provider-1",
        name = "Example",
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.test/v1",
        model = "gpt-test",
        models = listOf("gpt-test"),
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )
}
