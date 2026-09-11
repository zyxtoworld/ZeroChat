package app.zerochat.ai

import app.zerochat.data.ChatMessage
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.isLikelyImageEditingModel
import app.zerochat.data.isLikelyImageModel
import app.zerochat.ui.MAX_IMAGE_FILE_BYTES
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.prepareGet
import io.ktor.client.request.preparePost
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import java.util.Base64

const val AI_CONNECT_TIMEOUT_MS = 30_000L
const val AI_MODEL_LIST_TIMEOUT_MS = 30_000L
const val AI_CHAT_REQUEST_TIMEOUT_MS = 60_000L
const val AI_IMAGE_REQUEST_TIMEOUT_MS = 180_000L
const val AI_CAPABILITY_REQUEST_TIMEOUT_MS = 60_000L
const val AI_STREAM_IDLE_TIMEOUT_MS = 90_000L

data class GeneratedImage(
    val dataUrl: String? = null,
    val url: String? = null,
    val mimeType: String = "image/png",
    val revisedPrompt: String? = null,
)

data class ImageUpload(
    val bytes: ByteArray,
    val fileName: String,
    val mimeType: String,
)

private fun generatedImageMimeType(bytes: ByteArray): String? = when {
    bytes.size >= 8 &&
        bytes[0] == 0x89.toByte() &&
        bytes[1] == 0x50.toByte() &&
        bytes[2] == 0x4e.toByte() &&
        bytes[3] == 0x47.toByte() &&
        bytes[4] == 0x0d.toByte() &&
        bytes[5] == 0x0a.toByte() &&
        bytes[6] == 0x1a.toByte() &&
        bytes[7] == 0x0a.toByte() -> "image/png"
    bytes.size >= 3 &&
        bytes[0] == 0xff.toByte() &&
        bytes[1] == 0xd8.toByte() &&
        bytes[2] == 0xff.toByte() -> "image/jpeg"
    bytes.size >= 12 &&
        bytes.copyOfRange(0, 4).contentEquals("RIFF".encodeToByteArray()) &&
        bytes.copyOfRange(8, 12).contentEquals("WEBP".encodeToByteArray()) -> "image/webp"
    else -> null
}

class AiClient(
    private val client: HttpClient = defaultAiHttpClient(),
) : AutoCloseable {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    suspend fun send(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: List<ChatMessage>,
        contextMessageLimit: Int = DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
        proxyToken: String = "",
    ): String = withTimeout(AI_CHAT_REQUEST_TIMEOUT_MS) {
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Model is required" }

        val statement = client.preparePost(endpointFor(provider)) {
            contentType(ContentType.Application.Json)
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "chat")

            setBody(chatRequestBody(json, provider, model, messages, contextMessageLimit, stream = false))
        }

        statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("AI request failed")
            }
            val text = response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
                "AI chat response",
            )

            chatTextFromResponse(json, text)
        }
    }

    suspend fun stream(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: List<ChatMessage>,
        contextMessageLimit: Int = DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT,
        proxyToken: String = "",
        onDelta: suspend (String) -> Unit,
    ): String {
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Model is required" }

        val received = StringBuilder()
        val statement = client.preparePost(endpointFor(provider)) {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, "text/event-stream")
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "chat")
            setBody(chatRequestBody(json, provider, model, messages, contextMessageLimit, stream = true))
        }

        statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("AI request failed")
            }

            val lineReader = response.boundedAiProviderSseLineReader()
            val eventData = mutableListOf<String>()

            try {
                while (true) {
                    val line = lineReader.readLine() ?: break
                    val trimmedLine = line.trimEnd('\r')

                    if (trimmedLine.isBlank()) {
                        val shouldContinue = processSseEvent(json, eventData, received, onDelta)
                        eventData.clear()
                        if (!shouldContinue) {
                            break
                        }
                        continue
                    }

                    when {
                        trimmedLine.startsWith("data:") ->
                            eventData += trimmedLine.removePrefix("data:").trimStart()
                        trimmedLine.startsWith(":") ||
                            trimmedLine.startsWith("event:") ||
                            trimmedLine.startsWith("id:") ||
                            trimmedLine.startsWith("retry:") -> Unit
                        trimmedLine.startsWith("{") || trimmedLine.startsWith("[") ->
                            eventData += trimmedLine
                    }
                }

                if (eventData.isNotEmpty()) {
                    processSseEvent(json, eventData, received, onDelta)
                }
            } finally {
                lineReader.close()
            }
        }

        if (received.isBlank()) {
            throw aiProviderEmptyResponseException()
        }

        return received.toString()
    }

    suspend fun listModels(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
    ): List<String> = withTimeout(AI_MODEL_LIST_TIMEOUT_MS) {
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }

        val statement = client.prepareGet(modelsEndpointFor(provider)) {
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "models")
        }
        statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("Model list request failed")
            }
            val text = response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
                "AI model list response",
            )

            val models = parseModelIds(json.parseToJsonElement(text))
            require(models.isNotEmpty()) { "No models found in provider response" }
            models
        }
    }

    suspend fun generateImage(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        responsesModel: String = "",
        prompt: String,
        size: String = "1024x1024",
    ): GeneratedImage = withTimeout(AI_IMAGE_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support image generation"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Image model is required" }
        require(prompt.isNotBlank()) { "Image prompt is required" }

        val statement = client.preparePost(imageGenerationEndpointFor(provider)) {
            contentType(ContentType.Application.Json)
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "image-generations")
            setBody(
                json.encodeToString(
                    ImageGenerationRequest.serializer(),
                    ImageGenerationRequest(
                        model = model.trim(),
                        prompt = prompt.trim(),
                        size = size,
                    ),
                ),
            )
        }
        val generated = statement.execute { response ->
            if (response.status.value !in 200..299) {
                if (shouldTryResponsesImageFallback(response.status.value)) {
                    response.discardAiProviderBody()
                    return@execute generateImageWithResponsesTool(
                        provider = provider,
                        apiKey = apiKey,
                        proxyToken = proxyToken,
                        responsesModel = responsesModel,
                        imageModel = model,
                        prompt = prompt.trim(),
                        size = size,
                    )
                }

                throw response.readAiProviderHttpException("Image generation request failed")
            }
            val text = response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                "AI image generation response",
            )

            generatedImageFromResponse(json.parseToJsonElement(text))
        }
        materializeGeneratedImage(generated)
    }

    suspend fun editImage(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        responsesModel: String = "",
        prompt: String,
        image: ImageUpload,
        mask: ImageUpload? = null,
        size: String = "1024x1024",
    ): GeneratedImage = withTimeout(AI_IMAGE_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support image editing"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Image model is required" }
        require(!isLikelyImageModel(model) || isLikelyImageEditingModel(model)) {
            "Image model does not support editing"
        }
        require(prompt.isNotBlank()) { "Image edit prompt is required" }

        val statement = client.preparePost(imageEditEndpointFor(provider)) {
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "image-edits")
            setBody(
                imageEditRequestBody(
                    model = model,
                    prompt = prompt,
                    image = image,
                    mask = mask,
                    size = size,
                ),
            )
        }
        val generated = statement.execute { response ->
            if (response.status.value !in 200..299) {
                if (mask == null && shouldTryResponsesImageFallback(response.status.value)) {
                    response.discardAiProviderBody()
                    return@execute editImageWithResponsesTool(
                        provider = provider,
                        apiKey = apiKey,
                        proxyToken = proxyToken,
                        responsesModel = responsesModel,
                        imageModel = model,
                        prompt = prompt.trim(),
                        image = image,
                        size = size,
                    )
                }

                throw response.readAiProviderHttpException("Image edit request failed")
            }
            val text = response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                "AI image edit response",
            )

            generatedImageFromResponse(json.parseToJsonElement(text))
        }
        materializeGeneratedImage(generated)
    }

    suspend fun createSpeech(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String,
        voice: String = "alloy",
        responseFormat: String? = null,
        speed: Double? = null,
    ): ByteArray = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support audio speech"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Audio speech model is required" }
        require(input.isNotBlank()) { "Audio speech input is required" }

        val statement = client.preparePost(audioSpeechEndpointFor(provider)) {
            contentType(ContentType.Application.Json)
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "audio-speech")
            setBody(
                audioSpeechRequestBody(
                    json = json,
                    model = model,
                    input = input.trim(),
                    voice = voice,
                    responseFormat = responseFormat,
                    speed = speed,
                ),
            )
        }
        statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("Audio speech request failed")
            }

            val bytes = response.readBoundedAiProviderBytes(
                MAX_AI_PROVIDER_AUDIO_RESPONSE_BYTES,
                "AI audio speech response",
            )
            require(
                aiProviderAudioResponseLooksValid(
                    bytes,
                    response.headers[HttpHeaders.ContentType].orEmpty(),
                ),
            ) { "AI audio speech response was not valid audio." }
            bytes
        }
    }

    suspend fun transcribeAudio(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        audio: AudioUpload,
        prompt: String? = null,
        language: String? = null,
        responseFormat: String? = null,
        temperature: Double? = null,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support audio transcription"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Audio transcription model is required" }
        require(audio.bytes.isNotEmpty()) { "Audio transcription file is required" }

        val statement = client.preparePost(audioTranscriptionEndpointFor(provider)) {
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, "audio-transcriptions")
            setBody(
                audioTranscriptionRequestBody(
                    model = model,
                    audio = audio,
                    prompt = prompt,
                    language = language,
                    responseFormat = responseFormat,
                    temperature = temperature,
                ),
            )
        }
        statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("Audio transcription request failed")
            }

            response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
                "AI audio transcription response",
            )
        }
    }

    suspend fun createEmbedding(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support embeddings"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Embedding model is required" }
        require(input.isNotBlank()) { "Embedding input is required" }

        postJsonCapability(
            provider = provider,
            apiKey = apiKey,
            proxyToken = proxyToken,
            endpoint = embeddingsEndpointFor(provider),
            action = "embeddings",
            body = embeddingsRequestBody(json, model, input.trim()),
            failurePrefix = "Embeddings request failed",
        )
    }

    suspend fun createEmbeddings(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: List<String>,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support embeddings"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Embedding model is required" }
        val normalizedInput = input.map { it.trim() }.filter { it.isNotEmpty() }
        require(normalizedInput.isNotEmpty()) { "Embedding input is required" }

        postJsonCapability(
            provider = provider,
            apiKey = apiKey,
            proxyToken = proxyToken,
            endpoint = embeddingsEndpointFor(provider),
            action = "embeddings",
            body = embeddingsRequestBody(json, model, normalizedInput),
            failurePrefix = "Embeddings request failed",
        )
    }

    suspend fun moderateText(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support moderation"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Moderation model is required" }
        require(input.isNotBlank()) { "Moderation input is required" }

        postJsonCapability(
            provider = provider,
            apiKey = apiKey,
            proxyToken = proxyToken,
            endpoint = moderationsEndpointFor(provider),
            action = "moderations",
            body = moderationsRequestBody(json, model, input.trim()),
            failurePrefix = "Moderation request failed",
        )
    }

    suspend fun createRealtimeSession(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        modalities: List<String> = listOf("text"),
        instructions: String? = null,
        voice: String? = null,
        inputAudioFormat: String? = null,
        outputAudioFormat: String? = null,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support realtime"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Realtime model is required" }

        postJsonCapability(
            provider = provider,
            apiKey = apiKey,
            proxyToken = proxyToken,
            endpoint = realtimeEndpointFor(provider),
            action = "realtime",
            body = realtimeRequestBody(
                json = json,
                model = model,
                modalities = modalities,
                instructions = instructions,
                voice = voice,
                inputAudioFormat = inputAudioFormat,
                outputAudioFormat = outputAudioFormat,
            ),
            failurePrefix = "Realtime request failed",
        )
    }

    suspend fun createRealtimeClientSecret(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        modalities: List<String> = listOf("text"),
        instructions: String? = null,
        voice: String? = null,
        inputAudioFormat: String? = null,
        outputAudioFormat: String? = null,
    ): String = withTimeout(AI_CAPABILITY_REQUEST_TIMEOUT_MS) {
        require(provider.kind != ProviderKind.Anthropic) {
            "This provider protocol does not support realtime"
        }
        require(!providerNeedsClientKey(provider) || apiKey.isNotBlank()) {
            "Provider API key is required"
        }
        require(model.isNotBlank()) { "Realtime model is required" }

        postJsonCapability(
            provider = provider,
            apiKey = apiKey,
            proxyToken = proxyToken,
            endpoint = realtimeClientSecretsEndpointFor(provider),
            action = "realtime-client-secrets",
            body = realtimeClientSecretsRequestBody(
                json = json,
                model = model,
                modalities = modalities,
                instructions = instructions,
                voice = voice,
                inputAudioFormat = inputAudioFormat,
                outputAudioFormat = outputAudioFormat,
            ),
            failurePrefix = "Realtime client secret request failed",
        )
    }

    private suspend fun generateImageWithResponsesTool(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        responsesModel: String,
        imageModel: String,
        prompt: String,
        size: String,
    ): GeneratedImage {
        val models = responsesImageModels(provider, responsesModel, imageModel)
        require(models.isNotEmpty()) { "Model is required" }

        var lastFailure: AiProviderHttpException? = null

        for (candidate in models) {
            try {
                val statement = client.preparePost(imageResponsesEndpointFor(provider)) {
                    contentType(ContentType.Application.Json)
                    applyAuthHeaders(provider, apiKey)
                    applyProxyHeaders(provider, proxyToken, "image-responses")
                    setBody(
                        json.encodeToString(
                            ResponsesImageGenerationRequest.serializer(),
                            ResponsesImageGenerationRequest(
                                model = candidate,
                                input = prompt,
                                tools = listOf(
                                    ResponsesImageTool(action = "generate", size = size),
                                ),
                            ),
                        ),
                    )
                }
                return statement.execute { response ->
                    if (response.status.value !in 200..299) {
                        throw response.readAiProviderHttpException(
                            "Responses image generation request failed",
                        )
                    }
                    val text = response.readBoundedAiProviderText(
                        MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                        "AI Responses image generation response",
                    )

                    generatedImageFromResponse(json.parseToJsonElement(text))
                }
            } catch (error: AiProviderHttpException) {
                if (!shouldTryNextResponsesImageModel(error.status)) throw error
                lastFailure = error
            }
        }

        throw lastFailure ?: IllegalArgumentException("Model is required")
    }

    internal suspend fun materializeGeneratedImage(image: GeneratedImage): GeneratedImage {
        if (!image.dataUrl.isNullOrBlank()) {
            return image
        }

        val url = image.url?.let(::safeGeneratedImageUrl)
            ?: error("Image generation returned no usable image")
        val bytes = client.prepareGet(url).execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException("Generated image download failed")
            }
            if (safeGeneratedImageUrl(response.call.request.url.toString()) != url) {
                response.discardAiProviderBody()
                error("Image generation returned no usable image")
            }
            response.readBoundedAiProviderBytes(
                MAX_IMAGE_FILE_BYTES,
                "Generated image download",
            )
        }
        val mimeType = generatedImageMimeType(bytes)
            ?: error("Image generation returned no usable image")

        return image.copy(
            dataUrl = "data:$mimeType;base64,${Base64.getEncoder().encodeToString(bytes)}",
            url = null,
            mimeType = mimeType,
        )
    }

    private suspend fun editImageWithResponsesTool(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        responsesModel: String,
        imageModel: String,
        prompt: String,
        image: ImageUpload,
        size: String,
    ): GeneratedImage {
        val models = responsesImageModels(provider, responsesModel, imageModel)
        require(models.isNotEmpty()) { "Model is required" }

        val dataUrl = imageDataUrl(image)
        var lastFailure: AiProviderHttpException? = null

        for (candidate in models) {
            try {
                val statement = client.preparePost(imageResponsesEndpointFor(provider)) {
                    contentType(ContentType.Application.Json)
                    applyAuthHeaders(provider, apiKey)
                    applyProxyHeaders(provider, proxyToken, "image-responses")
                    setBody(
                        json.encodeToString(
                            ResponsesImageEditRequest.serializer(),
                            ResponsesImageEditRequest(
                                model = candidate,
                                input = listOf(
                                    ResponsesImageInputMessage(
                                        content = listOf(
                                            ResponsesImageInputContent(
                                                type = "input_text",
                                                text = prompt,
                                            ),
                                            ResponsesImageInputContent(
                                                type = "input_image",
                                                image_url = dataUrl,
                                            ),
                                        ),
                                    ),
                                ),
                                tools = listOf(
                                    ResponsesImageTool(action = "edit", size = size),
                                ),
                            ),
                        ),
                    )
                }
                return statement.execute { response ->
                    if (response.status.value !in 200..299) {
                        throw response.readAiProviderHttpException(
                            "Responses image edit request failed",
                        )
                    }
                    val text = response.readBoundedAiProviderText(
                        MAX_AI_PROVIDER_IMAGE_RESPONSE_BYTES,
                        "AI Responses image edit response",
                    )

                    generatedImageFromResponse(json.parseToJsonElement(text))
                }
            } catch (error: AiProviderHttpException) {
                if (!shouldTryNextResponsesImageModel(error.status)) throw error
                lastFailure = error
            }
        }

        throw lastFailure ?: IllegalArgumentException("Model is required")
    }

    private suspend fun postJsonCapability(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        endpoint: String,
        action: String,
        body: String,
        failurePrefix: String,
    ): String {
        val statement = client.preparePost(endpoint) {
            contentType(ContentType.Application.Json)
            applyAuthHeaders(provider, apiKey)
            applyProxyHeaders(provider, proxyToken, action)
            setBody(body)
        }
        return statement.execute { response ->
            if (response.status.value !in 200..299) {
                throw response.readAiProviderHttpException(failurePrefix)
            }

            response.readBoundedAiProviderText(
                MAX_AI_PROVIDER_TEXT_RESPONSE_BYTES,
                "AI capability response",
            )
        }
    }

    override fun close() {
        client.close()
    }
}

private fun defaultAiHttpClient(): HttpClient = HttpClient(Android) {
    followRedirects = false
    install(HttpTimeout) {
        connectTimeoutMillis = AI_CONNECT_TIMEOUT_MS
        socketTimeoutMillis = AI_STREAM_IDLE_TIMEOUT_MS
    }
}

private fun shouldTryResponsesImageFallback(status: Int): Boolean =
    status == 404 || status == 405 || status == 501 || status in 500..599

private fun shouldTryNextResponsesImageModel(status: Int): Boolean =
    status == 400 || status == 422

private fun responsesImageModels(
    provider: ProviderConfig,
    responsesModel: String,
    imageModel: String,
): List<String> {
    val primary = responsesModel.trim()
    val ordered = if (primary.isNotEmpty()) {
        listOf(primary, imageModel, provider.model)
    } else {
        listOf(provider.model, imageModel)
    }

    return ordered
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .distinct()
}
