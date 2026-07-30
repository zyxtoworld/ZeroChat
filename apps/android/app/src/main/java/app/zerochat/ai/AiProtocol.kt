package app.zerochat.ai

import app.zerochat.data.ChatMessage
import app.zerochat.data.MessageRole
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.header
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.content.PartData
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.net.URI
import java.util.Base64
import java.util.Locale

const val DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT = 24
private const val MIN_CHAT_CONTEXT_MESSAGE_LIMIT = 4
private const val MAX_CHAT_CONTEXT_MESSAGE_LIMIT = 200
private val LEGACY_IPV4_LABEL_PATTERN = Regex("^(?:[0-9]+|0[xX][0-9a-fA-F]+)$")

private val AUDIO_MIME_BY_EXTENSION = mapOf(
    "aac" to "audio/aac",
    "flac" to "audio/flac",
    "m4a" to "audio/mp4",
    "mp3" to "audio/mpeg",
    "mp4" to "audio/mp4",
    "mpeg" to "audio/mpeg",
    "oga" to "audio/ogg",
    "ogg" to "audio/ogg",
    "opus" to "audio/opus",
    "wav" to "audio/wav",
    "webm" to "audio/webm",
)

private val IMAGE_MIME_BY_EXTENSION = mapOf(
    "jpeg" to "image/jpeg",
    "jpg" to "image/jpeg",
    "png" to "image/png",
    "webp" to "image/webp",
)

data class AudioUpload(
    val bytes: ByteArray,
    val fileName: String = "audio.webm",
    val mimeType: String = "audio/webm",
)

internal data class ImageEditUploadPart(
    val field: String,
    val bytes: ByteArray,
    val fileName: String,
    val mimeType: String,
)

internal fun chatRequestBody(
    json: Json,
    provider: ProviderConfig,
    model: String,
    messages: List<ChatMessage>,
    contextMessageLimit: Int,
    stream: Boolean,
): String {
    val contextMessages = selectContextMessages(messages, contextMessageLimit)
    val systemContent = contextMessages
        .filter { it.role == MessageRole.System }
        .map { it.content.trim() }
        .filter { it.isNotEmpty() }
        .joinToString("\n\n")

    return when (provider.kind) {
        ProviderKind.OpenAICompatible -> json.encodeToString(
            OpenAiChatRequest.serializer(),
            OpenAiChatRequest(
                model.trim(),
                contextMessages.map { AiMessage(roleName(it), openAiChatContent(it)) },
                stream = stream,
            ),
        )
        ProviderKind.OpenAIResponses -> json.encodeToString(
            OpenAiResponsesRequest.serializer(),
            OpenAiResponsesRequest(
                model.trim(),
                contextMessages.map { AiMessage(roleName(it), responsesChatContent(it)) },
                stream = stream,
            ),
        )
        ProviderKind.Anthropic -> json.encodeToString(
            AnthropicRequest.serializer(),
            AnthropicRequest(
                model.trim(),
                system = systemContent.takeIf { it.isNotEmpty() },
                messages = contextMessages
                    .filter { it.role != MessageRole.System }
                    .map { AiMessage(roleName(it), anthropicChatContent(it)) },
                stream = stream,
            ),
        )
    }
}

internal fun audioSpeechRequestBody(
    json: Json,
    model: String,
    input: String,
    voice: String = "alloy",
    responseFormat: String? = null,
    speed: Double? = null,
): String = json.encodeToString(
    AudioSpeechRequest.serializer(),
    AudioSpeechRequest(
        model = model.trim(),
        input = input,
        voice = voice.trim().ifEmpty { "alloy" },
        response_format = responseFormat?.trim()?.takeIf { it.isNotEmpty() },
        speed = speed,
    ),
)

internal fun audioTranscriptionRequestBody(
    model: String,
    audio: AudioUpload,
    prompt: String? = null,
    language: String? = null,
    responseFormat: String? = null,
    temperature: Double? = null,
): MultiPartFormDataContent = MultiPartFormDataContent(
    audioTranscriptionFormDataParts(
        model = model,
        audio = audio,
        prompt = prompt,
        language = language,
        responseFormat = responseFormat,
        temperature = temperature,
    ),
)

internal fun audioTranscriptionFormDataParts(
    model: String,
    audio: AudioUpload,
    prompt: String? = null,
    language: String? = null,
    responseFormat: String? = null,
    temperature: Double? = null,
): List<PartData> {
    val fileName = audioFileName(audio)
    val mimeType = audioMimeType(audio, fileName)

    return formData {
        append("model", model.trim())
        append(
            "file",
            audio.bytes,
            Headers.build {
                append(
                    HttpHeaders.ContentDisposition,
                    "filename=\"$fileName\"",
                )
                append(HttpHeaders.ContentType, mimeType)
            },
        )
        prompt?.trim()?.takeIf { it.isNotEmpty() }?.let { append("prompt", it) }
        language?.trim()?.takeIf { it.isNotEmpty() }?.let { append("language", it) }
        responseFormat?.trim()?.takeIf { it.isNotEmpty() }?.let { append("response_format", it) }
        temperature?.let { append("temperature", decimalString(it)) }
    }
}

internal fun imageEditRequestBody(
    model: String,
    prompt: String,
    image: ImageUpload,
    mask: ImageUpload? = null,
    size: String = "1024x1024",
): MultiPartFormDataContent = MultiPartFormDataContent(
    imageEditFormDataParts(
        model = model,
        prompt = prompt,
        image = image,
        mask = mask,
        size = size,
    ),
)

internal fun imageEditFormDataParts(
    model: String,
    prompt: String,
    image: ImageUpload,
    mask: ImageUpload? = null,
    size: String = "1024x1024",
): List<PartData> = formData {
    val source = imageEditUploadPart("image", image, "image.png")
    append("model", model.trim())
    append("prompt", prompt.trim())
    append("n", "1")
    append("size", size)
    append("response_format", "b64_json")
    append(
        source.field,
        source.bytes,
        Headers.build {
            append(HttpHeaders.ContentDisposition, "filename=\"${source.fileName}\"")
            append(HttpHeaders.ContentType, source.mimeType)
        },
    )
    mask?.let {
        val maskUpload = imageEditUploadPart("mask", it, "mask.png")
        append(
            maskUpload.field,
            maskUpload.bytes,
            Headers.build {
                append(HttpHeaders.ContentDisposition, "filename=\"${maskUpload.fileName}\"")
                append(HttpHeaders.ContentType, maskUpload.mimeType)
            },
        )
    }
}

internal fun imageDataUrl(image: ImageUpload): String {
    val upload = imageEditUploadPart("image", image, "image.png")
    return "data:${upload.mimeType};base64,${Base64.getEncoder().encodeToString(upload.bytes)}"
}

internal fun embeddingsRequestBody(json: Json, model: String, input: String): String =
    textCapabilityRequestBody(json, model, JsonPrimitive(input))

internal fun embeddingsRequestBody(json: Json, model: String, input: List<String>): String =
    textCapabilityRequestBody(json, model, JsonArray(input.map(::JsonPrimitive)))

internal fun moderationsRequestBody(json: Json, model: String, input: String): String =
    textCapabilityRequestBody(json, model, JsonPrimitive(input))

private fun textCapabilityRequestBody(
    json: Json,
    model: String,
    input: JsonElement,
): String = json.encodeToString(
    TextCapabilityRequest.serializer(),
    TextCapabilityRequest(model.trim(), input),
)

internal fun realtimeRequestBody(
    json: Json,
    model: String,
    modalities: List<String> = listOf("text"),
    instructions: String? = null,
    voice: String? = null,
    inputAudioFormat: String? = null,
    outputAudioFormat: String? = null,
): String {
    val outputModality = normalizedRealtimeModality(modalities)

    return json.encodeToString(
        RealtimeRequest.serializer(),
        RealtimeRequest(
            model = model.trim(),
            modalities = normalizedRealtimeModalities(outputModality),
            instructions = instructions?.trim()?.takeIf { it.isNotEmpty() },
            voice = if (outputModality == "audio") voice?.trim()?.takeIf { it.isNotEmpty() } else null,
            input_audio_format = inputAudioFormat?.trim()?.takeIf { it.isNotEmpty() },
            output_audio_format =
                if (outputModality == "audio") {
                    outputAudioFormat?.trim()?.takeIf { it.isNotEmpty() }
                } else {
                    null
                },
        ),
    )
}

internal fun realtimeClientSecretsRequestBody(
    json: Json,
    model: String,
    modalities: List<String> = listOf("text"),
    instructions: String? = null,
    voice: String? = null,
    inputAudioFormat: String? = null,
    outputAudioFormat: String? = null,
): String {
    val outputModality = normalizedRealtimeModality(modalities)

    return json.encodeToString(
        RealtimeClientSecretsRequest.serializer(),
        RealtimeClientSecretsRequest(
            session = RealtimeClientSecretsSession(
                model = model.trim(),
                output_modalities = normalizedRealtimeModalities(outputModality),
                instructions = instructions?.trim()?.takeIf { it.isNotEmpty() },
                audio = realtimeSessionAudio(
                    inputAudioFormat = inputAudioFormat,
                    outputAudioFormat = outputAudioFormat,
                    voice = voice,
                    includeOutput = outputModality == "audio",
                ),
            ),
        ),
    )
}

private fun normalizedRealtimeModality(modalities: List<String>): String =
    modalities.map { it.trim() }.firstOrNull { it == "text" || it == "audio" } ?: "text"

private fun normalizedRealtimeModalities(modality: String): List<String> = listOf(modality)

private fun realtimeSessionAudio(
    inputAudioFormat: String?,
    outputAudioFormat: String?,
    voice: String?,
    includeOutput: Boolean,
): RealtimeSessionAudio? {
    val inputFormat = realtimeAudioFormat(inputAudioFormat)
    val outputFormat = realtimeAudioFormat(outputAudioFormat)
    val outputVoice = voice?.trim()?.takeIf { it.isNotEmpty() }
    val output = if (includeOutput && (outputFormat != null || outputVoice != null)) {
        RealtimeSessionAudioOutput(format = outputFormat, voice = outputVoice)
    } else {
        null
    }

    if (inputFormat == null && output == null) {
        return null
    }

    return RealtimeSessionAudio(
        input = inputFormat?.let { RealtimeSessionAudioInput(format = it) },
        output = output,
    )
}

private fun realtimeAudioFormat(value: String?): RealtimeAudioFormat? {
    val normalized = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null

    return when (normalized) {
        "pcm16", "audio/pcm" -> RealtimeAudioFormat(type = "audio/pcm", rate = 24000)
        "g711_ulaw", "audio/pcmu" -> RealtimeAudioFormat(type = "audio/pcmu")
        "g711_alaw", "audio/pcma" -> RealtimeAudioFormat(type = "audio/pcma")
        else -> RealtimeAudioFormat(type = normalized)
    }
}

internal suspend fun processSseEvent(
    json: Json,
    eventData: List<String>,
    received: StringBuilder,
    onDelta: suspend (String) -> Unit,
): Boolean {
    val data = eventData.joinToString("\n").trim()

    if (data.isEmpty()) {
        return true
    }
    if (data == "[DONE]") {
        return false
    }

    val delta = readChatDelta(json, data)
    if (delta.isNotEmpty()) {
        received.append(delta)
        onDelta(delta)
    }

    return true
}

internal fun readChatDelta(json: Json, text: String): String =
    runCatching {
        val root = json.parseToJsonElement(text) as? JsonObject ?: return@runCatching ""

        readOpenAiChoiceDelta(root)
            .ifEmpty { readResponsesDelta(root) }
            .ifEmpty { readAnthropicDelta(root) }
    }.getOrDefault("")

private fun roleName(message: ChatMessage): String = when (message.role) {
    MessageRole.System -> "system"
    MessageRole.User -> "user"
    MessageRole.Assistant -> "assistant"
}

private fun chatImageAttachmentSources(message: ChatMessage): List<String> {
    if (message.role != MessageRole.User) {
        return emptyList()
    }

    return message.attachments.mapNotNull { attachment ->
        if (attachment.kind != "image" || attachment.purpose == "mask") {
            return@mapNotNull null
        }

        attachment.dataUrl
            ?.let(::safeGeneratedImageDataUrl)
            ?.first
            ?: attachment.url?.let(::safeGeneratedImageUrl)
    }
}

private fun openAiChatContent(message: ChatMessage): JsonElement {
    val images = chatImageAttachmentSources(message)
    if (images.isEmpty()) {
        return JsonPrimitive(message.content)
    }

    return JsonArray(
        buildList {
            if (message.content.isNotEmpty()) {
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("text"),
                            "text" to JsonPrimitive(message.content),
                        ),
                    ),
                )
            }
            images.forEach { source ->
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("image_url"),
                            "image_url" to JsonObject(
                                mapOf("url" to JsonPrimitive(source)),
                            ),
                        ),
                    ),
                )
            }
        },
    )
}

private fun responsesChatContent(message: ChatMessage): JsonElement {
    val images = chatImageAttachmentSources(message)
    if (images.isEmpty()) {
        return JsonPrimitive(message.content)
    }

    return JsonArray(
        buildList {
            if (message.content.isNotEmpty()) {
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("input_text"),
                            "text" to JsonPrimitive(message.content),
                        ),
                    ),
                )
            }
            images.forEach { source ->
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("input_image"),
                            "image_url" to JsonPrimitive(source),
                        ),
                    ),
                )
            }
        },
    )
}

private fun anthropicChatContent(message: ChatMessage): JsonElement {
    val images = chatImageAttachmentSources(message).mapNotNull(::dataUrlParts)
    if (images.isEmpty()) {
        return JsonPrimitive(message.content)
    }

    return JsonArray(
        buildList {
            if (message.content.isNotEmpty()) {
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("text"),
                            "text" to JsonPrimitive(message.content),
                        ),
                    ),
                )
            }
            images.forEach { image ->
                add(
                    JsonObject(
                        mapOf(
                            "type" to JsonPrimitive("image"),
                            "source" to JsonObject(
                                mapOf(
                                    "type" to JsonPrimitive("base64"),
                                    "media_type" to JsonPrimitive(image.mediaType),
                                    "data" to JsonPrimitive(image.data),
                                ),
                            ),
                        ),
                    ),
                )
            }
        },
    )
}

private data class DataUrlParts(val mediaType: String, val data: String)

private fun dataUrlParts(dataUrl: String): DataUrlParts? {
    val parts = dataUrl.split(",", limit = 2)
    val metadata = parts.firstOrNull().orEmpty()
    val data = parts.getOrNull(1).orEmpty()
    val mediaType = Regex("^data:([^;,]+)").find(metadata)?.groupValues?.getOrNull(1)?.trim().orEmpty()

    if (mediaType.isEmpty() || data.isEmpty()) {
        return null
    }

    return DataUrlParts(mediaType, data)
}

internal fun endpointFor(provider: ProviderConfig): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    val root = providerApiRoot(provider)

    return when (provider.kind) {
        ProviderKind.Anthropic -> "$root/messages"
        ProviderKind.OpenAIResponses -> "$root/responses"
        ProviderKind.OpenAICompatible -> "$root/chat/completions"
    }
}

internal fun modelsEndpointFor(provider: ProviderConfig): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    return "${providerApiRoot(provider)}/models"
}

internal fun imageGenerationEndpointFor(provider: ProviderConfig): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    return "${providerApiRoot(provider)}/images/generations"
}

internal fun imageEditEndpointFor(provider: ProviderConfig): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    return "${providerApiRoot(provider)}/images/edits"
}

internal fun imageResponsesEndpointFor(provider: ProviderConfig): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    return "${providerApiRoot(provider)}/responses"
}

internal fun audioSpeechEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/audio/speech")

internal fun audioTranscriptionEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/audio/transcriptions")

internal fun embeddingsEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/embeddings")

internal fun moderationsEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/moderations")

internal fun realtimeEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/realtime")

internal fun realtimeClientSecretsEndpointFor(provider: ProviderConfig): String =
    capabilityEndpointFor(provider, "/realtime/client_secrets")

private fun capabilityEndpointFor(provider: ProviderConfig, path: String): String {
    provider.proxyUrl?.takeIf { it.isNotBlank() }?.let {
        return "${proxyRootUrl(it)}/proxy"
    }

    return "${providerApiRoot(provider)}$path"
}

internal fun HttpRequestBuilder.applyAuthHeaders(
    provider: ProviderConfig,
    apiKey: String,
) {
    val requestApiKey = if (providerNeedsClientKey(provider)) apiKey.trim() else ""

    when (provider.kind) {
        ProviderKind.Anthropic -> {
            header("anthropic-version", "2023-06-01")
            if (requestApiKey.isNotEmpty()) {
                header("x-api-key", requestApiKey)
            }
        }
        ProviderKind.OpenAICompatible,
        ProviderKind.OpenAIResponses -> {
            if (requestApiKey.isNotEmpty()) {
                bearerAuth(requestApiKey)
            }
        }
    }
}

internal fun HttpRequestBuilder.applyProxyHeaders(
    provider: ProviderConfig,
    proxyToken: String,
    action: String,
) {
    if (provider.proxyUrl.isNullOrBlank()) {
        return
    }

    require(proxyToken.isNotBlank()) { "Cloudflare access key is required" }
    header("x-zerochat-access-key", proxyToken.trim())
    header("x-zerochat-proxy-action", action)
    header("x-zerochat-base-url", providerApiRoot(provider))
    header(
        "x-zerochat-provider-kind",
        when (provider.kind) {
            ProviderKind.Anthropic -> "anthropic"
            ProviderKind.OpenAIResponses -> "openai-responses"
            ProviderKind.OpenAICompatible -> "openai-compatible"
        },
    )
}

internal fun providerNeedsClientKey(provider: ProviderConfig): Boolean =
    provider.needsApiKey || provider.proxyUrl.isNullOrBlank()

internal fun parseModelIds(element: JsonElement): List<String> {
    val items = when (element) {
        is JsonArray -> element
        is JsonObject ->
            (element["data"] as? JsonArray)
                ?: (element["models"] as? JsonArray)
                ?: (element["result"] as? JsonArray)
                ?: JsonArray(emptyList())
        else -> JsonArray(emptyList())
    }

    return items
        .mapNotNull(::readModelId)
        .distinct()
        .sorted()
}

internal fun generatedImageFromResponse(element: JsonElement): GeneratedImage {
    imageFromImagesApiResponse(element)?.let { return it }
    imageFromResponsesApiResponse(element)?.let { return it }

    error("Image response did not include image data")
}

internal fun chatTextFromResponse(json: Json, text: String): String {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) {
        return ""
    }

    return runCatching {
        val element = json.parseToJsonElement(trimmed)
        readChatText(element)
    }.getOrNull()?.takeIf { it.isNotBlank() } ?: trimmed
}

private fun providerApiRoot(provider: ProviderConfig): String {
    val baseUrl = safeBaseUrl(provider.baseUrl, "Base URL")

    return when {
        baseUrl.endsWith("/chat/completions") ->
            baseUrl.removeSuffix("/chat/completions")
        baseUrl.endsWith("/responses") -> baseUrl.removeSuffix("/responses")
        baseUrl.endsWith("/messages") -> baseUrl.removeSuffix("/messages")
        baseUrl.endsWith("/models") -> baseUrl.removeSuffix("/models")
        baseUrl.endsWith("/images/generations") -> baseUrl.removeSuffix("/images/generations")
        baseUrl.endsWith("/images/edits") -> baseUrl.removeSuffix("/images/edits")
        baseUrl.endsWith("/audio/speech") -> baseUrl.removeSuffix("/audio/speech")
        baseUrl.endsWith("/audio/transcriptions") -> baseUrl.removeSuffix("/audio/transcriptions")
        baseUrl.endsWith("/embeddings") -> baseUrl.removeSuffix("/embeddings")
        baseUrl.endsWith("/moderations") -> baseUrl.removeSuffix("/moderations")
        baseUrl.endsWith("/realtime/client_secrets") -> baseUrl.removeSuffix("/realtime/client_secrets")
        baseUrl.endsWith("/realtime") -> baseUrl.removeSuffix("/realtime")
        else -> baseUrl
    }
}

private fun imageFromImagesApiResponse(element: JsonElement): GeneratedImage? {
    val item = ((element as? JsonObject)?.get("data") as? JsonArray)
        ?.firstOrNull() as? JsonObject
        ?: return null

    return imageFromRecord(item)
}

private fun imageFromResponsesApiResponse(element: JsonElement): GeneratedImage? {
    val output = ((element as? JsonObject)?.get("output") as? JsonArray) ?: return null

    return output
        .mapNotNull { it as? JsonObject }
        .firstNotNullOfOrNull { item ->
            val type = (item["type"] as? JsonPrimitive)?.contentOrNull

            if (type == "image_generation_call") imageFromRecord(item) else null
        }
}

private fun imageFromRecord(item: JsonObject): GeneratedImage? {
    val mimeType = (item["mime_type"] as? JsonPrimitive)?.contentOrNull
        ?: (item["mimeType"] as? JsonPrimitive)?.contentOrNull
        ?: imageMimeTypeFromFormat((item["output_format"] as? JsonPrimitive)?.contentOrNull)
    val revisedPrompt = (item["revised_prompt"] as? JsonPrimitive)?.contentOrNull
    val b64 = ((item["b64_json"] as? JsonPrimitive)?.contentOrNull
        ?: (item["result"] as? JsonPrimitive)?.contentOrNull)
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

    if (b64 != null) {
        safeGeneratedImageDataUrl(
            if (b64.startsWith("data:")) b64 else "data:$mimeType;base64,$b64",
        )?.let { (dataUrl, safeMimeType) ->
            return GeneratedImage(
                dataUrl = dataUrl,
                mimeType = safeMimeType,
                revisedPrompt = revisedPrompt,
            )
        }
    }

    val url = (item["url"] as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.takeIf { it.isNotEmpty() }

    return url?.let(::safeGeneratedImageUrl)?.let {
        GeneratedImage(
            url = it,
            mimeType = mimeType,
            revisedPrompt = revisedPrompt,
        )
    }
}

private fun imageMimeTypeFromFormat(value: String?): String = when (value?.trim()?.lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "webp" -> "image/webp"
    "png", null, "" -> "image/png"
    else -> when (value.trim().lowercase()) {
        "image/jpeg", "image/png", "image/webp" -> value.trim().lowercase()
        "image/jpg" -> "image/jpeg"
        else -> "image/png"
    }
}

internal fun safeGeneratedImageDataUrl(value: String): Pair<String, String>? {
    val trimmed = value.trim()
    if (trimmed.isEmpty() || trimmed.any { it.isWhitespace() || it.isISOControl() }) {
        return null
    }

    val separator = trimmed.indexOf(',')
    if (separator <= 0) {
        return null
    }

    val metadata = trimmed.substring(0, separator)
    val match = Regex(
        """^data:(image/(?:jpeg|jpg|png|webp));base64$""",
        RegexOption.IGNORE_CASE,
    ).matchEntire(metadata) ?: return null
    val mimeType = imageMimeTypeFromFormat(match.groupValues[1])
    val payload = trimmed.substring(separator + 1)
    val decoded = runCatching { Base64.getDecoder().decode(payload) }.getOrNull()

    if (payload.isEmpty() || decoded == null || decoded.isEmpty()) {
        return null
    }

    return "data:$mimeType;base64,$payload" to mimeType
}

internal fun safeGeneratedImageUrl(value: String): String? {
    val trimmed = value.trim()
    if (
        trimmed.isEmpty() ||
        trimmed.any { it.isWhitespace() || it.isISOControl() } ||
        !Regex("""^https?://[^/]""", RegexOption.IGNORE_CASE).containsMatchIn(trimmed)
    ) {
        return null
    }

    val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
    val host = uri.host.orEmpty()

    if (
        scheme !in setOf("http", "https") ||
        uri.userInfo != null ||
        host.isBlank() ||
        isDisallowedRemoteHost(host)
    ) {
        return null
    }

    return runCatching { uri.toASCIIString() }.getOrNull()
}

private fun imageEditUploadPart(field: String, upload: ImageUpload, fallbackName: String): ImageEditUploadPart {
    val fileName = upload.fileName.trim().ifEmpty { fallbackName }
    val mimeType = upload.mimeType.trim().ifEmpty { imageMimeTypeFromFileName(fileName) }
    return ImageEditUploadPart(
        field = field,
        bytes = upload.bytes,
        fileName = fileName,
        mimeType = mimeType,
    )
}

private fun imageMimeTypeFromFileName(fileName: String): String {
    val extension = fileName
        .substringAfterLast('.', "")
        .trim()
        .lowercase()
    return IMAGE_MIME_BY_EXTENSION[extension] ?: "image/png"
}

private fun audioFileName(audio: AudioUpload): String =
    audio.fileName.trim().ifEmpty { "audio.webm" }

private fun audioMimeType(audio: AudioUpload, fileName: String): String =
    audio.mimeType.trim().ifEmpty { audioMimeTypeFromFileName(fileName) }

private fun audioMimeTypeFromFileName(fileName: String): String {
    val extension = fileName
        .substringAfterLast('.', "")
        .trim()
        .lowercase()
    return AUDIO_MIME_BY_EXTENSION[extension] ?: "audio/webm"
}

private fun safeBaseUrl(value: String, label: String): String {
    val trimmed = value.trim().trimEnd('/')
    val uri = URI(trimmed)
    val host = uri.host.orEmpty()

    require(uri.userInfo == null) { "$label cannot include username or password" }
    require(uri.query == null && uri.fragment == null) {
        "$label cannot include query or fragment"
    }
    require(uri.scheme == "https") { "$label must use remote HTTPS" }
    require(host.isNotBlank() && !isDisallowedRemoteHost(host)) {
        "$label cannot use localhost, loopback, private network, or LAN addresses"
    }

    return trimmed
}

private fun proxyRootUrl(value: String): String {
    val baseUrl = safeBaseUrl(value, "Proxy URL")

    return when {
        baseUrl.endsWith("/proxy/hosts") -> baseUrl.removeSuffix("/proxy/hosts")
        baseUrl.endsWith("/proxy") -> baseUrl.removeSuffix("/proxy")
        else -> baseUrl
    }
}

private fun isDisallowedRemoteHost(host: String): Boolean {
    val normalized = host
        .lowercase()
        .removeSurrounding("[", "]")
        .trimEnd('.')

    if (
        normalized == "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        normalized.endsWith(".lan") ||
        normalized.endsWith(".home.arpa")
    ) {
        return true
    }

    parseIpv4(normalized)?.let { octets ->
        return normalized != octets.joinToString(".") || isDisallowedIpv4(octets)
    }

    if (!normalized.contains(':')) {
        return !normalized.contains('.') ||
            normalized.split('.').all { LEGACY_IPV4_LABEL_PATTERN.matches(it) }
    }

    val ipv6 = parseIpv6Hextets(normalized)
    val embeddedIpv4 = embeddedIpv4FromIpv6(normalized)

    if (embeddedIpv4 != null && isDisallowedIpv4(embeddedIpv4)) {
        return true
    }

    if (ipv6 != null) {
        val first = ipv6[0]
        return normalized == "::" ||
            normalized == "::1" ||
            (first == 0x100 && ipv6.drop(1).take(3).all { it == 0 }) ||
            (first == 0x2001 && ipv6[1] == 0x0db8) ||
            (first and 0xfe00) == 0xfc00 ||
            (first and 0xffc0) == 0xfe80 ||
            (first and 0xff00) == 0xff00
    }

    return normalized == "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:") ||
        normalized.startsWith("ff")
}

private fun isDisallowedIpv4(octets: List<Int>): Boolean {
    val first = octets[0]
    val second = octets[1]
    val third = octets[2]

    return first == 0 ||
        first == 10 ||
        first == 127 ||
        (first == 169 && second == 254) ||
        (first == 172 && second in 16..31) ||
        (first == 192 && second == 0 && third in setOf(0, 2)) ||
        (first == 192 && second == 88 && third == 99) ||
        (first == 192 && second == 168) ||
        (first == 198 && second in setOf(18, 19)) ||
        (first == 198 && second == 51 && third == 100) ||
        (first == 203 && second == 0 && third == 113) ||
        (first == 100 && second in 64..127) ||
        first >= 224
}

private fun parseIpv4(value: String): List<Int>? {
    val parts = value.split('.')

    if (parts.size != 4) {
        return null
    }

    val octets = parts.map { part ->
        if (!part.matches(Regex("""\d{1,3}"""))) {
            return null
        }

        part.toInt()
    }

    return octets.takeIf { items -> items.all { it in 0..255 } }
}

private fun parseIpv6Hextets(value: String): List<Int>? {
    fun parsePart(part: String): List<Int>? {
        if (part.isBlank()) {
            return null
        }

        if (part.contains('.')) {
            val ipv4 = parseIpv4(part) ?: return null
            return listOf(ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3])
        }

        if (!part.matches(Regex("""[0-9a-fA-F]{1,4}"""))) {
            return null
        }

        return listOf(part.toInt(16))
    }

    fun parseSide(side: String): List<Int>? {
        if (side.isEmpty()) {
            return emptyList()
        }

        val hextets = mutableListOf<Int>()

        for (part in side.split(':')) {
            hextets += parsePart(part) ?: return null
        }

        return hextets
    }

    val sections = value.split("::")

    if (sections.size > 2) {
        return null
    }

    val left = parseSide(sections[0]) ?: return null
    val right = if (sections.size == 2) parseSide(sections[1]) ?: return null else emptyList()

    if (sections.size == 1) {
        return left.takeIf { it.size == 8 }
    }

    val zeros = 8 - left.size - right.size

    if (zeros < 1) {
        return null
    }

    return left + List(zeros) { 0 } + right
}

private fun embeddedIpv4FromIpv6(value: String): List<Int>? {
    val hextets = parseIpv6Hextets(value) ?: return null

    fun fromWords(firstWord: Int, secondWord: Int): List<Int> =
        listOf(firstWord shr 8, firstWord and 255, secondWord shr 8, secondWord and 255)

    if (
        hextets.take(5).all { it == 0 } &&
        (hextets[5] == 0 || hextets[5] == 0xffff)
    ) {
        return fromWords(hextets[6], hextets[7])
    }

    if (
        hextets[0] == 0x64 &&
        hextets[1] == 0xff9b &&
        hextets.drop(2).take(4).all { it == 0 }
    ) {
        return fromWords(hextets[6], hextets[7])
    }

    if (
        hextets[0] == 0x64 &&
        hextets[1] == 0xff9b &&
        hextets[2] == 1 &&
        hextets.drop(3).take(3).all { it == 0 }
    ) {
        return fromWords(hextets[6], hextets[7])
    }

    if (hextets[0] == 0x2002) {
        return fromWords(hextets[1], hextets[2])
    }

    return null
}

private fun readOpenAiChoiceDelta(root: JsonObject): String {
    val choice = (root["choices"] as? JsonArray)
        ?.firstOrNull() as? JsonObject
        ?: return ""
    val delta = choice["delta"] as? JsonObject
    val message = choice["message"] as? JsonObject

    return primitiveText(delta?.get("content"))
        .ifEmpty { primitiveText(message?.get("content")) }
}

private fun readResponsesDelta(root: JsonObject): String {
    val type = primitiveText(root["type"])
    if (type.isNotEmpty() && !type.contains("delta")) {
        return ""
    }

    return primitiveText(root["delta"])
        .ifEmpty { primitiveText((root["response"] as? JsonObject)?.get("delta")) }
}

private fun readAnthropicDelta(root: JsonObject): String {
    val type = primitiveText(root["type"])
    if (type.isNotEmpty() && type != "content_block_delta") {
        return ""
    }

    val delta = root["delta"] as? JsonObject
    return primitiveText(delta?.get("text"))
}

private fun primitiveText(element: JsonElement?): String =
    (element as? JsonPrimitive)?.contentOrNull.orEmpty()

private fun normalizeChatContextMessageLimit(value: Int): Int =
    (if (value <= 0) DEFAULT_CHAT_CONTEXT_MESSAGE_LIMIT else value)
        .coerceIn(MIN_CHAT_CONTEXT_MESSAGE_LIMIT, MAX_CHAT_CONTEXT_MESSAGE_LIMIT)

private fun decimalString(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

private fun selectContextMessages(
    messages: List<ChatMessage>,
    contextMessageLimit: Int,
): List<ChatMessage> {
    val normalizedLimit = normalizeChatContextMessageLimit(contextMessageLimit)
    val systemMessages = messages.filter {
        it.role == MessageRole.System && it.content.trim().isNotEmpty()
    }
    val chatMessages = messages
        .filter { it.role != MessageRole.System }
        .takeLast(normalizedLimit)

    return systemMessages + chatMessages
}

private fun readModelId(element: JsonElement): String? {
    if (element is JsonPrimitive) {
        return element.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
    }

    val record = element as? JsonObject ?: return null
    for (key in listOf("id", "name", "model", "slug")) {
        val value = (record[key] as? JsonPrimitive)
            ?.contentOrNull
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
        if (value != null) {
            return value
        }
    }

    return null
}

private fun readChatText(element: JsonElement): String {
    val root = element as? JsonObject ?: return ""

    (root["output_text"] as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { return it }

    readOpenAiChoice(root)?.takeIf { it.isNotBlank() }?.let { return it }
    readResponsesOutput(root)?.takeIf { it.isNotBlank() }?.let { return it }
    readAnthropicContent(root)?.takeIf { it.isNotBlank() }?.let { return it }

    return ""
}

private fun readOpenAiChoice(root: JsonObject): String {
    val choice = (root["choices"] as? JsonArray)
        ?.firstOrNull() as? JsonObject
        ?: return ""
    val message = choice["message"] as? JsonObject
    val direct = (message?.get("content") as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        .orEmpty()
    if (direct.isNotEmpty()) {
        return direct
    }

    return ((choice["delta"] as? JsonObject)?.get("content") as? JsonPrimitive)
        ?.contentOrNull
        ?.trim()
        .orEmpty()
}

private fun readResponsesOutput(root: JsonObject): String {
    val output = root["output"] as? JsonArray ?: return ""
    return output.joinToString("\n") { item ->
        val record = item as? JsonObject ?: return@joinToString ""
        val content = record["content"] as? JsonArray ?: return@joinToString ""
        content.joinToString("\n") { part ->
            val partRecord = part as? JsonObject ?: return@joinToString ""
            ((partRecord["text"] ?: partRecord["output_text"]) as? JsonPrimitive)
                ?.contentOrNull
                ?.trim()
                .orEmpty()
        }
    }.trim()
}

private fun readAnthropicContent(root: JsonObject): String {
    val content = root["content"] as? JsonArray ?: return ""
    return content.joinToString("\n") { item ->
        val record = item as? JsonObject ?: return@joinToString ""
        (record["text"] as? JsonPrimitive)
            ?.contentOrNull
            ?.trim()
            .orEmpty()
    }.trim()
}

@Serializable
internal data class OpenAiChatRequest(
    val model: String,
    val messages: List<AiMessage>,
    val stream: Boolean = false,
    val temperature: Double = 0.7,
)

@Serializable
internal data class OpenAiResponsesRequest(
    val model: String,
    val input: List<AiMessage>,
    val stream: Boolean = false,
    val store: Boolean = false,
    val temperature: Double = 0.7,
)

@Serializable
internal data class AnthropicRequest(
    val model: String,
    val system: String? = null,
    val messages: List<AiMessage>,
    val stream: Boolean = false,
    val max_tokens: Int = 4096,
)

@Serializable
internal data class ImageGenerationRequest(
    val model: String,
    val prompt: String,
    val n: Int = 1,
    val size: String = "1024x1024",
    val response_format: String = "b64_json",
)

@Serializable
internal data class AudioSpeechRequest(
    val model: String,
    val input: String,
    val voice: String = "alloy",
    val response_format: String? = null,
    val speed: Double? = null,
)

@Serializable
internal data class TextCapabilityRequest(
    val model: String,
    val input: JsonElement,
)

@Serializable
internal data class RealtimeRequest(
    val model: String,
    val modalities: List<String> = listOf("text"),
    val instructions: String? = null,
    val voice: String? = null,
    val input_audio_format: String? = null,
    val output_audio_format: String? = null,
)

@Serializable
internal data class RealtimeClientSecretsRequest(
    val expires_after: RealtimeClientSecretsExpiry = RealtimeClientSecretsExpiry(),
    val session: RealtimeClientSecretsSession,
)

@Serializable
internal data class RealtimeClientSecretsExpiry(
    val anchor: String = "created_at",
    val seconds: Int = 600,
)

@Serializable
internal data class RealtimeClientSecretsSession(
    val type: String = "realtime",
    val model: String,
    val output_modalities: List<String> = listOf("text"),
    val instructions: String? = null,
    val audio: RealtimeSessionAudio? = null,
)

@Serializable
internal data class RealtimeSessionAudio(
    val input: RealtimeSessionAudioInput? = null,
    val output: RealtimeSessionAudioOutput? = null,
)

@Serializable
internal data class RealtimeSessionAudioInput(
    val format: RealtimeAudioFormat,
)

@Serializable
internal data class RealtimeSessionAudioOutput(
    val format: RealtimeAudioFormat? = null,
    val voice: String? = null,
)

@Serializable
internal data class RealtimeAudioFormat(
    val type: String,
    val rate: Int? = null,
)

@Serializable
internal data class ResponsesImageGenerationRequest(
    val model: String,
    val input: String,
    val tools: List<ResponsesImageTool>,
    val store: Boolean = false,
)

@Serializable
internal data class ResponsesImageEditRequest(
    val model: String,
    val input: List<ResponsesImageInputMessage>,
    val tools: List<ResponsesImageTool>,
    val store: Boolean = false,
)

@Serializable
internal data class ResponsesImageTool(
    val type: String = "image_generation",
    val action: String,
    val size: String = "1024x1024",
)

@Serializable
internal data class ResponsesImageInputMessage(
    val role: String = "user",
    val content: List<ResponsesImageInputContent>,
)

@Serializable
internal data class ResponsesImageInputContent(
    val type: String,
    val text: String? = null,
    val image_url: String? = null,
)

@Serializable
internal data class AiMessage(
    val role: String,
    val content: JsonElement,
)
