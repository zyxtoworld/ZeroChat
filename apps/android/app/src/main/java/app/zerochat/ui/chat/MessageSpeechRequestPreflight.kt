package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.MessageRole

internal enum class MessageSpeechBlocker {
    TextRequired,
    StreamingMessage,
    ProviderRequired,
    SpeechModelRequired,
    ProviderKeyRequired,
}

internal data class PreparedMessageSpeechRequest(
    val provider: ProviderConfig,
    val requestProvider: ProviderConfig,
    val model: String,
    val input: String,
)

internal sealed class MessageSpeechRequestPlan {
    data class Ready(val request: PreparedMessageSpeechRequest) : MessageSpeechRequestPlan()
    data class Blocked(val blocker: MessageSpeechBlocker) : MessageSpeechRequestPlan()
}

internal fun prepareMessageSpeechRequest(
    snapshot: AppSnapshot,
    conversation: Conversation?,
    message: ChatMessage,
    hasProviderKey: (String) -> Boolean,
): MessageSpeechRequestPlan {
    val input = (if (message.role == MessageRole.Assistant) {
        normalizeAssistantMessageContent(message.content)
    } else {
        message.content
    }).trim()
    if (input.isBlank()) {
        return MessageSpeechRequestPlan.Blocked(MessageSpeechBlocker.TextRequired)
    }
    if (message.status == "streaming") {
        return MessageSpeechRequestPlan.Blocked(MessageSpeechBlocker.StreamingMessage)
    }

    val provider = conversation
        ?.providerId
        ?.let { providerId -> snapshot.providers.firstOrNull { it.id == providerId && it.enabled } }
        ?: return MessageSpeechRequestPlan.Blocked(MessageSpeechBlocker.ProviderRequired)

    val model = audioSpeechModelForProvider(provider)
    if (model.isBlank()) {
        return MessageSpeechRequestPlan.Blocked(MessageSpeechBlocker.SpeechModelRequired)
    }

    val requestProvider = providerRequest(provider, snapshot)
    if (providerNeedsClientKey(requestProvider) && !hasProviderKey(provider.id)) {
        return MessageSpeechRequestPlan.Blocked(MessageSpeechBlocker.ProviderKeyRequired)
    }

    return MessageSpeechRequestPlan.Ready(
        PreparedMessageSpeechRequest(
            provider = provider,
            requestProvider = requestProvider,
            model = model,
            input = input,
        ),
    )
}
