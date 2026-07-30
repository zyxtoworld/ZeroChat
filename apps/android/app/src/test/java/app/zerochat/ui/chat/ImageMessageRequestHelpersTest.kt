package app.zerochat.ui.chat

import app.zerochat.ai.ImageUpload
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.ImageTaskMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

class ImageMessageRequestHelpersTest {
    @Test
    fun selectedImageModelUsesFetchedListBeforeStaleConfiguredImageModel() {
        val configured = provider(
            model = "gpt-4o",
            models = listOf("gpt-4o", "gpt-image-1"),
            imageModel = "gpt-image-2",
        )
        val fallback = provider(
            model = "gpt-4o",
            models = listOf("gpt-4o", "gpt-image-1"),
        )
        val noFetchedList = provider(
            model = "gpt-4o",
            models = emptyList(),
            imageModel = "gpt-image-2",
        )

        assertEquals("gpt-image-1", selectedImageModel(configured))
        assertEquals("gpt-image-1", selectedImageModel(fallback))
        assertEquals("gpt-image-2", selectedImageModel(noFetchedList))
        assertEquals("", selectedImageModel(null))
    }

    @Test
    fun selectedImageModelUsesCompatibleCandidatesForEditingTasks() {
        val configured = provider(
            model = "gpt-4o",
            models = listOf("gpt-4o", "dall-e-3", "gpt-image-1"),
            imageModel = "dall-e-3",
        )
        val generationOnly = provider(
            model = "gpt-4o",
            models = listOf("gpt-4o", "dall-e-3"),
            imageModel = "dall-e-3",
        )

        assertEquals("dall-e-3", selectedImageModel(configured))
        assertEquals("gpt-image-1", selectedImageModel(configured, ImageTaskMode.Edit))
        assertEquals("gpt-image-1", selectedImageModel(configured, ImageTaskMode.Inpaint))
        assertEquals("", selectedImageModel(generationOnly, ImageTaskMode.Edit))
    }

    @Test
    fun imageMessageBlockerPrioritizesSetupBeforeLocalMutation() {
        val provider = provider()

        assertEquals(
            ImageMessageBlocker.ProviderRequired,
            imageMessageBlocker(null, false, "gpt-image-1", "prompt", ImageTaskMode.Generate, null, null),
        )
        assertEquals(
            ImageMessageBlocker.ProviderRequired,
            imageMessageBlocker(
                provider(kind = ProviderKind.Anthropic),
                false,
                "gpt-image-1",
                "prompt",
                ImageTaskMode.Generate,
                null,
                null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.ProviderKeyRequired,
            imageMessageBlocker(provider, true, "gpt-image-1", "prompt", ImageTaskMode.Generate, null, null),
        )
        assertEquals(
            ImageMessageBlocker.ImageModelRequired,
            imageMessageBlocker(provider, false, "", "prompt", ImageTaskMode.Generate, null, null),
        )
        assertEquals(
            ImageMessageBlocker.PromptRequired,
            imageMessageBlocker(provider, false, "gpt-image-1", " ", ImageTaskMode.Generate, null, null),
        )
        assertEquals(
            ImageMessageBlocker.SourceImageRequired,
            imageMessageBlocker(provider, false, "gpt-image-1", "prompt", ImageTaskMode.Edit, null, null),
        )
        assertEquals(
            ImageMessageBlocker.ImageModelRequired,
            imageMessageBlocker(
                provider,
                false,
                "dall-e-3",
                "prompt",
                ImageTaskMode.Edit,
                imageUpload("source.png"),
                null,
            ),
        )
        assertEquals(
            ImageMessageBlocker.MaskImageRequired,
            imageMessageBlocker(
                provider,
                false,
                "gpt-image-1",
                "prompt",
                ImageTaskMode.Inpaint,
                imageUpload("source.png"),
                null,
            ),
        )
    }

    @Test
    fun prepareImageMessageRequestReturnsTypedGenerateEditAndInpaintPlans() {
        val provider = provider()
        val source = imageUpload("source.png")
        val mask = imageUpload("mask.png")

        val generate = prepareImageMessageRequest(
            provider,
            false,
            "gpt-image-1",
            "  draw a quiet workspace  ",
            ImageTaskMode.Generate,
            null,
            null,
        )
        val generateReady = generate as ImageMessageRequestPlan.Ready
        val generateRequest = generateReady.request as PreparedImageMessageRequest.Generate
        assertEquals("draw a quiet workspace", generateRequest.prompt)
        assertSame(provider, generateRequest.provider)

        val edit = prepareImageMessageRequest(
            provider,
            false,
            "gpt-image-1",
            "improve lighting",
            ImageTaskMode.Edit,
            source,
            null,
        )
        val editReady = edit as ImageMessageRequestPlan.Ready
        val editRequest = editReady.request as PreparedImageMessageRequest.Edit
        assertSame(source, editRequest.sourceImage)

        val inpaint = prepareImageMessageRequest(
            provider,
            false,
            "gpt-image-1",
            "replace the poster",
            ImageTaskMode.Inpaint,
            source,
            mask,
        )
        val inpaintReady = inpaint as ImageMessageRequestPlan.Ready
        val inpaintRequest = inpaintReady.request as PreparedImageMessageRequest.Inpaint
        assertSame(source, inpaintRequest.sourceImage)
        assertSame(mask, inpaintRequest.maskImage)
    }

    @Test
    fun prepareImageMessageRequestReturnsBlockerInsteadOfReadyPlan() {
        val blocked = prepareImageMessageRequest(
            provider(),
            false,
            "gpt-image-1",
            "prompt",
            ImageTaskMode.Inpaint,
            null,
            imageUpload("mask.png"),
        )

        val blockedPlan = blocked as ImageMessageRequestPlan.Blocked
        assertEquals(ImageMessageBlocker.SourceImageRequired, blockedPlan.blocker)
    }

    private fun imageUpload(fileName: String): ImageUpload =
        ImageUpload(
            bytes = byteArrayOf(1, 2, 3),
            fileName = fileName,
            mimeType = "image/png",
        )

    private fun provider(
        id: String = "provider",
        kind: ProviderKind = ProviderKind.OpenAICompatible,
        model: String = "gpt-4o",
        models: List<String> = listOf(model, "gpt-image-1"),
        imageModel: String? = null,
    ): ProviderConfig =
        ProviderConfig(
            id = id,
            name = id,
            kind = kind,
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
