package app.zerochat.ui.chat

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.ComposerMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ProviderModelSelectorTest {
    @Test
    fun providerModelBottomSheetUsesChatModelsInChatMode() {
        val provider = provider()

        assertEquals(
            listOf("gpt-5.4-mini", "gpt-5.4"),
            providerModelSheetModels(
                provider = provider,
                mode = ComposerMode.Chat,
                chatModelsForProvider = { listOf("gpt-5.4-mini", "gpt-5.4") },
                imageModelsForProvider = { listOf("gpt-image-2") },
            ),
        )
    }

    @Test
    fun providerModelBottomSheetUsesImageModelsInImageMode() {
        val provider = provider()

        assertEquals(
            listOf("gpt-image-2", "gpt-image-2-pro"),
            providerModelSheetModels(
                provider = provider,
                mode = ComposerMode.Image,
                chatModelsForProvider = { listOf("gpt-5.4-mini") },
                imageModelsForProvider = { listOf("gpt-image-2", "gpt-image-2-pro") },
            ),
        )
    }

    @Test
    fun providerModelBottomSheetEmptyCopyMatchesMode() {
        assertEquals("message.noModels", providerModelSheetEmptyMessageKey(ComposerMode.Chat))
        assertEquals("message.imageModelRequired", providerModelSheetEmptyMessageKey(ComposerMode.Image))
    }

    private fun provider(): ProviderConfig = ProviderConfig(
        id = "openai",
        name = "OpenAI",
        kind = ProviderKind.OpenAIResponses,
        baseUrl = "https://api.openai.com/v1",
        model = "gpt-5.4-mini",
        imageModel = "gpt-image-2",
        models = listOf("gpt-5.4-mini", "gpt-image-2"),
        capabilities = listOf("chat", "image-generation"),
        enabled = true,
        needsApiKey = true,
        createdAt = 1L,
        updatedAt = 1L,
    )
}
