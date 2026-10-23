package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageAttachment
import app.zerochat.data.MessageRole
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.SyncConfig
import app.zerochat.ai.GeneratedImage
import app.zerochat.ai.ImageUpload
import app.zerochat.ui.ComposerMode
import app.zerochat.ui.ImageTaskMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ChatStateHelpersTest {
    @Test
    fun hydrateChatSnapshotInjectsDefaultProvidersAndCompletesFirstRun() {
        val snapshot = AppSnapshot(
            providers = emptyList(),
            preferences = Preferences(firstRunDone = false),
            updatedAt = 1,
        )

        val hydrated = hydrateChatSnapshot(
            snapshot,
            customOpenAiRelayName = "Custom relay",
            now = 99,
        )

        assertEquals(true, hydrated.preferences.firstRunDone)
        assertEquals(99, hydrated.updatedAt)
        assertEquals("openai", hydrated.providers.first().id)
        assertEquals("gpt-image-2", hydrated.providers.first().imageModel)
        assertEquals(
            "Custom relay",
            hydrated.providers.first { it.id == "custom-openai" }.name,
        )
    }

    @Test
    fun hydrateChatSnapshotKeepsExistingProvidersAsTheAuthoritativeSnapshot() {
        val existingProvider = provider("existing", model = "chat-model")
        val snapshot = AppSnapshot(
            providers = listOf(existingProvider),
            preferences = Preferences(firstRunDone = false),
            updatedAt = 10,
        )

        val hydrated = hydrateChatSnapshot(
            snapshot,
            customOpenAiRelayName = "Custom relay",
            now = 99,
        )

        assertSame(snapshot, hydrated)
        assertEquals(false, hydrated.preferences.firstRunDone)
        assertEquals(10, hydrated.updatedAt)
        assertEquals(listOf("existing"), hydrated.providers.map { it.id })
    }

    @Test
    fun selectConversationKeepsTheSnapshotWhenTheConversationIsMissing() {
        val snapshot = snapshot(activeId = "one", conversations = listOf("one", "two"))

        val selected = selectConversation(snapshot, "two")
        val missing = selectConversation(snapshot, "missing")

        assertEquals("two", selected.preferences.activeConversationId)
        assertSame(snapshot, missing)
    }

    @Test
    fun addConversationMovesTheConversationToTheTopAndMakesItActive() {
        val snapshot = snapshot(activeId = "one", conversations = listOf("one", "two"))
        val existingReplacement = conversation("two").copy(title = "Updated two", updatedAt = 42)
        val newConversation = conversation("three")

        val replaced = addConversation(snapshot, existingReplacement)
        val added = addConversation(snapshot, newConversation)

        assertEquals(listOf("two", "one"), replaced.conversations.map { it.id })
        assertEquals("Updated two", replaced.conversations.first().title)
        assertEquals("two", replaced.preferences.activeConversationId)
        assertEquals(listOf("three", "one", "two"), added.conversations.map { it.id })
        assertEquals("three", added.preferences.activeConversationId)
    }
    @Test
    fun freshUninteractedNewConversationCanBeReusedWithoutDuplicatingIt() {
        val fresh = conversation("fresh").copy(title = "New chat")

        assertTrue(
            canReuseUninteractedNewConversation(
                conversation = fresh,
                fallbackTitle = "New chat",
                input = "",
                editing = false,
                composerMode = ComposerMode.Chat,
                imageTask = ImageTaskMode.Generate,
                hasSourceImage = false,
                hasMaskImage = false,
            ),
        )
        assertFalse(
            canReuseUninteractedNewConversation(
                conversation = fresh.copy(messages = listOf(message("user"))),
                fallbackTitle = "New chat",
                input = "",
                editing = false,
                composerMode = ComposerMode.Chat,
                imageTask = ImageTaskMode.Generate,
                hasSourceImage = false,
                hasMaskImage = false,
            ),
        )
        assertFalse(
            canReuseUninteractedNewConversation(
                conversation = fresh,
                fallbackTitle = "New chat",
                input = "draft",
                editing = false,
                composerMode = ComposerMode.Chat,
                imageTask = ImageTaskMode.Generate,
                hasSourceImage = false,
                hasMaskImage = false,
            ),
        )
    }
    @Test
    fun applyProviderModelSelectionUpdatesChatConversationWithoutChangingProviderImageModel() {
        val oldProvider = provider("old", model = "old-chat")
        val selectedProvider = provider(
            "selected",
            model = "gpt-4o-mini",
            models = listOf("gpt-4o-mini", "dall-e-3"),
            imageModel = "old-image",
        )
        val activeConversation = conversation("one").copy(
            providerId = oldProvider.id,
            model = "old-chat",
        )
        val snapshot = snapshotWithConversations("one", activeConversation)
            .copy(providers = listOf(oldProvider, selectedProvider))

        val next = applyProviderModelSelection(
            snapshot = snapshot,
            existingConversation = activeConversation,
            provider = selectedProvider,
            selectedModel = "gpt-4.1",
            imageMode = false,
            now = 44,
            fallbackTitle = "New chat",
            newConversationId = "new-id",
        )

        val changedConversation = next.conversations.single()
        val unchangedProvider = next.providers.single { it.id == selectedProvider.id }
        assertEquals("selected", changedConversation.providerId)
        assertEquals("gpt-4.1", changedConversation.model)
        assertEquals(44, changedConversation.updatedAt)
        assertEquals("old-image", unchangedProvider.imageModel)
        assertEquals(1, unchangedProvider.updatedAt)
        assertEquals("one", next.preferences.activeConversationId)
    }

    @Test
    fun applyProviderModelSelectionKeepsChatModelWhenImageModeUpdatesTheSameProvider() {
        val selectedProvider = provider(
            "selected",
            model = "gpt-4o",
            models = listOf("gpt-4o", "dall-e-3"),
            imageModel = "old-image",
        )
        val activeConversation = conversation("one").copy(
            providerId = selectedProvider.id,
            model = "gpt-4o",
        )
        val snapshot = snapshotWithConversations("one", activeConversation)
            .copy(providers = listOf(selectedProvider))

        val next = applyProviderModelSelection(
            snapshot = snapshot,
            existingConversation = activeConversation,
            provider = selectedProvider,
            selectedModel = "dall-e-3",
            imageMode = true,
            now = 88,
            fallbackTitle = "New chat",
            newConversationId = "new-id",
        )

        val changedConversation = next.conversations.single()
        val changedProvider = next.providers.single()
        assertEquals("gpt-4o", changedConversation.model)
        assertEquals(88, changedConversation.updatedAt)
        assertEquals("dall-e-3", changedProvider.imageModel)
        assertEquals(88, changedProvider.updatedAt)
        assertEquals("one", next.preferences.activeConversationId)
    }

    @Test
    fun applyProviderModelSelectionRepairsStaleChatModelWhenImageModeKeepsProvider() {
        val selectedProvider = provider(
            "selected",
            model = "gpt-4o-mini",
            models = listOf("gpt-image-2", "gpt-5.5-openai-compact", "gpt-5.5"),
        )
        val activeConversation = conversation("one").copy(
            providerId = selectedProvider.id,
            model = "gpt-4.1-mini",
        )
        val snapshot = snapshotWithConversations("one", activeConversation)
            .copy(providers = listOf(selectedProvider))

        val next = applyProviderModelSelection(
            snapshot = snapshot,
            existingConversation = activeConversation,
            provider = selectedProvider,
            selectedModel = "gpt-image-2",
            imageMode = true,
            now = 89,
            fallbackTitle = "New chat",
            newConversationId = "new-id",
        )

        assertEquals("gpt-5.5", next.conversations.single().model)
        assertEquals("gpt-image-2", next.providers.single().imageModel)
    }

    @Test
    fun applyProviderModelSelectionCreatesANewConversationWhenNoChatIsActive() {
        val selectedProvider = provider(
            "selected",
            model = "gpt-4.1-mini",
            models = listOf("gpt-4o-mini", "gpt-5.5", "dall-e-3"),
        )
        val snapshot = snapshot(activeId = null, conversations = listOf("one"))
            .copy(providers = listOf(selectedProvider))

        val next = applyProviderModelSelection(
            snapshot = snapshot,
            existingConversation = null,
            provider = selectedProvider,
            selectedModel = "dall-e-3",
            imageMode = true,
            now = 111,
            fallbackTitle = "New chat",
            newConversationId = "new-id",
        )

        val newConversation = next.conversations.first()
        val changedProvider = next.providers.single()
        assertEquals(listOf("new-id", "one"), next.conversations.map { it.id })
        assertEquals("New chat", newConversation.title)
        assertEquals("selected", newConversation.providerId)
        assertEquals("gpt-5.5", newConversation.model)
        assertEquals(111, newConversation.createdAt)
        assertEquals(111, newConversation.updatedAt)
        assertEquals("dall-e-3", changedProvider.imageModel)
        assertEquals("new-id", next.preferences.activeConversationId)
    }

    @Test
    fun createPendingChatTurnAppendsAUserMessageAndAssistantPlaceholder() {
        val snapshot = snapshot(activeId = "one", conversations = listOf("one"))

        val turn = createPendingChatTurn(
            snapshot = snapshot,
            conversation = snapshot.conversations.single(),
            model = "model",
            text = "  hello  ",
            editId = null,
            userMessageId = "user",
            assistantMessageId = "assistant",
            now = 99,
            fallbackTitle = "Fallback",
        )

        requireNotNull(turn)
        assertEquals(listOf("user", "assistant"), turn.snapshot.conversations.single().messages.map { it.id })
        assertEquals("hello", turn.snapshot.conversations.single().messages.first().content)
        assertEquals("hello", turn.snapshot.conversations.single().title)
        assertEquals("model", turn.snapshot.conversations.single().model)
        assertEquals(99, turn.snapshot.conversations.single().updatedAt)
        assertEquals(1, turn.baseMessages.size)
        assertEquals("assistant", turn.pendingAssistantMessage.id)
    }

    @Test
    fun createPendingChatTurnUpsertsANewConversationBeforeComposeStateRecomposes() {
        val conversation = conversation("fresh")

        val turn = createPendingChatTurn(
            snapshot = snapshotWithConversations(activeId = null),
            conversation = conversation,
            model = "model",
            text = "hello",
            editId = null,
            userMessageId = "user",
            assistantMessageId = "assistant",
            now = 99,
            fallbackTitle = "Fallback",
        )

        requireNotNull(turn)
        assertEquals(listOf("fresh"), turn.snapshot.conversations.map { it.id })
        assertEquals("fresh", turn.snapshot.preferences.activeConversationId)
        assertEquals(listOf("user", "assistant"), turn.snapshot.conversations.single().messages.map { it.id })
    }

    @Test
    fun createPendingChatTurnEditsOnlyTheTargetUserMessageAndTruncatesLaterMessages() {
        val snapshot = snapshotWithConversations(
            "one",
            conversation("one").copy(
                messages = listOf(
                    message("system").copy(role = MessageRole.System),
                    message("edit-me"),
                    message("assistant").copy(role = MessageRole.Assistant),
                ),
            ),
        )

        val turn = createPendingChatTurn(
            snapshot = snapshot,
            conversation = snapshot.conversations.single(),
            model = "model",
            text = "edited",
            editId = "edit-me",
            userMessageId = "user",
            assistantMessageId = "assistant2",
            now = 123,
            fallbackTitle = "Fallback",
        )

        requireNotNull(turn)
        assertEquals(listOf("system", "edit-me", "assistant2"), turn.snapshot.conversations.single().messages.map { it.id })
        assertEquals("edited", turn.snapshot.conversations.single().messages[1].content)
        assertEquals(MessageRole.User, turn.snapshot.conversations.single().messages[1].role)
        assertEquals("edited", turn.snapshot.conversations.single().title)
        assertEquals(123, turn.snapshot.conversations.single().updatedAt)
        assertEquals(2, turn.baseMessages.size)
        assertEquals("assistant2", turn.pendingAssistantMessage.id)
    }

    @Test
    fun createPendingChatTurnReturnsNullWhenEditTargetIsMissingOrNotUserOwned() {
        val snapshot = snapshot(
            activeId = "one",
            conversations = listOf("one"),
            messages = mapOf("one" to listOf(message("keep").copy(role = MessageRole.Assistant))),
        )

        val missing = createPendingChatTurn(
            snapshot = snapshot,
            conversation = snapshot.conversations.single(),
            model = "model",
            text = "edited",
            editId = "missing",
            userMessageId = "user",
            assistantMessageId = "assistant",
            now = 123,
            fallbackTitle = "Fallback",
        )
        val notOwned = createPendingChatTurn(
            snapshot = snapshot,
            conversation = snapshot.conversations.single(),
            model = "model",
            text = "edited",
            editId = "keep",
            userMessageId = "user",
            assistantMessageId = "assistant",
            now = 123,
            fallbackTitle = "Fallback",
        )

        assertNull(missing)
        assertNull(notOwned)
    }

    @Test
    fun createPendingImageMessageAppendsStreamingPlaceholderAndFallsBackToPromptPrefix() {
        val snapshot = snapshot(activeId = "one", conversations = listOf("one"))
        val emptyTitleConversation = conversation("one").copy(title = "")
        val next = createPendingImageMessage(
            snapshot = snapshot.copy(conversations = listOf(emptyTitleConversation)),
            conversation = emptyTitleConversation,
            prompt = "   draw a scene   ",
            pendingMessageId = "pending",
            now = 77,
            generatingCopy = "Generating image",
            imageConversationPrefix = "Image",
        )

        assertEquals("Image: draw a scene", next.snapshot.conversations.single().title)
        assertEquals(listOf("pending"), next.snapshot.conversations.single().messages.map { it.id })
        assertEquals("Generating image\n\ndraw a scene", next.pendingMessage.content)
        assertEquals("draw a scene", pendingImagePrompt(next.pendingMessage))
        assertEquals("pending", next.pendingMessage.id)
        assertEquals(77, next.snapshot.conversations.single().updatedAt)
    }

    @Test
    fun createPendingImageMessageUpsertsANewConversationBeforeComposeStateRecomposes() {
        val conversation = conversation("fresh").copy(title = "")

        val pending = createPendingImageMessage(
            snapshot = snapshotWithConversations(activeId = null),
            conversation = conversation,
            prompt = "draw a scene",
            pendingMessageId = "pending",
            now = 77,
            generatingCopy = "Generating image",
            imageConversationPrefix = "Image",
        )

        assertEquals(listOf("fresh"), pending.snapshot.conversations.map { it.id })
        assertEquals("fresh", pending.snapshot.preferences.activeConversationId)
        assertEquals(listOf("pending"), pending.snapshot.conversations.single().messages.map { it.id })
    }

    @Test
    fun hydrateChatSnapshotRecoversOnlyUnownedStreamingImageMessages() {
        val conversation = conversation("one").copy(title = "")
        val base = AppSnapshot(
            providers = listOf(provider("existing", model = "chat-model")),
            conversations = listOf(conversation),
            preferences = Preferences(activeConversationId = conversation.id),
        )
        val pending = createPendingImageMessage(
            snapshot = base,
            conversation = conversation,
            prompt = "  draw a lighthouse  ",
            pendingMessageId = "pending-image",
            now = 10,
            generatingCopy = "Generating image",
            imageConversationPrefix = "Image",
        ).snapshot

        val recovered = hydrateChatSnapshot(
            snapshot = pending,
            customOpenAiRelayName = "Custom relay",
            now = 99,
            orphanedImageFailureCopy = "Image request interrupted. Retry.",
        )
        val message = recovered.conversations.single().messages.single()

        assertEquals("draw a lighthouse", message.content)
        assertEquals("error", message.status)
        assertEquals("Image request interrupted. Retry.", message.error)
        assertEquals(99, recovered.conversations.single().updatedAt)
        assertEquals(99, recovered.updatedAt)
        assertEquals("draw a lighthouse", imageRetryPrompt(recovered.conversations.single(), message))
    }

    @Test
    fun hydrateChatSnapshotKeepsOwnedImageAndTextStreamingMessages() {
        val conversation = conversation(
            "one",
            listOf(
                message("user").copy(role = MessageRole.User, content = "hello"),
                message("text-stream").copy(
                    role = MessageRole.Assistant,
                    content = "partial\n\nanswer",
                    status = "streaming",
                ),
            ),
        )
        val base = AppSnapshot(
            providers = listOf(provider("existing", model = "chat-model")),
            conversations = listOf(conversation),
            preferences = Preferences(activeConversationId = conversation.id),
        )
        val pending = createPendingImageMessage(
            snapshot = base,
            conversation = conversation,
            prompt = "draw a harbor",
            pendingMessageId = "owned-image",
            now = 10,
            generatingCopy = "Generating image",
            imageConversationPrefix = "Image",
        ).snapshot

        val hydrated = hydrateChatSnapshot(
            snapshot = pending,
            customOpenAiRelayName = "Custom relay",
            now = 99,
            ownedStreamingImageMessageIds = setOf("owned-image"),
            orphanedImageFailureCopy = "Image request interrupted. Retry.",
        )
        val messages = hydrated.conversations.single().messages

        assertSame(pending, hydrated)
        assertEquals("streaming", messages.first { it.id == "text-stream" }.status)
        assertEquals("streaming", messages.first { it.id == "owned-image" }.status)
    }

    @Test
    fun deleteConversationSelectsFirstRemainingConversationWhenActiveConversationIsDeleted() {
        val snapshot = snapshot(activeId = "two", conversations = listOf("one", "two", "three"))

        val next = deleteConversation(snapshot, "two")

        assertEquals(listOf("one", "three"), next.conversations.map { it.id })
        assertEquals("one", next.preferences.activeConversationId)
    }

    @Test
    fun deleteConversationKeepsActiveConversationWhenDeletingAnotherConversation() {
        val snapshot = snapshot(activeId = "three", conversations = listOf("one", "two", "three"))

        val next = deleteConversation(snapshot, "two")

        assertEquals(listOf("one", "three"), next.conversations.map { it.id })
        assertEquals("three", next.preferences.activeConversationId)
    }

    @Test
    fun deleteConversationClearsActiveConversationWhenNoValidConversationRemains() {
        val lastConversation = snapshot(activeId = "one", conversations = listOf("one"))
        val staleActive = snapshot(activeId = "missing", conversations = listOf("one"))

        val noConversations = deleteConversation(lastConversation, "one")
        val repairedStaleActive = deleteConversation(staleActive, "unknown")

        assertEquals(emptyList<Conversation>(), noConversations.conversations)
        assertNull(noConversations.preferences.activeConversationId)
        assertEquals(listOf("one"), repairedStaleActive.conversations.map { it.id })
        assertNull(repairedStaleActive.preferences.activeConversationId)
    }

    @Test
    fun deleteMessageRemovesOnlyTheTargetMessageAndUpdatesTheConversation() {
        val snapshot = snapshot(
            activeId = "one",
            conversations = listOf("one", "two"),
            messages = mapOf(
                "one" to listOf(message("keep"), message("delete-me")),
                "two" to listOf(message("other")),
            ),
        )

        val next = deleteMessage(snapshot, "one", "delete-me", updatedAt = 42)

        val changedConversation = next.conversations.first { it.id == "one" }
        val untouchedConversation = next.conversations.first { it.id == "two" }
        assertEquals(listOf("keep"), changedConversation.messages.map { it.id })
        assertEquals(42, changedConversation.updatedAt)
        assertEquals(listOf("other"), untouchedConversation.messages.map { it.id })
        assertEquals("one", next.preferences.activeConversationId)
    }

    @Test
    fun deleteMessageKeepsTheSnapshotWhenTheMessageIsMissing() {
        val snapshot = snapshot(
            activeId = "one",
            conversations = listOf("one"),
            messages = mapOf("one" to listOf(message("keep"))),
        )

        val next = deleteMessage(snapshot, "one", "missing", updatedAt = 42)

        assertSame(snapshot, next)
        assertEquals(listOf("keep"), next.conversations.single().messages.map { it.id })
        assertEquals(1, next.conversations.single().updatedAt)
    }

    @Test
    fun replaceMessageUpdatesOnlyTheMatchingMessageAndConversationTimestamp() {
        val snapshot = snapshot(
            activeId = "one",
            conversations = listOf("one", "two"),
            messages = mapOf(
                "one" to listOf(message("keep"), message("replace-me")),
                "two" to listOf(message("other")),
            ),
        )
        val replacement = message("replace-me").copy(
            role = MessageRole.Assistant,
            content = "replacement",
            status = "done",
        )

        val next = replaceMessage(snapshot, "one", replacement, updatedAt = 77)

        val changedConversation = next.conversations.first { it.id == "one" }
        val untouchedConversation = next.conversations.first { it.id == "two" }
        assertEquals(listOf("keep", "replace-me"), changedConversation.messages.map { it.id })
        assertEquals("replacement", changedConversation.messages.last().content)
        assertEquals(MessageRole.Assistant, changedConversation.messages.last().role)
        assertEquals(77, changedConversation.updatedAt)
        assertEquals(listOf("other"), untouchedConversation.messages.map { it.id })
        assertEquals("one", next.preferences.activeConversationId)
    }

    @Test
    fun replaceMessageKeepsTheSnapshotWhenTheMessageIsMissing() {
        val snapshot = snapshot(
            activeId = "one",
            conversations = listOf("one"),
            messages = mapOf("one" to listOf(message("keep"))),
        )

        val next = replaceMessage(snapshot, "one", message("missing"), updatedAt = 77)

        assertSame(snapshot, next)
        assertEquals(listOf("keep"), next.conversations.single().messages.map { it.id })
        assertEquals(1, next.conversations.single().updatedAt)
    }

    @Test
    fun replaceMessageReducerAppliesToLatestSnapshotWithoutLosingConcurrentState() {
        val pendingSnapshot = snapshot(
            activeId = "one",
            conversations = listOf("one"),
            messages = mapOf("one" to listOf(message("assistant").copy(status = "streaming"))),
        )
        val latestSnapshot = pendingSnapshot.copy(
            conversations = listOf(conversation("two")) + pendingSnapshot.conversations,
            preferences = pendingSnapshot.preferences.copy(
                theme = "dark",
                chatContextMessageLimit = 48,
                activeConversationId = "two",
            ),
        )
        val completed = message("assistant").copy(
            role = MessageRole.Assistant,
            content = "completed",
            status = "done",
        )

        val next = replaceMessageReducer(
            conversationId = "one",
            message = completed,
            updatedAt = 77,
        )(latestSnapshot)

        assertEquals("dark", next.preferences.theme)
        assertEquals(48, next.preferences.chatContextMessageLimit)
        assertEquals("two", next.preferences.activeConversationId)
        assertEquals(listOf("two", "one"), next.conversations.map { it.id })
        val completedConversation = next.conversations.first { it.id == "one" }
        assertEquals("completed", completedConversation.messages.single().content)
        assertEquals(77, completedConversation.updatedAt)
    }

    @Test
    fun replaceMessageReducersPreserveImagesThatCompleteOutOfOrder() {
        val firstPending = message("image-first").copy(
            role = MessageRole.Assistant,
            content = "first prompt",
            status = "streaming",
        )
        val secondPending = message("image-second").copy(
            role = MessageRole.Assistant,
            content = "second prompt",
            status = "streaming",
        )
        val pendingSnapshot = snapshot(
            activeId = "one",
            conversations = listOf("one"),
            messages = mapOf("one" to listOf(firstPending, secondPending)),
        )
        val firstCompleted = firstPending.copy(
            content = "first complete",
            status = "done",
            attachments = listOf(imageAttachment("attachment-first")),
        )
        val secondCompleted = secondPending.copy(
            content = "second complete",
            status = "done",
            attachments = listOf(imageAttachment("attachment-second")),
        )

        val secondFinishesFirst = replaceMessageReducer(
            conversationId = "one",
            message = secondCompleted,
            updatedAt = 20,
        )(pendingSnapshot)
        val bothCompleted = replaceMessageReducer(
            conversationId = "one",
            message = firstCompleted,
            updatedAt = 30,
        )(secondFinishesFirst)

        val messages = bothCompleted.conversations.single().messages
        assertEquals(listOf("first complete", "second complete"), messages.map { it.content })
        assertEquals(
            listOf("attachment-first", "attachment-second"),
            messages.map { it.attachments.single().id },
        )
        assertEquals(30, bothCompleted.conversations.single().updatedAt)
    }

    @Test
    fun manualCloudSyncBlockerPrioritizesStreamingAndLocalMode() {
        val cloudflareSnapshot = AppSnapshot(
            sync = SyncConfig(
                mode = "cloudflare",
                workerEndpoint = "https://sync.example.workers.dev",
            ),
        )
        val localSnapshot = AppSnapshot(sync = SyncConfig(mode = "local"))

        val streaming = manualCloudSyncBlocker(
            snapshot = cloudflareSnapshot,
            isChatStreaming = true,
            hasSyncPassphrase = true,
            hasGithubToken = true,
            hasCloudflareAccessKey = true,
        )
        val localOnly = manualCloudSyncBlocker(
            snapshot = localSnapshot,
            isChatStreaming = false,
            hasSyncPassphrase = true,
            hasGithubToken = true,
            hasCloudflareAccessKey = true,
        )

        assertEquals(ManualCloudSyncBlocker.Generating, streaming)
        assertEquals(ManualCloudSyncBlocker.LocalOnly, localOnly)
    }

    @Test
    fun manualCloudSyncBlockerPreservesProviderSpecificCredentialReasons() {
        val gistSnapshot = AppSnapshot(sync = SyncConfig(mode = "gist"))
        val cloudflareSnapshot = AppSnapshot(
            sync = SyncConfig(
                mode = "cloudflare",
                workerEndpoint = "https://sync.example.workers.dev",
            ),
        )
        val cloudflareWithoutEndpoint = AppSnapshot(sync = SyncConfig(mode = "cloudflare"))

        val missingSyncPassword = manualCloudSyncBlocker(
            snapshot = cloudflareSnapshot,
            isChatStreaming = false,
            hasSyncPassphrase = false,
            hasGithubToken = true,
            hasCloudflareAccessKey = true,
        )
        val missingGithubToken = manualCloudSyncBlocker(
            snapshot = gistSnapshot,
            isChatStreaming = false,
            hasSyncPassphrase = true,
            hasGithubToken = false,
            hasCloudflareAccessKey = true,
        )
        val missingCloudflareEndpoint = manualCloudSyncBlocker(
            snapshot = cloudflareWithoutEndpoint,
            isChatStreaming = false,
            hasSyncPassphrase = true,
            hasGithubToken = true,
            hasCloudflareAccessKey = true,
        )
        val missingCloudflareAccessKey = manualCloudSyncBlocker(
            snapshot = cloudflareSnapshot,
            isChatStreaming = false,
            hasSyncPassphrase = true,
            hasGithubToken = true,
            hasCloudflareAccessKey = false,
        )
        val ready = manualCloudSyncBlocker(
            snapshot = cloudflareSnapshot,
            isChatStreaming = false,
            hasSyncPassphrase = true,
            hasGithubToken = true,
            hasCloudflareAccessKey = true,
        )

        assertEquals(ManualCloudSyncBlocker.SyncPasswordRequired, missingSyncPassword)
        assertEquals(ManualCloudSyncBlocker.GithubTokenRequired, missingGithubToken)
        assertEquals(ManualCloudSyncBlocker.CloudflareWorkerRequired, missingCloudflareEndpoint)
        assertEquals(ManualCloudSyncBlocker.CloudflareAccessKeyRequired, missingCloudflareAccessKey)
        assertNull(ready)
    }

    @Test
    fun canSubmitComposerRequiresReadyChatProviderAndModel() {
        val provider = provider("openai", model = "gpt-4o")

        val ready = canSubmitComposer(
            input = "hello",
            isChatStreaming = false,
            activeProvider = provider,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Chat,
            activeModel = "gpt-4o",
            activeImageModel = "",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )
        val blankInput = canSubmitComposer(
            input = "   ",
            isChatStreaming = false,
            activeProvider = provider,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Chat,
            activeModel = "gpt-4o",
            activeImageModel = "",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )
        val streaming = canSubmitComposer(
            input = "hello",
            isChatStreaming = true,
            activeProvider = provider,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Chat,
            activeModel = "gpt-4o",
            activeImageModel = "",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )
        val missingKey = canSubmitComposer(
            input = "hello",
            isChatStreaming = false,
            activeProvider = provider,
            activeProviderKeyMissing = true,
            composerMode = ComposerMode.Chat,
            activeModel = "gpt-4o",
            activeImageModel = "",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )
        val missingModel = canSubmitComposer(
            input = "hello",
            isChatStreaming = false,
            activeProvider = provider,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Chat,
            activeModel = "",
            activeImageModel = "",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )

        assertEquals(true, ready)
        assertEquals(false, blankInput)
        assertEquals(false, streaming)
        assertEquals(false, missingKey)
        assertEquals(false, missingModel)
    }

    @Test
    fun canSubmitComposerPreservesImageModeReadinessRules() {
        val openAi = provider("openai", model = "gpt-4o", imageModel = "gpt-image-2")
        val anthropic = provider("anthropic", model = "claude-3-5-sonnet").copy(kind = ProviderKind.Anthropic)
        val source = imageUpload("source.png")
        val mask = imageUpload("mask.png")

        val generateReady = canSubmitComposer(
            input = "draw a quiet workspace",
            isChatStreaming = false,
            activeProvider = openAi,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "gpt-4o",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )
        val editNeedsSource = canSubmitComposer(
            input = "make it warmer",
            isChatStreaming = false,
            activeProvider = openAi,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "gpt-4o",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Edit,
            sourceImage = null,
            maskImage = null,
        )
        val editReady = canSubmitComposer(
            input = "make it warmer",
            isChatStreaming = false,
            activeProvider = openAi,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "gpt-4o",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Edit,
            sourceImage = source,
            maskImage = null,
        )
        val inpaintNeedsMask = canSubmitComposer(
            input = "replace the desk",
            isChatStreaming = false,
            activeProvider = openAi,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "gpt-4o",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Inpaint,
            sourceImage = source,
            maskImage = null,
        )
        val inpaintReady = canSubmitComposer(
            input = "replace the desk",
            isChatStreaming = false,
            activeProvider = openAi,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "gpt-4o",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Inpaint,
            sourceImage = source,
            maskImage = mask,
        )
        val anthropicBlocked = canSubmitComposer(
            input = "draw",
            isChatStreaming = false,
            activeProvider = anthropic,
            activeProviderKeyMissing = false,
            composerMode = ComposerMode.Image,
            activeModel = "claude-3-5-sonnet",
            activeImageModel = "gpt-image-2",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        )

        assertEquals(true, generateReady)
        assertEquals(false, editNeedsSource)
        assertEquals(true, editReady)
        assertEquals(false, inpaintNeedsMask)
        assertEquals(true, inpaintReady)
        assertEquals(false, anthropicBlocked)
    }

    @Test
    fun selectedImageModelUsesFetchedListBeforeStaleConfiguredImageModel() {
        val configured = provider(
            "configured",
            model = "gpt-4o",
            models = listOf("gpt-4o", "gpt-image-2"),
            imageModel = "custom-image",
        )
        val fallback = provider(
            "fallback",
            model = "gpt-4o",
            models = listOf("gpt-4o", "gpt-image-2"),
        )
        val noFetchedList = provider(
            "no-fetched-list",
            model = "gpt-4o",
            models = emptyList(),
            imageModel = "custom-image",
        )
        val anthropic = provider(
            "anthropic",
            model = "claude-3-5-sonnet",
            models = listOf("claude-3-5-sonnet"),
        ).copy(kind = ProviderKind.Anthropic)

        assertEquals("gpt-image-2", selectedImageModel(configured))
        assertEquals("gpt-image-2", selectedImageModel(fallback))
        assertEquals("custom-image", selectedImageModel(noFetchedList))
        assertEquals("", selectedImageModel(anthropic))
        assertEquals("", selectedImageModel(null))
    }

    @Test
    fun imageMessageBlockerPreventsLocalMutationUntilImageRequestIsReady() {
        val provider = provider("openai", model = "gpt-4o", imageModel = "gpt-image-2")
        val anthropic = provider("anthropic", model = "claude-3-5-sonnet").copy(kind = ProviderKind.Anthropic)
        val source = imageUpload("source.png")
        val mask = imageUpload("mask.png")

        assertEquals(
            ImageMessageBlocker.ProviderRequired,
            imageMessageBlocker(
                provider = null,
                providerKeyMissing = false,
                imageModel = "",
                prompt = "draw",
                imageTask = ImageTaskMode.Generate,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.ProviderRequired,
            imageMessageBlocker(
                provider = anthropic,
                providerKeyMissing = false,
                imageModel = "gpt-image-2",
                prompt = "draw",
                imageTask = ImageTaskMode.Generate,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.ProviderKeyRequired,
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = true,
                imageModel = "gpt-image-2",
                prompt = "draw",
                imageTask = ImageTaskMode.Generate,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.ImageModelRequired,
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = false,
                imageModel = "",
                prompt = "draw",
                imageTask = ImageTaskMode.Generate,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.PromptRequired,
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = false,
                imageModel = "gpt-image-2",
                prompt = "   ",
                imageTask = ImageTaskMode.Generate,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.SourceImageRequired,
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = false,
                imageModel = "gpt-image-2",
                prompt = "edit",
                imageTask = ImageTaskMode.Edit,
                sourceImage = null,
                maskImage = null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.MaskImageRequired,
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = false,
                imageModel = "gpt-image-2",
                prompt = "inpaint",
                imageTask = ImageTaskMode.Inpaint,
                sourceImage = source,
                maskImage = null,
            ),
        )
        assertNull(
            imageMessageBlocker(
                provider = provider,
                providerKeyMissing = false,
                imageModel = "gpt-image-2",
                prompt = "inpaint",
                imageTask = ImageTaskMode.Inpaint,
                sourceImage = source,
                maskImage = mask,
            ),
        )
    }

    @Test
    fun prepareImageMessageRequestReturnsTypedReadyPlansAfterPreflight() {
        val provider = provider("openai", model = "gpt-4o", imageModel = "gpt-image-2")
        val source = imageUpload("source.png")
        val mask = imageUpload("mask.png")

        val generatePlan = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "  draw a calm workspace  ",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        ) as ImageMessageRequestPlan.Ready
        val editPlan = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "  soften the lighting  ",
            imageTask = ImageTaskMode.Edit,
            sourceImage = source,
            maskImage = null,
        ) as ImageMessageRequestPlan.Ready
        val inpaintPlan = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "  replace the mug  ",
            imageTask = ImageTaskMode.Inpaint,
            sourceImage = source,
            maskImage = mask,
        ) as ImageMessageRequestPlan.Ready
        val generate = generatePlan.request as PreparedImageMessageRequest.Generate
        val edit = editPlan.request as PreparedImageMessageRequest.Edit
        val inpaint = inpaintPlan.request as PreparedImageMessageRequest.Inpaint

        assertSame(provider, generate.provider)
        assertEquals("gpt-image-2", generate.imageModel)
        assertEquals("draw a calm workspace", generate.prompt)
        assertSame(source, edit.sourceImage)
        assertEquals("soften the lighting", edit.prompt)
        assertSame(source, inpaint.sourceImage)
        assertSame(mask, inpaint.maskImage)
        assertEquals("replace the mug", inpaint.prompt)
    }

    @Test
    fun prepareImageMessageRequestReturnsBlockerInsteadOfReadyPlan() {
        val provider = provider("openai", model = "gpt-4o", imageModel = "gpt-image-2")
        val source = imageUpload("source.png")

        val blankPrompt = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "   ",
            imageTask = ImageTaskMode.Generate,
            sourceImage = null,
            maskImage = null,
        ) as ImageMessageRequestPlan.Blocked
        val missingSource = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "edit",
            imageTask = ImageTaskMode.Edit,
            sourceImage = null,
            maskImage = null,
        ) as ImageMessageRequestPlan.Blocked
        val missingMask = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = false,
            imageModel = "gpt-image-2",
            prompt = "inpaint",
            imageTask = ImageTaskMode.Inpaint,
            sourceImage = source,
            maskImage = null,
        ) as ImageMessageRequestPlan.Blocked

        assertEquals(ImageMessageBlocker.PromptRequired, blankPrompt.blocker)
        assertEquals(ImageMessageBlocker.SourceImageRequired, missingSource.blocker)
        assertEquals(ImageMessageBlocker.MaskImageRequired, missingMask.blocker)
    }

    @Test
    fun completeImageMessagePreservesGeneratedAttachmentMetadata() {
        val pending = message("image-pending").copy(
            role = MessageRole.Assistant,
            content = "Generating image...",
            status = "streaming",
        )
        val image = GeneratedImage(
            dataUrl = "data:image/png;base64,abc",
            url = "https://cdn.example.com/image.png",
            mimeType = "image/png",
            revisedPrompt = "A warmer quiet workspace",
        )

        val completed = completeImageMessage(
            pendingMessage = pending,
            image = image,
            prompt = "A quiet workspace",
            imageModel = "gpt-image-2",
            attachmentId = "attachment",
            createdAt = 777,
        )

        val attachment = completed.attachments.single()
        assertEquals("A warmer quiet workspace", completed.content)
        assertEquals("done", completed.status)
        assertNull(completed.error)
        assertEquals("attachment", attachment.id)
        assertEquals("image", attachment.kind)
        assertEquals("generated", attachment.purpose)
        assertEquals("image/png", attachment.mimeType)
        assertEquals("data:image/png;base64,abc", attachment.dataUrl)
        assertEquals("https://cdn.example.com/image.png", attachment.url)
        assertEquals("A quiet workspace", attachment.alt)
        assertEquals("gpt-image-2", attachment.model)
        assertEquals(777, attachment.createdAt)
    }

    @Test
    fun completeImageMessageFallsBackToPromptAndFailureKeepsReadableError() {
        val pending = message("image-pending").copy(
            role = MessageRole.Assistant,
            content = "Generating image...",
            status = "streaming",
        )
        val image = GeneratedImage(
            dataUrl = "data:image/png;base64,abc",
            mimeType = "image/webp",
            revisedPrompt = "   ",
        )

        val completed = completeImageMessage(
            pendingMessage = pending,
            image = image,
            prompt = "Original prompt",
            imageModel = "gpt-image-2",
            attachmentId = "attachment",
            createdAt = 888,
        )
        val failed = failImageMessage(
            pendingMessage = pending,
            failureCopy = "Image request failed",
            errorCopy = "Provider rejected the request",
        )

        assertEquals("Original prompt", completed.content)
        assertEquals("image/webp", completed.attachments.single().mimeType)
        assertEquals("done", completed.status)
        assertEquals("Image request failed", failed.content)
        assertEquals("error", failed.status)
        assertEquals("Provider rejected the request", failed.error)
        assertEquals(emptyList<app.zerochat.data.MessageAttachment>(), failed.attachments)
    }

    @Test
    fun stoppedImageMessageTerminalizesPendingImageWithoutAttachmentOrError() {
        val pending = message("image-pending").copy(
            role = MessageRole.Assistant,
            content = "Generating image...",
            status = "streaming",
            error = "temporary provider warning",
            attachments = listOf(
                app.zerochat.data.MessageAttachment(
                    id = "stale",
                    kind = "image",
                    purpose = "generated",
                    mimeType = "image/png",
                    dataUrl = "data:image/png;base64,stale",
                    alt = "stale",
                    createdAt = 1,
                ),
            ),
        )

        val stopped = stoppedImageMessage(
            pendingMessage = pending,
            stoppedCopy = "Generation stopped",
        )

        assertEquals("Generation stopped", stopped.content)
        assertEquals("done", stopped.status)
        assertNull(stopped.error)
        assertEquals(emptyList<app.zerochat.data.MessageAttachment>(), stopped.attachments)
    }

    @Test
    fun stoppedAssistantMessagePreservesPartialOutputAndClearsError() {
        val pending = message("assistant").copy(
            role = MessageRole.Assistant,
            content = "",
            status = "streaming",
            error = "temporary provider warning",
        )

        val stopped = stoppedAssistantMessage(
            pendingMessage = pending,
            partialContent = "partial answer",
            stoppedCopy = "Generation stopped",
        )

        assertEquals("partial answer", stopped.content)
        assertEquals("done", stopped.status)
        assertNull(stopped.error)
    }

    @Test
    fun stoppedAssistantMessageUsesFallbackWhenPartialOutputIsBlank() {
        val pending = message("assistant").copy(
            role = MessageRole.Assistant,
            content = "",
            status = "streaming",
        )

        val stopped = stoppedAssistantMessage(
            pendingMessage = pending,
            partialContent = "   ",
            stoppedCopy = "Generation stopped",
        )

        assertEquals("Generation stopped", stopped.content)
        assertEquals("done", stopped.status)
        assertNull(stopped.error)
    }

    private fun snapshot(
        activeId: String?,
        conversations: List<String>,
        messages: Map<String, List<ChatMessage>> = emptyMap(),
    ): AppSnapshot =
        snapshotWithConversations(
            activeId,
            *conversations.map { id -> conversation(id, messages[id].orEmpty()) }.toTypedArray(),
        )

    private fun snapshotWithConversations(
        activeId: String?,
        vararg conversations: Conversation,
    ): AppSnapshot =
        AppSnapshot(
            conversations = conversations.toList(),
            preferences = Preferences(activeConversationId = activeId),
        )

    private fun conversation(id: String, messages: List<ChatMessage> = emptyList()): Conversation =
        Conversation(
            id = id,
            title = id,
            providerId = "provider",
            model = "model",
            messages = messages,
            createdAt = 1,
            updatedAt = 1,
        )

    private fun message(id: String): ChatMessage =
        ChatMessage(
            id = id,
            role = MessageRole.User,
            content = id,
            createdAt = 1,
        )

    private fun imageAttachment(id: String): MessageAttachment =
        MessageAttachment(
            id = id,
            kind = "image",
            purpose = "generated",
            mimeType = "image/png",
            createdAt = 1,
        )

    private fun imageUpload(fileName: String): ImageUpload =
        ImageUpload(
            bytes = byteArrayOf(1, 2, 3),
            fileName = fileName,
            mimeType = "image/png",
        )

    private fun provider(
        id: String,
        model: String,
        models: List<String> = listOf(model),
        imageModel: String? = null,
    ): ProviderConfig =
        ProviderConfig(
            id = id,
            name = id,
            kind = ProviderKind.OpenAICompatible,
            baseUrl = "https://api.example.com/v1",
            model = model,
            imageModel = imageModel,
            models = models,
            enabled = true,
            needsApiKey = true,
            createdAt = 1,
            updatedAt = 1,
        )
}
