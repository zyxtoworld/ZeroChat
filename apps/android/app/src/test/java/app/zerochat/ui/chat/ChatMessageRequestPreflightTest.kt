package app.zerochat.ui.chat

import app.zerochat.ai.embeddingsEndpointFor
import app.zerochat.data.AppSnapshot
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.SyncConfig
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class ChatMessageRequestPreflightTest {
    @Test
    fun prepareChatMessageRequestPrioritizesSetupBlockersBeforeLocalMutation() {
        val provider = provider()
        val conversation = conversation(provider.id, model = "gpt-4o")

        val generating = prepareChatMessageRequest(
            snapshot = AppSnapshot(),
            conversation = conversation,
            prompt = "hello",
            isChatStreaming = true,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Blocked
        val missingProvider = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = emptyList()),
            conversation = conversation,
            prompt = "hello",
            isChatStreaming = false,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Blocked
        val missingModel = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider.copy(model = "", models = emptyList()))),
            conversation = conversation(provider.id, model = ""),
            prompt = "hello",
            isChatStreaming = false,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Blocked
        val missingKey = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation,
            prompt = "   ",
            isChatStreaming = false,
            hasProviderKey = { false },
        ) as ChatMessageRequestPlan.Blocked
        val blankPrompt = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation,
            prompt = "   ",
            isChatStreaming = false,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Blocked

        assertEquals(ChatMessageBlocker.Generating, generating.blocker)
        assertEquals(ChatMessageBlocker.ProviderRequired, missingProvider.blocker)
        assertEquals(ChatMessageBlocker.ModelRequired, missingModel.blocker)
        assertEquals(ChatMessageBlocker.ProviderKeyRequired, missingKey.blocker)
        assertEquals(ChatMessageBlocker.PromptRequired, blankPrompt.blocker)
    }

    @Test
    fun prepareChatMessageRequestReturnsReadyProviderModelAndTrimmedPrompt() {
        val workerEndpoint = "https://sync.example.workers.dev"
        val provider = provider(
            model = "",
            models = listOf("gpt-image-2", "gpt-4o-mini", "gpt-5.5"),
            needsApiKey = false,
        )
        val snapshot = AppSnapshot(
            providers = listOf(provider),
            sync = SyncConfig(mode = "cloudflare", workerEndpoint = workerEndpoint),
        )
        val plan = prepareChatMessageRequest(
            snapshot = snapshot,
            conversation = conversation(provider.id, model = ""),
            prompt = "  hello from android  ",
            isChatStreaming = false,
            hasProviderKey = { false },
        ) as ChatMessageRequestPlan.Ready

        assertSame(provider, plan.request.provider)
        assertEquals("gpt-5.5", plan.request.model)
        assertEquals("hello from android", plan.request.prompt)
        assertEquals(workerEndpoint, plan.request.requestProvider.proxyUrl)
    }

    @Test
    fun prepareChatMessageRequestRepairsStaleConversationModelFromFetchedList() {
        val provider = provider(
            model = "gpt-4.1-mini",
            models = listOf("gpt-5.5-openai-compact", "gpt-5.5", "gpt-image-2"),
        )
        val plan = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation(provider.id, model = "gpt-4o-mini"),
            prompt = "hello",
            isChatStreaming = false,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Ready

        assertEquals("gpt-5.5", plan.request.model)
    }

    @Test
    fun prepareChatMessageRequestTreatsClientRequestModeAsKeyRequired() {
        val provider = provider(
            clientRequestMode = true,
            needsApiKey = false,
            proxyUrl = "https://proxy.example.com",
        )
        val blocked = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation(provider.id, model = "gpt-4o"),
            prompt = "hello",
            isChatStreaming = false,
            hasProviderKey = { false },
        ) as ChatMessageRequestPlan.Blocked

        assertEquals(ChatMessageBlocker.ProviderKeyRequired, blocked.blocker)
    }

    @Test
    fun prepareChatMessageRequestIgnoresDisabledConversationProvider() {
        val provider = provider(enabled = false)
        val blocked = prepareChatMessageRequest(
            snapshot = AppSnapshot(providers = listOf(provider)),
            conversation = conversation(provider.id, model = "gpt-4o"),
            prompt = "hello",
            isChatStreaming = false,
            hasProviderKey = { true },
        ) as ChatMessageRequestPlan.Blocked

        assertEquals(ChatMessageBlocker.ProviderRequired, blocked.blocker)
    }

    @Test
    fun providerProxyTokenForRequestSkipsDirectProviders() {
        var accessKeyCalls = 0

        val token = providerProxyTokenForRequest(provider()) {
            accessKeyCalls += 1
            "proxy-token"
        }

        assertEquals("", token)
        assertEquals(0, accessKeyCalls)
    }

    @Test
    fun providerProxyTokenForRequestDerivesOnlyForRequestProxy() {
        var accessKeyCalls = 0

        val token = providerProxyTokenForRequest(provider(proxyUrl = "https://proxy.example.com")) {
            accessKeyCalls += 1
            "proxy-token"
        }

        assertEquals("proxy-token", token)
        assertEquals(1, accessKeyCalls)
    }

    @Test
    fun providerProxyTokenForRequestSkipsClientModeProxyAfterNormalization() {
        val requestProvider = providerRequest(
            provider(clientRequestMode = true, proxyUrl = "https://proxy.example.com"),
            AppSnapshot(),
        )
        var accessKeyCalls = 0

        val token = providerProxyTokenForRequest(requestProvider) {
            accessKeyCalls += 1
            "proxy-token"
        }

        assertEquals("", token)
        assertEquals(0, accessKeyCalls)
    }

    @Test
    fun providerRequestUsesDirectCapabilityEndpointsForClientMode() {
        val requestProvider = providerRequest(
            provider(clientRequestMode = true, proxyUrl = "https://proxy.example.com"),
            AppSnapshot(),
        )

        assertEquals(null, requestProvider.proxyUrl)
        assertEquals("https://api.example.com/v1/embeddings", embeddingsEndpointFor(requestProvider))
    }

    @Test
    fun providerProxyTokenForRequestDerivesForCloudflareWorkerFallback() {
        val workerEndpoint = "https://sync.example.workers.dev"
        val requestProvider = providerRequest(
            provider(needsApiKey = false),
            AppSnapshot(sync = SyncConfig(mode = "cloudflare", workerEndpoint = workerEndpoint)),
        )
        var accessKeyCalls = 0

        val token = providerProxyTokenForRequest(requestProvider) {
            accessKeyCalls += 1
            "worker-token"
        }

        assertEquals(workerEndpoint, requestProvider.proxyUrl)
        assertEquals("worker-token", token)
        assertEquals(1, accessKeyCalls)
    }

    private fun conversation(providerId: String, model: String): Conversation =
        Conversation(
            id = "conversation",
            title = "Conversation",
            providerId = providerId,
            model = model,
            messages = emptyList(),
            createdAt = 1,
            updatedAt = 1,
        )

    private fun provider(
        id: String = "provider",
        model: String = "gpt-4o",
        models: List<String> = listOf(model),
        kind: ProviderKind = ProviderKind.OpenAICompatible,
        enabled: Boolean = true,
        needsApiKey: Boolean = true,
        clientRequestMode: Boolean = false,
        proxyUrl: String? = null,
    ): ProviderConfig =
        ProviderConfig(
            id = id,
            name = id,
            kind = kind,
            baseUrl = "https://api.example.com/v1",
            proxyUrl = proxyUrl,
            model = model,
            models = models,
            enabled = enabled,
            needsApiKey = needsApiKey,
            clientRequestMode = clientRequestMode,
            createdAt = 1,
            updatedAt = 1,
        )
}
