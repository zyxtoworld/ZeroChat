package app.zerochat.ai

import app.zerochat.data.ChatMessage
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.client.request.url
import io.ktor.http.HttpMethod
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

class ResponsesWebSocketException(
    val fallbackAllowed: Boolean,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

private const val RESPONSES_WS_AUTH_TYPE = "zerochat.proxy.authorize"
private const val RESPONSES_WS_READY_TYPE = "zerochat.proxy.ready"
private const val RESPONSES_WS_ERROR_TYPE = "zerochat.proxy.error"

private fun responsesWebSocketEndpoint(provider: ProviderConfig): String {
    val endpoint = responsesWebSocketEndpointFor(provider)
    return when {
        endpoint.startsWith("https://") -> "wss://${endpoint.removePrefix("https://")}"
        endpoint.startsWith("http://") -> "ws://${endpoint.removePrefix("http://")}"
        else -> throw IllegalArgumentException("Responses WebSocket endpoint must use HTTPS.")
    }
}

private fun responseCreatePayload(json: Json, body: String): String {
    val request = json.parseToJsonElement(body).jsonObject.toMutableMap()
    request.remove("stream")
    return buildJsonObject {
        put("type", JsonPrimitive("response.create"))
        request.forEach { (key, value) -> put(key, value) }
    }.toString()
}

private fun proxyAuthorizationPayload(
    provider: ProviderConfig,
    apiKey: String,
    proxyToken: String,
): String = buildJsonObject {
    put("type", JsonPrimitive(RESPONSES_WS_AUTH_TYPE))
    put("accessKey", JsonPrimitive(proxyToken.trim()))
    put("providerKind", JsonPrimitive("openai-responses"))
    put("baseUrl", JsonPrimitive(provider.baseUrl))
    if (providerNeedsClientKey(provider)) {
        put("apiKey", JsonPrimitive(apiKey.trim()))
    }
}.toString()

private fun eventType(event: JsonObject): String =
    (event["type"] as? JsonPrimitive)?.contentOrNull.orEmpty()

private fun eventErrorMessage(event: JsonObject): String =
    ((event["error"] as? JsonObject)?.get("message") as? JsonPrimitive)
        ?.contentOrNull
        ?: "Responses WebSocket request failed."

internal suspend fun streamResponsesWebSocket(
    client: HttpClient,
    json: Json,
    provider: ProviderConfig,
    apiKey: String,
    model: String,
    messages: List<app.zerochat.data.ChatMessage>,
    contextMessageLimit: Int,
    proxyToken: String,
    onDelta: suspend (String) -> Unit,
): String {
    require(provider.kind == ProviderKind.OpenAIResponses) {
        "Responses WebSocket requires an OpenAI Responses provider."
    }

    val endpoint = responsesWebSocketEndpoint(provider)
    val body = chatRequestBody(json, provider, model, messages, contextMessageLimit, stream = true)
    val createPayload = responseCreatePayload(json, body)
    val proxy = !provider.proxyUrl.isNullOrBlank()
    var receivedDelta = false
    var received = ""

    try {
        withTimeout(AI_STREAM_IDLE_TIMEOUT_MS) {
            client.webSocket(
                method = HttpMethod.Get,
                request = {
                    url(endpoint)
                    if (!proxy) {
                        applyAuthHeaders(provider, apiKey)
                    }
                },
            ) {
                if (proxy) {
                    send(Frame.Text(proxyAuthorizationPayload(provider, apiKey, proxyToken)))
                    while (true) {
                        val frame = incoming.receive()
                        if (frame !is Frame.Text) continue
                        val event = json.parseToJsonElement(frame.readText()).jsonObject
                        when (eventType(event)) {
                            RESPONSES_WS_READY_TYPE -> {
                                send(Frame.Text(createPayload))
                                break
                            }
                            RESPONSES_WS_ERROR_TYPE -> {
                                throw ResponsesWebSocketException(
                                    fallbackAllowed = !receivedDelta,
                                    message = eventErrorMessage(event),
                                )
                            }
                        }
                    }
                } else {
                    send(Frame.Text(createPayload))
                }

                for (frame in incoming) {
                    if (frame !is Frame.Text) continue
                    val event = json.parseToJsonElement(frame.readText()).jsonObject
                    when (eventType(event)) {
                        "response.output_text.delta" -> {
                            val delta = (event["delta"] as? JsonPrimitive)?.contentOrNull.orEmpty()
                            if (delta.isNotEmpty()) {
                                receivedDelta = true
                                received += delta
                                onDelta(delta)
                            }
                        }
                        "response.completed" -> return@webSocket
                        "response.failed", "response.incomplete", "error" -> {
                            throw ResponsesWebSocketException(
                                fallbackAllowed = !receivedDelta,
                                message = eventErrorMessage(event),
                            )
                        }
                    }
                }
            }
        }
    } catch (error: TimeoutCancellationException) {
        if (!receivedDelta) {
            throw ResponsesWebSocketException(true, "Responses WebSocket timed out.", error)
        }
        throw error
    } catch (error: ResponsesWebSocketException) {
        throw error
    } catch (error: Throwable) {
        throw ResponsesWebSocketException(!receivedDelta, "Responses WebSocket connection failed.", error)
    }

    if (received.isBlank()) {
        throw ResponsesWebSocketException(true, "Responses WebSocket returned an empty response.")
    }

    return received
}
