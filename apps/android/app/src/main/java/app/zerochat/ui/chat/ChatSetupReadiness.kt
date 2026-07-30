package app.zerochat.ui.chat

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.ComposerMode

enum class ChatSetupSettingsTarget {
    Providers,
    Models,
    Appearance,
}

const val ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID = "provider-model"

fun shouldShowFeatureHint(
    dismissedFeatureHints: List<String>,
    id: String,
): Boolean = id !in dismissedFeatureHints

fun dismissFeatureHintId(
    dismissedFeatureHints: List<String>,
    id: String,
): List<String> =
    if (id in dismissedFeatureHints) {
        dismissedFeatureHints
    } else {
        dismissedFeatureHints + id
    }

fun chatSetupHintKey(
    activeProvider: ProviderConfig?,
    activeProviderKeyMissing: Boolean,
    activeModel: String,
): String? = when {
    activeProvider == null -> "message.configureModelFirst"
    activeProviderKeyMissing -> "error.providerKeyRequired"
    activeModel.isBlank() -> "message.modelRequired"
    else -> null
}

fun emptyStateSettingsActionKey(
    composerMode: ComposerMode,
    activeProvider: ProviderConfig?,
    activeProviderKeyMissing: Boolean,
    activeModel: String,
    activeImageModel: String,
): String? = when (composerMode) {
    ComposerMode.Chat -> when {
        activeProvider == null -> "button.addProvider"
        activeProviderKeyMissing -> "action.addProviderKey"
        activeModel.isBlank() -> "action.addModel"
        else -> null
    }
    ComposerMode.Image -> when {
        activeProvider == null -> "button.addProvider"
        activeProviderKeyMissing -> "action.addProviderKey"
        activeProvider.kind == ProviderKind.Anthropic -> "action.chooseProvider"
        activeImageModel.isBlank() -> "action.addModel"
        else -> null
    }
}

fun emptyStateSettingsTarget(
    composerMode: ComposerMode,
    activeProvider: ProviderConfig?,
    activeProviderKeyMissing: Boolean,
    activeModel: String,
    activeImageModel: String,
): ChatSetupSettingsTarget = when (composerMode) {
    ComposerMode.Chat -> when {
        activeProvider == null || activeProviderKeyMissing -> ChatSetupSettingsTarget.Providers
        activeModel.isBlank() -> ChatSetupSettingsTarget.Models
        else -> ChatSetupSettingsTarget.Appearance
    }
    ComposerMode.Image -> when {
        activeProvider == null ||
            activeProviderKeyMissing ||
            activeProvider.kind == ProviderKind.Anthropic -> ChatSetupSettingsTarget.Providers
        activeImageModel.isBlank() -> ChatSetupSettingsTarget.Models
        else -> ChatSetupSettingsTarget.Appearance
    }
}
