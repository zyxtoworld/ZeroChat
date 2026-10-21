package app.zerochat.ai

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.encodedPath
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AiClientCapabilityRuntimeTest {
    @Test
    fun managedProxyDoesNotReceiveStaleProviderKey() = runBlocking {
        val http = HttpClient(
            MockEngine { request ->
                assertNull(request.headers[HttpHeaders.Authorization])
                assertEquals("access-key", request.headers["x-zerochat-access-key"])
                json("""{"data":[{"embedding":[0.1]}]}""")
            },
        )

        AiClient(http).use { ai ->
            ai.createEmbedding(
                provider = provider(needsApiKey = false),
                apiKey = "stale-provider-key",
                proxyToken = "access-key",
                model = "text-embedding-3-large",
                input = "hello",
            )
        }
        Unit

    }
    @Test
    fun capabilityRuntimeRequestsUseProxyActions() = runBlocking {
        val seen = mutableListOf<String>()
        val http = HttpClient(
            MockEngine { request ->
                val action = request.headers["x-zerochat-proxy-action"].orEmpty()
                seen += action

                assertEquals(HttpMethod.Post, request.method)
                assertEquals("/proxy", request.url.encodedPath)
                assertEquals("access-key", request.headers["x-zerochat-access-key"])
                assertEquals("https://api.example.com/v1", request.headers["x-zerochat-base-url"])
                assertNull(request.headers["x-zerochat-provider-id"])
                assertNull(request.headers["x-zerochat-provider-name"])
                assertEquals("openai-compatible", request.headers["x-zerochat-provider-kind"])

                respondForAction(action)
            },
        )
        AiClient(http).use { ai ->
        val provider = provider()

        assertEquals(
            listOf<Byte>(0x00, 0x01, 0x02, 0x03),
            ai.createSpeech(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "tts-1",
                input = "hello",
            ).toList(),
        )
        assertEquals(
            """{"text":"hello"}""",
            ai.transcribeAudio(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "gpt-4o-transcribe",
                audio = AudioUpload("voice".encodeToByteArray()),
            ),
        )
        assertEquals(
            """{"data":[{"embedding":[0.1]}]}""",
            ai.createEmbedding(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "text-embedding-3-large",
                input = "hello",
            ),
        )
        assertEquals(
            """{"data":[{"embedding":[0.1]}]}""",
            ai.createEmbeddings(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "text-embedding-3-large",
                input = listOf("hello", "world"),
            ),
        )
        assertEquals(
            """{"results":[{"flagged":false}]}""",
            ai.moderateText(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "omni-moderation-latest",
                input = "hello",
            ),
        )
        assertEquals(
            """{"id":"sess_1"}""",
            ai.createRealtimeSession(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "gpt-realtime-2",
            ),
        )
        assertEquals(
            """{"client_secret":{"value":"ek_test"}}""",
            ai.createRealtimeClientSecret(
                provider = provider,
                apiKey = "provider-key",
                proxyToken = "access-key",
                model = "gpt-realtime-2",
            ),
        )

        assertEquals(
            listOf(
                "audio-speech",
                "audio-transcriptions",
                "embeddings",
                "embeddings",
                "moderations",
                "realtime",
                "realtime-client-secrets",
            ),
            seen,
        )
        }
    }

    @Test
    fun successfulTextSpeechResponsesFailBeforePlayback() {
        AiClient(
            HttpClient(
                MockEngine {
                    respond(
                        content = ByteReadChannel("""{"error":"upstream"}"""),
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, "audio/mpeg"),
                    )
                },
            ),
        ).use { ai ->

        assertThrows(IllegalArgumentException::class.java) {
            runBlocking {
                ai.createSpeech(
                    provider = provider(),
                    apiKey = "provider-key",
                    model = "tts-1",
                    input = "hello",
                )
            }
        }
        }
    }

    private fun MockRequestHandleScope.respondForAction(action: String) = when (action) {
        "audio-speech" -> respond(
            content = ByteReadChannel(byteArrayOf(0x00, 0x01, 0x02, 0x03)),
            status = HttpStatusCode.OK,
            headers = headersOf(HttpHeaders.ContentType, "audio/mpeg"),
        )
        "audio-transcriptions" -> json("""{"text":"hello"}""")
        "embeddings" -> json("""{"data":[{"embedding":[0.1]}]}""")
        "moderations" -> json("""{"results":[{"flagged":false}]}""")
        "realtime" -> json("""{"id":"sess_1"}""")
        "realtime-client-secrets" -> json("""{"client_secret":{"value":"ek_test"}}""")
        else -> error("Unexpected action $action")
    }

    private fun MockRequestHandleScope.json(body: String) = respond(
        content = ByteReadChannel(body),
        status = HttpStatusCode.OK,
        headers = headersOf(HttpHeaders.ContentType, "application/json"),
    )

    private fun provider(needsApiKey: Boolean = true): ProviderConfig = ProviderConfig(
        id = "provider-1",
        name = "Example",
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.com/v1/realtime/client_secrets",
        proxyUrl = "https://worker.example.com",
        model = "gpt-5.4-mini",
        models = listOf(
            "gpt-5.4-mini",
            "tts-1",
            "gpt-4o-transcribe",
            "text-embedding-3-large",
            "omni-moderation-latest",
            "gpt-realtime-2",
            "gpt-realtime",
        ),
        capabilities = listOf("chat", "audio", "embeddings", "moderation", "realtime"),
        enabled = true,
        needsApiKey = needsApiKey,
        createdAt = 1,
        updatedAt = 1,
    )
}
