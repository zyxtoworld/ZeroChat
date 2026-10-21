package app.zerochat.ai

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.MAX_IMAGE_FILE_BYTES
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class AiClientGeneratedImagePersistenceTest {
    @Test
    fun urlOnlyGeneratedImageIsMaterializedWithoutForwardingProviderHeaders() = runBlocking {
        val signedUrl = "https://cdn.example.test/generated.png?token=temporary-secret&expires=1"
        val png = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
        )
        val requests = mutableListOf<String>()
        val http = HttpClient(
            MockEngine { request ->
                requests += request.url.toString()
                if (request.url.host == "api.example.test") {
                    assertEquals(HttpMethod.Post, request.method)
                    assertEquals("Bearer provider-key", request.headers[HttpHeaders.Authorization])
                    respond(
                        content = ByteReadChannel("""{"data":[{"url":"$signedUrl"}]}"""),
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
                    )
                } else {
                    assertEquals(HttpMethod.Get, request.method)
                    assertNull(request.headers[HttpHeaders.Authorization])
                    assertNull(request.headers["x-zerochat-access-key"])
                    assertNull(request.headers["x-zerochat-proxy-action"])
                    respond(
                        content = ByteReadChannel(png),
                        status = HttpStatusCode.OK,
                        headers = headersOf(HttpHeaders.ContentType, ContentType.Image.PNG.toString()),
                    )
                }
            },
        )

        val image = AiClient(http).use { ai ->
            ai.generateImage(
                provider = provider(),
                apiKey = "provider-key",
                model = "gpt-image-2",
                prompt = "Draw a durable image",
            )
        }

        assertEquals("data:image/png;base64,iVBORw0KGgoA", image.dataUrl)
        assertNull(image.url)
        assertEquals("image/png", image.mimeType)
        assertFalse(image.toString().contains("temporary-secret"))
        assertEquals(2, requests.size)
    }

    @Test
    fun oversizedRemoteGeneratedImageIsRejectedBeforeBuffering() {
        val http = HttpClient(
            MockEngine {
                respond(
                    content = ByteReadChannel(byteArrayOf(0x00)),
                    status = HttpStatusCode.OK,
                    headers = headersOf(
                        HttpHeaders.ContentLength,
                        (MAX_IMAGE_FILE_BYTES + 1).toString(),
                    ),
                )
            },
        )

        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                AiClient(http).use { ai ->
                    ai.materializeGeneratedImage(
                        GeneratedImage(url = "https://cdn.example.test/oversized.png?token=temporary"),
                    )
                }
            }
        }
    }

    private fun provider(): ProviderConfig = ProviderConfig(
        id = "provider-1",
        name = "Provider",
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.test/v1",
        model = "gpt-5",
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )
}
