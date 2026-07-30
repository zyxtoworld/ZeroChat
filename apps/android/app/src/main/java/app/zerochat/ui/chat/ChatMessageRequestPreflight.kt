package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig

internal enum class ChatMessageBlocker {
    Generating,
    ProviderRequired,
    ModelRequired,
    ProviderKeyRequired,
    PromptRequired,
}

internal data class PreparedChatMessageRequest(
    val provider: ProviderConfig,
    val requestProvider: ProviderConfig,
    val model: String,
    val prompt: String,
)

internal sealed class ChatMessageRequestPlan {
    data class Ready(val request: PreparedChatMessageRequest) : ChatMessageRequestPlan()
    data class Blocked(val blocker: ChatMessageBlocker) : ChatMessageRequestPlan()
}

internal fun prepareChatMessageRequest(
    snapshot: AppSnapshot,
    conversation: Conversation,
    prompt: String,
    isChatStreaming: Boolean,
    hasProviderKey: (String) -> Boolean,
): ChatMessageRequestPlan {
    if (isChatStreaming) {
        return ChatMessageRequestPlan.Blocked(ChatMessageBlocker.Generating)
    }

    val provider = snapshot.providers.firstOrNull { it.id == conversation.providerId && it.enabled }
        ?: return ChatMessageRequestPlan.Blocked(ChatMessageBlocker.ProviderRequired)
    val model = chatModelForConversation(conversation, provider)
    if (model.isBlank()) {
        return ChatMessageRequestPlan.Blocked(ChatMessageBlocker.ModelRequired)
    }

    val requestProvider = providerRequest(provider, snapshot)
    if (providerNeedsClientKey(requestProvider) && !hasProviderKey(provider.id)) {
        return ChatMessageRequestPlan.Blocked(ChatMessageBlocker.ProviderKeyRequired)
    }

    val trimmedPrompt = prompt.trim()
    if (trimmedPrompt.isBlank()) {
        return ChatMessageRequestPlan.Blocked(ChatMessageBlocker.PromptRequired)
    }

    return ChatMessageRequestPlan.Ready(
        PreparedChatMessageRequest(
            provider = provider,
            requestProvider = requestProvider,
            model = model,
            prompt = trimmedPrompt,
        ),
    )
}
