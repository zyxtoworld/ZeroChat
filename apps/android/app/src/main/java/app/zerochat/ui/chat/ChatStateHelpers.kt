package app.zerochat.ui.chat

import app.zerochat.ai.GeneratedImage
import app.zerochat.ai.ImageUpload
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageAttachment
import app.zerochat.data.MessageRole
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.defaultProviderConfigs
import app.zerochat.data.normalizeOfficialProviderContracts
import app.zerochat.ui.ComposerMode
import app.zerochat.ui.ImageTaskMode
import java.util.UUID

private const val PENDING_IMAGE_PROMPT_SEPARATOR = "\n\n"
private const val PENDING_IMAGE_STATE_MARKER = ""

fun newConversation(provider: ProviderConfig, model: String, fallbackTitle: String): Conversation {
    val now = nowMillis()
    return Conversation(
        id = newId(),
        title = fallbackTitle,
        providerId = provider.id,
        model = model,
        messages = emptyList(),
        createdAt = now,
        updatedAt = now,
    )
}
internal fun canReuseUninteractedNewConversation(
    conversation: Conversation?,
    fallbackTitle: String,
    input: String,
    editing: Boolean,
    composerMode: ComposerMode,
    imageTask: ImageTaskMode,
    hasSourceImage: Boolean,
    hasMaskImage: Boolean,
): Boolean =
    conversation != null &&
        conversation.messages.isEmpty() &&
        input.isBlank() &&
        !editing &&
        composerMode == ComposerMode.Chat &&
        imageTask == ImageTaskMode.Generate &&
        !hasSourceImage &&
        !hasMaskImage

fun activeConversation(snapshot: AppSnapshot): Conversation? {
    val activeId = snapshot.preferences.activeConversationId
    return snapshot.conversations.firstOrNull { it.id == activeId }
        ?: snapshot.conversations.firstOrNull()
}

fun hydrateChatSnapshot(
    snapshot: AppSnapshot,
    customOpenAiRelayName: String,
    now: Long,
    ownedStreamingImageMessageIds: Set<String> = emptySet(),
    orphanedImageFailureCopy: String? = null,
): AppSnapshot {
    val hydrated = if (snapshot.providers.isEmpty()) {
        snapshot.copy(
            providers = defaultProviderConfigs(customOpenAiRelayName),
            preferences = snapshot.preferences.copy(firstRunDone = true),
            updatedAt = now,
        )
    } else {
        snapshot
    }

    val normalized = normalizeOfficialProviderContracts(hydrated)
    return orphanedImageFailureCopy?.let { failureCopy ->
        recoverOrphanedStreamingImageMessages(
            snapshot = normalized,
            ownedMessageIds = ownedStreamingImageMessageIds,
            failureCopy = failureCopy,
            now = now,
        )
    } ?: normalized
}

fun recoverOrphanedStreamingImageMessages(
    snapshot: AppSnapshot,
    ownedMessageIds: Set<String>,
    failureCopy: String,
    now: Long,
): AppSnapshot {
    var recoveredAny = false
    val conversations = snapshot.conversations.map { conversation ->
        var recoveredConversation = false
        val messages = conversation.messages.map { message ->
            val prompt = pendingImagePrompt(message)
            if (
                message.status == "streaming" &&
                message.id !in ownedMessageIds &&
                prompt != null
            ) {
                recoveredAny = true
                recoveredConversation = true
                message.copy(
                    content = prompt,
                    status = "error",
                    error = failureCopy,
                    attachments = emptyList(),
                )
            } else {
                message
            }
        }
        if (recoveredConversation) {
            conversation.copy(messages = messages, updatedAt = now)
        } else {
            conversation
        }
    }

    return if (recoveredAny) {
        snapshot.copy(conversations = conversations, updatedAt = now)
    } else {
        snapshot
    }
}

fun selectConversation(snapshot: AppSnapshot, conversationId: String): AppSnapshot {
    if (snapshot.conversations.none { it.id == conversationId }) {
        return snapshot
    }

    return snapshot.copy(
        preferences = snapshot.preferences.copy(activeConversationId = conversationId),
    )
}

fun replaceConversation(
    snapshot: AppSnapshot,
    id: String,
    conversation: Conversation,
): AppSnapshot = snapshot.copy(
    conversations = snapshot.conversations.map { if (it.id == id) conversation else it },
    preferences = snapshot.preferences.copy(activeConversationId = id),
)

fun upsertConversation(
    snapshot: AppSnapshot,
    conversation: Conversation,
): AppSnapshot {
    val exists = snapshot.conversations.any { it.id == conversation.id }
    return snapshot.copy(
        conversations = if (exists) {
            snapshot.conversations.map { if (it.id == conversation.id) conversation else it }
        } else {
            listOf(conversation) + snapshot.conversations
        },
        preferences = snapshot.preferences.copy(activeConversationId = conversation.id),
    )
}

fun addConversation(snapshot: AppSnapshot, conversation: Conversation): AppSnapshot =
    snapshot.copy(
        conversations = listOf(conversation) + snapshot.conversations.filterNot { it.id == conversation.id },
        preferences = snapshot.preferences.copy(activeConversationId = conversation.id),
    )

fun applyProviderModelSelection(
    snapshot: AppSnapshot,
    existingConversation: Conversation?,
    provider: ProviderConfig,
    selectedModel: String,
    imageMode: Boolean,
    now: Long,
    fallbackTitle: String,
    newConversationId: String,
): AppSnapshot {
    val chatModel = if (imageMode) {
        if (existingConversation?.providerId == provider.id) {
            chatModelForConversation(existingConversation, provider)
        } else {
            defaultChatModelForProvider(provider)
        }
    } else {
        selectedModel
    }
    val baseConversation = existingConversation ?: Conversation(
        id = newConversationId,
        title = fallbackTitle,
        providerId = provider.id,
        model = chatModel,
        messages = emptyList(),
        createdAt = now,
        updatedAt = now,
    )
    val nextConversation = baseConversation.copy(
        providerId = provider.id,
        model = chatModel,
        updatedAt = now,
    )
    val nextSnapshot = if (imageMode) {
        snapshot.copy(
            providers = replaceProvider(
                snapshot.providers,
                provider.copy(imageModel = selectedModel, updatedAt = now),
            ),
        )
    } else {
        snapshot
    }

    return upsertConversation(nextSnapshot, nextConversation)
}

data class PendingChatTurn(
    val snapshot: AppSnapshot,
    val baseMessages: List<ChatMessage>,
    val pendingAssistantMessage: ChatMessage,
)

fun createPendingChatTurn(
    snapshot: AppSnapshot,
    conversation: Conversation,
    model: String,
    text: String,
    editId: String?,
    userMessageId: String,
    assistantMessageId: String,
    now: Long,
    fallbackTitle: String,
): PendingChatTurn? {
    val trimmed = text.trim()
    val baseMessages = if (editId == null) {
        conversation.messages + ChatMessage(
            id = userMessageId,
            role = MessageRole.User,
            content = trimmed,
            createdAt = now,
        )
    } else {
        val index = conversation.messages.indexOfFirst { it.id == editId }
        if (index < 0 || conversation.messages[index].role != MessageRole.User) {
            return null
        }
        conversation.messages.take(index) + conversation.messages[index].copy(
            content = trimmed,
            createdAt = now,
            status = "done",
            error = null,
        )
    }
    val pendingAssistantMessage = ChatMessage(
        id = assistantMessageId,
        role = MessageRole.Assistant,
        content = "",
        createdAt = now,
        status = "streaming",
    )
    val nextSnapshot = upsertConversation(
        snapshot,
        conversation.copy(
            model = model,
            title = conversationTitle(baseMessages, fallbackTitle),
            messages = baseMessages + pendingAssistantMessage,
            updatedAt = now,
        ),
    )

    return PendingChatTurn(
        snapshot = nextSnapshot,
        baseMessages = baseMessages,
        pendingAssistantMessage = pendingAssistantMessage,
    )
}

data class PendingImageMessage(
    val snapshot: AppSnapshot,
    val pendingMessage: ChatMessage,
)

fun createPendingImageMessage(
    snapshot: AppSnapshot,
    conversation: Conversation,
    prompt: String,
    pendingMessageId: String,
    now: Long,
    generatingCopy: String,
    imageConversationPrefix: String,
): PendingImageMessage {
    val trimmed = prompt.trim()
    val pendingMessage = ChatMessage(
        id = pendingMessageId,
        role = MessageRole.Assistant,
        content = "$generatingCopy$PENDING_IMAGE_PROMPT_SEPARATOR$trimmed",
        createdAt = now,
        status = "streaming",
        // A non-null empty error is persisted but not rendered, so hydration can distinguish image work.
        error = PENDING_IMAGE_STATE_MARKER,
    )
    val nextSnapshot = upsertConversation(
        snapshot,
        conversation.copy(
            title = conversation.title.ifBlank {
                "$imageConversationPrefix: ${trimmed.take(24)}"
            },
            messages = conversation.messages + pendingMessage,
            updatedAt = now,
        ),
    )

    return PendingImageMessage(
        snapshot = nextSnapshot,
        pendingMessage = pendingMessage,
    )
}

fun completeImageMessage(
    pendingMessage: ChatMessage,
    image: GeneratedImage,
    prompt: String,
    imageModel: String,
    attachmentId: String,
    createdAt: Long,
): ChatMessage =
    pendingMessage.copy(
        content = image.revisedPrompt?.takeIf { it.isNotBlank() } ?: prompt,
        status = "done",
        error = null,
        attachments = listOf(
            MessageAttachment(
                id = attachmentId,
                kind = "image",
                purpose = "generated",
                mimeType = image.mimeType,
                dataUrl = image.dataUrl,
                url = image.url,
                alt = prompt,
                model = imageModel,
                createdAt = createdAt,
            ),
        ),
    )

fun failImageMessage(
    pendingMessage: ChatMessage,
    failureCopy: String,
    errorCopy: String,
): ChatMessage {
    val retryPrompt = pendingImagePrompt(pendingMessage)
    return pendingMessage.copy(
        content = retryPrompt ?: failureCopy,
        status = "error",
        error = if (retryPrompt == null) errorCopy else "$failureCopy: $errorCopy",
        attachments = emptyList(),
    )
}

fun stoppedImageMessage(
    pendingMessage: ChatMessage,
    stoppedCopy: String,
): ChatMessage = pendingMessage.copy(
    content = stoppedCopy,
    status = "done",
    error = null,
    attachments = emptyList(),
)

fun pendingImagePrompt(message: ChatMessage): String? {
    if (
        message.role != MessageRole.Assistant ||
        message.status != "streaming" ||
        message.error != PENDING_IMAGE_STATE_MARKER
    ) {
        return null
    }
    val separatorIndex = message.content.indexOf(PENDING_IMAGE_PROMPT_SEPARATOR)
    if (separatorIndex < 0) {
        return null
    }
    return message.content
        .substring(separatorIndex + PENDING_IMAGE_PROMPT_SEPARATOR.length)
        .trim()
        .takeIf { it.isNotEmpty() }
}

fun imageRetryPrompt(conversation: Conversation, message: ChatMessage): String? {
    pendingImagePrompt(message)?.let { return it }
    if (message.role != MessageRole.Assistant || message.status != "error") {
        return null
    }
    val messageIndex = conversation.messages.indexOfFirst { it.id == message.id }
    if (messageIndex < 0 || conversation.messages.getOrNull(messageIndex - 1)?.role == MessageRole.User) {
        return null
    }
    return message.content.trim().takeIf { it.isNotEmpty() }
}

fun stoppedAssistantMessage(
    pendingMessage: ChatMessage,
    partialContent: String,
    stoppedCopy: String,
): ChatMessage =
    pendingMessage.copy(
        content = partialContent.ifBlank { stoppedCopy },
        status = "done",
        error = null,
    )

fun deleteConversation(
    snapshot: AppSnapshot,
    conversationId: String,
): AppSnapshot {
    val nextConversations = snapshot.conversations.filterNot { it.id == conversationId }
    val currentActiveId = snapshot.preferences.activeConversationId
    val nextActiveId = if (currentActiveId == conversationId) {
        nextConversations.firstOrNull()?.id
    } else {
        currentActiveId?.takeIf { id -> nextConversations.any { it.id == id } }
    }

    return snapshot.copy(
        conversations = nextConversations,
        preferences = snapshot.preferences.copy(activeConversationId = nextActiveId),
    )
}

fun deleteMessage(
    snapshot: AppSnapshot,
    conversationId: String,
    messageId: String,
    updatedAt: Long,
): AppSnapshot {
    val conversation = snapshot.conversations.firstOrNull { it.id == conversationId } ?: return snapshot
    val nextMessages = conversation.messages.filterNot { it.id == messageId }
    if (nextMessages.size == conversation.messages.size) {
        return snapshot
    }

    return replaceConversation(
        snapshot,
        conversationId,
        conversation.copy(
            messages = nextMessages,
            updatedAt = updatedAt,
        ),
    )
}

fun replaceMessage(
    snapshot: AppSnapshot,
    conversationId: String,
    message: ChatMessage,
    updatedAt: Long,
): AppSnapshot {
    val conversation = snapshot.conversations.firstOrNull { it.id == conversationId } ?: return snapshot
    val nextMessages = conversation.messages.map { if (it.id == message.id) message else it }
    if (nextMessages == conversation.messages) {
        return snapshot
    }

    val nextConversation = conversation.copy(
        messages = nextMessages,
        updatedAt = updatedAt,
    )
    return snapshot.copy(
        conversations = snapshot.conversations.map {
            if (it.id == conversationId) nextConversation else it
        },
    )
}

fun replaceMessageReducer(
    conversationId: String,
    message: ChatMessage,
    updatedAt: Long,
): (AppSnapshot) -> AppSnapshot = { latestSnapshot ->
    replaceMessage(
        snapshot = latestSnapshot,
        conversationId = conversationId,
        message = message,
        updatedAt = updatedAt,
    )
}

enum class ManualCloudSyncBlocker {
    Generating,
    LocalOnly,
    SyncPasswordRequired,
    GithubTokenRequired,
    CloudflareWorkerRequired,
    CloudflareAccessKeyRequired,
}

fun manualCloudSyncBlocker(
    snapshot: AppSnapshot,
    isChatStreaming: Boolean,
    hasSyncPassphrase: Boolean,
    hasGithubToken: Boolean,
    hasCloudflareAccessKey: Boolean,
): ManualCloudSyncBlocker? = when {
    isChatStreaming -> ManualCloudSyncBlocker.Generating
    snapshot.sync.mode == "local" -> ManualCloudSyncBlocker.LocalOnly
    !hasSyncPassphrase -> ManualCloudSyncBlocker.SyncPasswordRequired
    snapshot.sync.mode == "gist" && !hasGithubToken -> ManualCloudSyncBlocker.GithubTokenRequired
    snapshot.sync.mode == "cloudflare" && snapshot.sync.workerEndpoint.isNullOrBlank() ->
        ManualCloudSyncBlocker.CloudflareWorkerRequired
    snapshot.sync.mode == "cloudflare" && !hasCloudflareAccessKey ->
        ManualCloudSyncBlocker.CloudflareAccessKeyRequired
    else -> null
}

fun canSubmitComposer(
    input: String,
    isChatStreaming: Boolean,
    activeProvider: ProviderConfig?,
    activeProviderKeyMissing: Boolean,
    composerMode: ComposerMode,
    activeModel: String,
    activeImageModel: String,
    imageTask: ImageTaskMode,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
): Boolean {
    if (input.isBlank() || isChatStreaming || activeProvider == null || activeProviderKeyMissing) {
        return false
    }

    return when (composerMode) {
        ComposerMode.Chat -> activeModel.isNotBlank()
        ComposerMode.Image ->
            activeProvider.kind != ProviderKind.Anthropic &&
                activeImageModel.isNotBlank() &&
                (imageTask == ImageTaskMode.Generate || sourceImage != null) &&
                (imageTask != ImageTaskMode.Inpaint || maskImage != null)
    }
}

fun conversationTitle(messages: List<ChatMessage>, fallbackTitle: String): String {
    return messages.firstOrNull { it.role == MessageRole.User }
        ?.content
        ?.trim()
        ?.take(40)
        ?.ifBlank { null }
        ?: fallbackTitle
}

fun nowMillis(): Long = System.currentTimeMillis()

fun newId(): String = UUID.randomUUID().toString()
