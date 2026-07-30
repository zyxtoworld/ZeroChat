package app.zerochat.ai

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.chat.PreparedImageMessageRequest
import app.zerochat.ui.chat.executeImageRequest
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
import java.net.SocketTimeoutException

class AiClientImageRequestCostTest {
    @Test
    fun directImageRouteFallsBackOnlyForExplicitUnsupportedOrServerStatuses() {
        val cases = listOf(
            HttpStatusCode.NotFound to true,
            HttpStatusCode.MethodNotAllowed to true,
            HttpStatusCode.InternalServerError to true,
            HttpStatusCode.NotImplemented to true,
            HttpStatusCode.ServiceUnavailable to true,
            HttpStatusCode.BadRequest to false,
            HttpStatusCode.Unauthorized to false,
            HttpStatusCode.Forbidden to false,
            HttpStatusCode.RequestTimeout to false,
            HttpStatusCode.Conflict to false,
            HttpStatusCode(425, "Too Early") to false,
            HttpStatusCode.UnprocessableEntity to false,
            HttpStatusCode.TooManyRequests to false,
            HttpStatusCode(600, "Custom") to false,
        )

        cases.forEach { (status, shouldFallback) ->
            val paths = mutableListOf<String>()
            val http = HttpClient(
                MockEngine { request ->
                    paths += request.url.encodedPath
                    if (paths.size == 1) {
                        respondJson(status, errorBody(status))
                    } else {
                        respondJson(HttpStatusCode.OK, IMAGE_RESPONSE)
                    }
                },
            )

            try {
                if (shouldFallback) {
                    val image = runBlocking { generateImage(AiClient(http)) }
                    assertEquals(IMAGE_DATA_URL, image.dataUrl, status.toString())
                    assertEquals(
                        listOf("/v1/images/generations", "/v1/responses"),
                        paths,
                        status.toString(),
                    )
                } else {
                    val failure = assertThrows(AiProviderHttpException::class.java) {
                        runBlocking { generateImage(AiClient(http)) }
                    }
                    assertEquals(status.value, failure.status, status.toString())
                    assertEquals(listOf("/v1/images/generations"), paths, status.toString())
                }
            } finally {
                http.close()
            }
        }
    }

    @Test
    fun responsesGenerateCandidatesContinueFor400And422Only() {
        listOf(HttpStatusCode.BadRequest, HttpStatusCode.UnprocessableEntity).forEach { status ->
            var calls = 0
            val http = HttpClient(
                MockEngine {
                    calls += 1
                    when (calls) {
                        1 -> respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                        2 -> respondJson(status, errorBody(status))
                        else -> respondJson(HttpStatusCode.OK, IMAGE_RESPONSE)
                    }
                },
            )

            try {
                val image = runBlocking { generateImage(AiClient(http)) }
                assertEquals(IMAGE_DATA_URL, image.dataUrl, status.toString())
                assertEquals(3, calls, status.toString())
            } finally {
                http.close()
            }
        }
    }

    @Test
    fun responsesEditCandidatesContinueFor422() {
        var calls = 0
        val http = HttpClient(
            MockEngine {
                calls += 1
                when (calls) {
                    1 -> respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                    2 -> respondJson(
                        HttpStatusCode.UnprocessableEntity,
                        errorBody(HttpStatusCode.UnprocessableEntity),
                    )
                    else -> respondJson(HttpStatusCode.OK, IMAGE_RESPONSE)
                }
            },
        )

        try {
            val image = runBlocking { editImage(AiClient(http)) }
            assertEquals(IMAGE_DATA_URL, image.dataUrl)
            assertEquals(3, calls)
        } finally {
            http.close()
        }
    }

    @Test
    fun responsesGenerateCandidatesStopOnEveryNonModelHttpFailure() {
        val statuses = listOf(
            HttpStatusCode.Unauthorized,
            HttpStatusCode.Forbidden,
            HttpStatusCode.RequestTimeout,
            HttpStatusCode.Conflict,
            HttpStatusCode(425, "Too Early"),
            HttpStatusCode.TooManyRequests,
            HttpStatusCode.InternalServerError,
            HttpStatusCode.BadGateway,
            HttpStatusCode.ServiceUnavailable,
            HttpStatusCode.GatewayTimeout,
        )

        statuses.forEach { status ->
            var calls = 0
            val http = HttpClient(
                MockEngine {
                    calls += 1
                    if (calls == 1) {
                        respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                    } else {
                        respondJson(status, errorBody(status))
                    }
                },
            )

            try {
                val failure = assertThrows(AiProviderHttpException::class.java) {
                    runBlocking { generateImage(AiClient(http)) }
                }
                assertEquals(status.value, failure.status, status.toString())
                assertEquals(2, calls, status.toString())
            } finally {
                http.close()
            }
        }
    }

    @Test
    fun responsesEditCandidatesStopOnServerFailure() {
        var calls = 0
        val http = HttpClient(
            MockEngine {
                calls += 1
                if (calls == 1) {
                    respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                } else {
                    respondJson(
                        HttpStatusCode.ServiceUnavailable,
                        errorBody(HttpStatusCode.ServiceUnavailable),
                    )
                }
            },
        )

        try {
            val failure = assertThrows(AiProviderHttpException::class.java) {
                runBlocking { editImage(AiClient(http)) }
            }
            assertEquals(503, failure.status)
            assertEquals(2, calls)
        } finally {
            http.close()
        }
    }

    @Test
    fun responsesCandidatesStopOnNetworkAndTimeoutFailures() {
        listOf<() -> IOException>(
            { IOException("network unavailable") },
            { SocketTimeoutException("socket timeout") },
        ).forEach { failure ->
            var calls = 0
            val http = HttpClient(
                MockEngine {
                    calls += 1
                    if (calls == 1) {
                        respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                    } else {
                        throw failure()
                    }
                },
            )

            try {
                assertThrows(IOException::class.java) {
                    runBlocking { generateImage(AiClient(http)) }
                }
                assertEquals(2, calls)
            } finally {
                http.close()
            }
        }
    }

    @Test
    fun responsesCandidatesKeepCancellationImmediate() {
        var calls = 0
        val http = HttpClient(
            MockEngine {
                calls += 1
                if (calls == 1) {
                    respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                } else {
                    throw CancellationException("stopped")
                }
            },
        )

        try {
            assertThrows(CancellationException::class.java) {
                runBlocking { generateImage(AiClient(http)) }
            }
            assertEquals(2, calls)
        } finally {
            http.close()
        }
    }

    @Test
    fun responsesCandidatesStopOnParseFailure() {
        var calls = 0
        val http = HttpClient(
            MockEngine {
                calls += 1
                if (calls == 1) {
                    respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                } else {
                    respondJson(HttpStatusCode.OK, "{")
                }
            },
        )

        try {
            assertThrows(Exception::class.java) {
                runBlocking { generateImage(AiClient(http)) }
            }
            assertEquals(2, calls)
        } finally {
            http.close()
        }
    }

    @Test
    fun imageRequestRunnerDoesNotRepeatAfterMaterializationFailure() {
        var calls = 0
        val http = HttpClient(
            MockEngine {
                calls += 1
                when (calls) {
                    1 -> respondJson(HttpStatusCode.NotFound, errorBody(HttpStatusCode.NotFound))
                    2 -> respondJson(
                        HttpStatusCode.OK,
                        """{"data":[{"url":"https://cdn.example.test/result.png"}]}""",
                    )
                    else -> respondJson(
                        HttpStatusCode.ServiceUnavailable,
                        errorBody(HttpStatusCode.ServiceUnavailable),
                    )
                }
            },
        )

        try {
            val failure = assertThrows(AiProviderHttpException::class.java) {
                runBlocking {
                    executeImageRequest(
                        aiClient = AiClient(http),
                        request = PreparedImageMessageRequest.Generate(
                            provider = provider(),
                            imageModel = IMAGE_MODEL,
                            responsesModel = RESPONSES_MODEL,
                            prompt = "Generate",
                        ),
                        snapshot = AppSnapshot(providers = listOf(provider())),
                        apiKey = "provider-key",
                        proxyToken = "",
                    )
                }
            }
            assertEquals(503, failure.status)
            assertEquals(3, calls)
        } finally {
            http.close()
        }
    }

    private suspend fun generateImage(client: AiClient): GeneratedImage = client.generateImage(
        provider = provider(),
        apiKey = "provider-key",
        model = IMAGE_MODEL,
        responsesModel = RESPONSES_MODEL,
        prompt = "Generate",
    )

    private suspend fun editImage(client: AiClient): GeneratedImage = client.editImage(
        provider = provider(),
        apiKey = "provider-key",
        model = IMAGE_MODEL,
        responsesModel = RESPONSES_MODEL,
        prompt = "Edit",
        image = ImageUpload(
            bytes = byteArrayOf(1, 2, 3),
            fileName = "source.png",
            mimeType = "image/png",
        ),
    )

    private fun provider(): ProviderConfig = ProviderConfig(
        id = "provider-1",
        name = "Provider",
        kind = ProviderKind.OpenAICompatible,
        baseUrl = "https://api.example.test/v1",
        model = "chat-default",
        imageModel = IMAGE_MODEL,
        enabled = true,
        needsApiKey = true,
        createdAt = 1,
        updatedAt = 1,
    )

    private fun io.ktor.client.engine.mock.MockRequestHandleScope.respondJson(
        status: HttpStatusCode,
        body: String,
    ) = respond(
        content = ByteReadChannel(body),
        status = status,
        headers = headersOf(HttpHeaders.ContentType, ContentType.Application.Json.toString()),
    )

    private fun errorBody(status: HttpStatusCode): String =
        """{"error":{"message":"failure ${status.value}"}}"""

    private companion object {
        const val IMAGE_MODEL = "gpt-image-1"
        const val RESPONSES_MODEL = "responses-primary"
        const val IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgo="
        const val IMAGE_RESPONSE = """{"data":[{"b64_json":"iVBORw0KGgo="}]}"""
    }
}
