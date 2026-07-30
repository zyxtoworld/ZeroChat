package app.zerochat.ui.chat

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import app.zerochat.ai.ImageUpload
import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.MAX_IMAGE_FILE_BYTES
import app.zerochat.ui.localFileTooLargeMessage
import app.zerochat.ui.readBoundedLocalUriBytes
import app.zerochat.data.chatModelForConversation as dataChatModelForConversation
import app.zerochat.data.chatModelsForProvider as dataChatModelsForProvider
import app.zerochat.data.configuredModelsForProvider as dataConfiguredModelsForProvider
import app.zerochat.data.defaultChatModelForProvider as dataDefaultChatModelForProvider
import app.zerochat.data.imageModelForProvider as dataImageModelForProvider
import app.zerochat.data.imageModelsForProvider as dataImageModelsForProvider
import app.zerochat.data.modelForProviderAudioSpeech as dataModelForProviderAudioSpeech
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

fun replaceProvider(
    providers: List<ProviderConfig>,
    provider: ProviderConfig,
): List<ProviderConfig> = providers.map { if (it.id == provider.id) provider else it }

fun providerRequest(provider: ProviderConfig, snapshot: AppSnapshot): ProviderConfig {
    if (provider.clientRequestMode) {
        return provider.copy(proxyUrl = null)
    }

    if (!provider.proxyUrl.isNullOrBlank()) {
        return provider
    }

    val endpoint = snapshot.sync.workerEndpoint
        ?.trim()
        ?.takeIf { snapshot.sync.mode == "cloudflare" && it.isNotEmpty() }

    return if (endpoint == null) provider else provider.copy(proxyUrl = endpoint)
}

fun providerNeedsClientKey(provider: ProviderConfig): Boolean =
    provider.clientRequestMode || provider.needsApiKey || provider.proxyUrl.isNullOrBlank()

fun providerProxyTokenForRequest(
    provider: ProviderConfig,
    cloudflareAccessKey: () -> String,
): String = if (provider.proxyUrl.isNullOrBlank()) "" else cloudflareAccessKey()

fun configuredModels(provider: ProviderConfig?): List<String> {
    return dataConfiguredModelsForProvider(provider)
}

fun chatModelsForProvider(provider: ProviderConfig?): List<String> =
    dataChatModelsForProvider(provider)

fun defaultChatModelForProvider(provider: ProviderConfig?): String =
    dataDefaultChatModelForProvider(provider)

fun chatModelForConversation(
    conversation: Conversation?,
    provider: ProviderConfig?,
): String = dataChatModelForConversation(conversation, provider)

fun imageModelsForProvider(provider: ProviderConfig?): List<String> =
    dataImageModelsForProvider(provider)

fun imageModelForProvider(provider: ProviderConfig?): String =
    dataImageModelForProvider(provider)

fun audioSpeechModelForProvider(provider: ProviderConfig?): String =
    dataModelForProviderAudioSpeech(provider)

private val providerNameWhitespace = Regex("\\s+")

private val defaultCustomOpenAiRelayNames = setOf(
    "自定义中转（OpenAI 兼容）",
    "自定OpenAI 兼容中转",
    "Custom relay (OpenAI compatible)",
    "Custom " + "OpenAI-compatible relay",
    "Relé personalizado (OpenAI compatible)",
    "Retransmisión personalizada (OpenAI compatible)",
    "कस्टम रिले (OpenAI compatible)",
    "مرحل مخصص (OpenAI compatible)",
    "مرحل مخصص (متوافق مع OpenAI)",
    "Relé personalizado (OpenAI compatible)",
    "Relay personalizado (compatível com OpenAI)",
    "Пользовательское реле (OpenAI compatible)",
    "Пользовательский ретранслятор (совместимый с OpenAI)",
    "カスタム リレー (OpenAI compatible)",
    "カスタムリレー（OpenAI 互換）",
    "맞춤형 릴레이(OpenAI compatible)",
    "사용자 지정 릴레이(OpenAI 호환)",
    "Relais personnalisé (OpenAI compatible)",
).map { normalizeProviderDisplayName(it) }.toSet()

private fun normalizeProviderDisplayName(name: String): String =
    name.trim().replace(providerNameWhitespace, " ").lowercase()

fun providerDisplayName(provider: ProviderConfig, i18n: NativeI18n): String {
    val isDefaultCustomOpenAiRelay =
        provider.custom &&
            provider.kind == ProviderKind.OpenAICompatible &&
            normalizeProviderDisplayName(provider.name) in defaultCustomOpenAiRelayNames

    return if (isDefaultCustomOpenAiRelay) {
        i18n.t("provider.preset.custom-openai-relay")
    } else {
        provider.name
    }
}

suspend fun readUpload(
    context: Context,
    uri: Uri,
    fallbackName: String,
    i18n: NativeI18n,
): ImageUpload = withContext(Dispatchers.IO) {
    val resolver = context.contentResolver
    val mimeType = resolver.getType(uri) ?: "image/png"
    val name = resolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
    } ?: fallbackName
    val bytes = readBoundedLocalUriBytes(
        context,
        uri,
        MAX_IMAGE_FILE_BYTES,
        localFileTooLargeMessage(i18n, MAX_IMAGE_FILE_BYTES),
    )
    ImageUpload(bytes = bytes, fileName = name, mimeType = mimeType)
}
