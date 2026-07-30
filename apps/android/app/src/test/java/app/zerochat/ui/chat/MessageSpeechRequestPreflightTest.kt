package app.zerochat.ui.chat

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageRole
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.SyncConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class MessageSpeechRequestPreflightTest {
    @Test
    fun prepareMessageSpeechRequestPrioritizesLocalTextAndSetupBlockers() {
        val provider = provider(models = listOf("gpt-5.5", "tts-1"))
        val conversation = conversation(provider.id)

        val emptyText = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = emptyList()),
            conversation = conversation,
            message = message("   "),
            hasProviderKey = { false },
        ) as MessageSpeechRequestPlan.Blocked
        val streaming = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation,
            message = message("partial", status = "streaming"),
            hasProviderKey = { true },
        ) as MessageSpeechRequestPlan.Blocked
        val missingProvider = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = listOf(provider.copy(enabled = false))),
            conversation = conversation,
            message = message("hello"),
            hasProviderKey = { true },
        ) as MessageSpeechRequestPlan.Blocked
        val missingModel = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = listOf(provider(models = listOf("gpt-5.5")))),
            conversation = conversation,
            message = message("hello"),
            hasProviderKey = { true },
        ) as MessageSpeechRequestPlan.Blocked
        val missingKey = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation,
            message = message("hello"),
            hasProviderKey = { false },
        ) as MessageSpeechRequestPlan.Blocked

        assertEquals(MessageSpeechBlocker.TextRequired, emptyText.blocker)
        assertEquals(MessageSpeechBlocker.StreamingMessage, streaming.blocker)
        assertEquals(MessageSpeechBlocker.ProviderRequired, missingProvider.blocker)
        assertEquals(MessageSpeechBlocker.SpeechModelRequired, missingModel.blocker)
        assertEquals(MessageSpeechBlocker.ProviderKeyRequired, missingKey.blocker)
    }

    @Test
    fun prepareMessageSpeechRequestReturnsProviderSpeechModelAndTrimmedInput() {
        val workerEndpoint = "https://sync.example.workers.dev"
        val provider = provider(
            models = listOf("gpt-5.5", "gpt-4o-mini-tts", "tts-1"),
            needsApiKey = false,
        )
        val snapshot = AppSnapshot(
            providers = listOf(provider),
            sync = SyncConfig(mode = "cloudflare", workerEndpoint = workerEndpoint),
        )

        val plan = prepareMessageSpeechRequest(
            snapshot = snapshot,
            conversation = conversation(provider.id),
            message = message("  read this  "),
            hasProviderKey = { false },
        ) as MessageSpeechRequestPlan.Ready

        assertSame(provider, plan.request.provider)
        assertEquals("gpt-4o-mini-tts", plan.request.model)
        assertEquals("read this", plan.request.input)
        assertEquals(workerEndpoint, plan.request.requestProvider.proxyUrl)
    }

    @Test
    fun prepareMessageSpeechRequestTreatsClientRequestModeAsKeyRequired() {
        val provider = provider(
            models = listOf("tts-1"),
            needsApiKey = false,
            clientRequestMode = true,
            proxyUrl = "https://proxy.example.com",
        )

        val blocked = prepareMessageSpeechRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation(provider.id),
            message = message("hello"),
            hasProviderKey = { false },
        ) as MessageSpeechRequestPlan.Blocked

        assertEquals(MessageSpeechBlocker.ProviderKeyRequired, blocked.blocker)
    }

    private fun conversation(providerId: String): Conversation =
        Conversation(
            id = "conversation",
            title = "Conversation",
            providerId = providerId,
            model = "gpt-5.5",
            messages = emptyList(),
            createdAt = 1,
            updatedAt = 1,
        )

    private fun message(
        content: String,
        status: String = "done",
    ): ChatMessage =
        ChatMessage(
            id = "message",
            role = MessageRole.Assistant,
            content = content,
            status = status,
            createdAt = 1,
        )

    private fun provider(
        id: String = "provider",
        models: List<String> = listOf("tts-1"),
        enabled: Boolean = true,
        needsApiKey: Boolean = true,
        clientRequestMode: Boolean = false,
        proxyUrl: String? = null,
    ): ProviderConfig =
        ProviderConfig(
            id = id,
            name = id,
            kind = ProviderKind.OpenAICompatible,
            baseUrl = "https://api.example.com/v1",
            proxyUrl = proxyUrl,
            model = "gpt-5.5",
            models = models,
            enabled = enabled,
            needsApiKey = needsApiKey,
            clientRequestMode = clientRequestMode,
            createdAt = 1,
            updatedAt = 1,
        )
}
