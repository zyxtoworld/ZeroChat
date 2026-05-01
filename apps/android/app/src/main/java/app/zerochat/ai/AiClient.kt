package app.zerochat.ai

import app.zerochat.data.ChatMessage
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class AiClient {
    private val client = HttpClient(Android)
    private val json = Json { explicitNulls = false }

    suspend fun send(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: List<ChatMessage>,
    ): String {
        val endpoint = provider.proxyUrl?.trimEnd('/')?.let { "$it/proxy" }
            ?: when (provider.kind) {
                ProviderKind.Anthropic -> "${provider.baseUrl.trimEnd('/')}/messages"
                ProviderKind.OpenAICompatible -> "${provider.baseUrl.trimEnd('/')}/chat/completions"
            }

        val response = client.post(endpoint) {
            contentType(ContentType.Application.Json)
            if (apiKey.isNotBlank()) {
                when (provider.kind) {
                    ProviderKind.Anthropic -> header("x-api-key", apiKey)
                    ProviderKind.OpenAICompatible -> bearerAuth(apiKey)
                }
            }
            provider.proxyUrl?.let {
                header("x-zerochat-base-url", provider.baseUrl)
                header(
                    "x-zerochat-provider-kind",
                    if (provider.kind == ProviderKind.Anthropic) "anthropic" else "openai-compatible",
                )
            }
            val payload = OpenAiRequest(
                model,
                messages.map { OpenAiMessage(it.role.name.lowercase(), it.content) },
            )
            setBody(json.encodeToString(OpenAiRequest.serializer(), payload))
        }

        return response.bodyAsText()
    }
}

@Serializable
private data class OpenAiRequest(
    val model: String,
    val messages: List<OpenAiMessage>,
    val stream: Boolean = false,
    val temperature: Double = 0.7,
)

@Serializable
private data class OpenAiMessage(
    val role: String,
    val content: String,
)
