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
import java.net.URI

class AiClient {
    private val client = HttpClient(Android)
    private val json = Json { explicitNulls = false }

    suspend fun send(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: List<ChatMessage>,
        proxyToken: String = "",
    ): String {
        val usesProxy = provider.proxyUrl?.isNotBlank() == true
        val endpoint = provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
            "${safeBaseUrl(it, "代理地址")}/proxy"
        }
            ?: when (provider.kind) {
                ProviderKind.Anthropic -> "${safeBaseUrl(provider.baseUrl, "Base URL")}/messages"
                ProviderKind.OpenAICompatible -> "${safeBaseUrl(provider.baseUrl, "Base URL")}/chat/completions"
            }

        val response = client.post(endpoint) {
            contentType(ContentType.Application.Json)
            if (apiKey.isNotBlank()) {
                when (provider.kind) {
                    ProviderKind.Anthropic -> header("x-api-key", apiKey)
                    ProviderKind.OpenAICompatible -> bearerAuth(apiKey)
                }
            }
            if (usesProxy) {
                require(proxyToken.isNotBlank()) { "代理访问密钥为空" }
                header("x-zerochat-proxy-token", proxyToken.trim())
                header("x-zerochat-base-url", safeBaseUrl(provider.baseUrl, "Base URL"))
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

    private fun safeBaseUrl(value: String, label: String): String {
        val trimmed = value.trim().trimEnd('/')
        val uri = URI(trimmed)
        val host = uri.host.orEmpty()
        val isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
        val isSafeScheme = uri.scheme == "https" || (uri.scheme == "http" && isLoopback)

        require(uri.userInfo == null) { "$label 不能包含用户名或密码" }
        require(uri.query == null && uri.fragment == null) { "$label 不能包含 query 或 fragment" }
        require(isSafeScheme) { "$label 必须使用 HTTPS，本机调试地址除外" }

        return trimmed
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
