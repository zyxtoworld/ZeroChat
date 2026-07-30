package app.zerochat.ui.chat

import app.zerochat.ai.ImageUpload
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.ProviderModelCapability
import app.zerochat.data.isLikelyImageEditingModel
import app.zerochat.data.modelForProviderCapability
import app.zerochat.ui.ImageTaskMode

enum class ImageMessageBlocker {
    ProviderRequired,
    ProviderKeyRequired,
    ImageModelRequired,
    PromptRequired,
    SourceImageRequired,
    MaskImageRequired,
}

sealed class PreparedImageMessageRequest {
    abstract val provider: ProviderConfig
    abstract val imageModel: String
    abstract val responsesModel: String
    abstract val prompt: String

    data class Generate(
        override val provider: ProviderConfig,
        override val imageModel: String,
        override val responsesModel: String = "",
        override val prompt: String,
    ) : PreparedImageMessageRequest()

    data class Edit(
        override val provider: ProviderConfig,
        override val imageModel: String,
        override val responsesModel: String = "",
        override val prompt: String,
        val sourceImage: ImageUpload,
    ) : PreparedImageMessageRequest()

    data class Inpaint(
        override val provider: ProviderConfig,
        override val imageModel: String,
        override val responsesModel: String = "",
        override val prompt: String,
        val sourceImage: ImageUpload,
        val maskImage: ImageUpload,
    ) : PreparedImageMessageRequest()
}

sealed class ImageMessageRequestPlan {
    data class Ready(val request: PreparedImageMessageRequest) : ImageMessageRequestPlan()
    data class Blocked(val blocker: ImageMessageBlocker) : ImageMessageRequestPlan()
}

fun selectedImageModel(
    provider: ProviderConfig?,
    imageTask: ImageTaskMode = ImageTaskMode.Generate,
): String =
    modelForProviderCapability(
        provider,
        if (imageTask == ImageTaskMode.Generate) {
            ProviderModelCapability.ImageGeneration
        } else {
            ProviderModelCapability.ImageEditing
        },
    )

fun imageMessageBlocker(
    provider: ProviderConfig?,
    providerKeyMissing: Boolean,
    imageModel: String,
    prompt: String,
    imageTask: ImageTaskMode,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    responsesModel: String = "",
): ImageMessageBlocker? = when {
    provider == null || provider.kind == ProviderKind.Anthropic -> ImageMessageBlocker.ProviderRequired
    providerKeyMissing -> ImageMessageBlocker.ProviderKeyRequired
    imageModel.isBlank() -> ImageMessageBlocker.ImageModelRequired
    imageTask != ImageTaskMode.Generate && !isLikelyImageEditingModel(imageModel) ->
        ImageMessageBlocker.ImageModelRequired
    prompt.isBlank() -> ImageMessageBlocker.PromptRequired
    imageTask != ImageTaskMode.Generate && sourceImage == null -> ImageMessageBlocker.SourceImageRequired
    imageTask == ImageTaskMode.Inpaint && maskImage == null -> ImageMessageBlocker.MaskImageRequired
    else -> null
}

fun prepareImageMessageRequest(
    provider: ProviderConfig?,
    providerKeyMissing: Boolean,
    imageModel: String,
    prompt: String,
    imageTask: ImageTaskMode,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    responsesModel: String = "",
): ImageMessageRequestPlan {
    val blocker = imageMessageBlocker(
        provider = provider,
        providerKeyMissing = providerKeyMissing,
        imageModel = imageModel,
        responsesModel = responsesModel,
        prompt = prompt,
        imageTask = imageTask,
        sourceImage = sourceImage,
        maskImage = maskImage,
    )
    if (blocker != null) {
        return ImageMessageRequestPlan.Blocked(blocker)
    }

    val readyProvider = provider ?: return ImageMessageRequestPlan.Blocked(ImageMessageBlocker.ProviderRequired)
    val trimmedPrompt = prompt.trim()

    return when (imageTask) {
        ImageTaskMode.Generate -> ImageMessageRequestPlan.Ready(
            PreparedImageMessageRequest.Generate(
                provider = readyProvider,
                imageModel = imageModel,
                responsesModel = responsesModel,
                prompt = trimmedPrompt,
            ),
        )
        ImageTaskMode.Edit -> {
            val readySource = sourceImage
                ?: return ImageMessageRequestPlan.Blocked(ImageMessageBlocker.SourceImageRequired)
            ImageMessageRequestPlan.Ready(
                PreparedImageMessageRequest.Edit(
                    provider = readyProvider,
                    imageModel = imageModel,
                    responsesModel = responsesModel,
                    prompt = trimmedPrompt,
                    sourceImage = readySource,
                ),
            )
        }
        ImageTaskMode.Inpaint -> {
            val readySource = sourceImage
                ?: return ImageMessageRequestPlan.Blocked(ImageMessageBlocker.SourceImageRequired)
            val readyMask = maskImage
                ?: return ImageMessageRequestPlan.Blocked(ImageMessageBlocker.MaskImageRequired)
            ImageMessageRequestPlan.Ready(
                PreparedImageMessageRequest.Inpaint(
                    provider = readyProvider,
                    imageModel = imageModel,
                    responsesModel = responsesModel,
                    prompt = trimmedPrompt,
                    sourceImage = readySource,
                    maskImage = readyMask,
                ),
            )
        }
    }
}
