package app.zerochat.ui.chat

import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.ui.ComposerMode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ChatSetupReadinessTest {
    @Test
    fun chatModeGuidesMissingSetupToTheRightSettingsTab() {
        val provider = provider()

        assertEquals(
            "message.configureModelFirst",
            chatSetupHintKey(null, activeProviderKeyMissing = false, activeModel = "gpt-4o"),
        )
        assertEquals(
            "button.addProvider",
            emptyStateSettingsActionKey(
                ComposerMode.Chat,
                null,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Providers,
            emptyStateSettingsTarget(
                ComposerMode.Chat,
                null,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )

        assertEquals(
            "error.providerKeyRequired",
            chatSetupHintKey(provider, activeProviderKeyMissing = true, activeModel = "gpt-4o"),
        )
        assertEquals(
            "action.addProviderKey",
            emptyStateSettingsActionKey(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = true,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Providers,
            emptyStateSettingsTarget(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = true,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )

        assertEquals(
            "message.modelRequired",
            chatSetupHintKey(provider, activeProviderKeyMissing = false, activeModel = ""),
        )
        assertEquals(
            "action.addModel",
            emptyStateSettingsActionKey(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "",
                activeImageModel = "",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Models,
            emptyStateSettingsTarget(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "",
                activeImageModel = "",
            ),
        )
    }

    @Test
    fun readyChatModeKeepsEmptyStateSettingsAsAppearanceFallback() {
        val provider = provider()

        assertNull(chatSetupHintKey(provider, activeProviderKeyMissing = false, activeModel = "gpt-4o"))
        assertNull(
            emptyStateSettingsActionKey(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Appearance,
            emptyStateSettingsTarget(
                ComposerMode.Chat,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
    }

    @Test
    fun imageModeGuidesMissingSetupAndUnsupportedProviders() {
        val provider = provider(imageModel = "gpt-image-1")
        val anthropic = provider(kind = ProviderKind.Anthropic, imageModel = "claude-image")

        assertEquals(
            "button.addProvider",
            emptyStateSettingsActionKey(
                ComposerMode.Image,
                null,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Providers,
            emptyStateSettingsTarget(
                ComposerMode.Image,
                null,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )

        assertEquals(
            "action.addProviderKey",
            emptyStateSettingsActionKey(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = true,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Providers,
            emptyStateSettingsTarget(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = true,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )

        assertEquals(
            "action.chooseProvider",
            emptyStateSettingsActionKey(
                ComposerMode.Image,
                anthropic,
                activeProviderKeyMissing = false,
                activeModel = "claude-3-5-sonnet",
                activeImageModel = "claude-image",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Providers,
            emptyStateSettingsTarget(
                ComposerMode.Image,
                anthropic,
                activeProviderKeyMissing = false,
                activeModel = "claude-3-5-sonnet",
                activeImageModel = "claude-image",
            ),
        )

        assertEquals(
            "action.addModel",
            emptyStateSettingsActionKey(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Models,
            emptyStateSettingsTarget(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "",
            ),
        )
    }

    @Test
    fun readyImageModeKeepsEmptyStateSettingsAsAppearanceFallback() {
        val provider = provider(imageModel = "gpt-image-1")

        assertNull(
            emptyStateSettingsActionKey(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )
        assertEquals(
            ChatSetupSettingsTarget.Appearance,
            emptyStateSettingsTarget(
                ComposerMode.Image,
                provider,
                activeProviderKeyMissing = false,
                activeModel = "gpt-4o",
                activeImageModel = "gpt-image-1",
            ),
        )
    }

    @Test
    fun featureHintsShowOnceAndDismissWithoutDuplicates() {
        assertTrue(shouldShowFeatureHint(emptyList(), ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID))
        assertFalse(shouldShowFeatureHint(listOf(ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID), ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID))

        val dismissed = dismissFeatureHintId(listOf("chat"), ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID)

        assertEquals(listOf("chat", ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID), dismissed)
        assertEquals(dismissed, dismissFeatureHintId(dismissed, ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID))
    }

    private fun provider(
        kind: ProviderKind = ProviderKind.OpenAICompatible,
        imageModel: String? = null,
    ): ProviderConfig =
        ProviderConfig(
            id = "provider",
            name = "Provider",
            kind = kind,
            baseUrl = "https://api.example.com/v1",
            model = "gpt-4o",
            imageModel = imageModel,
            models = listOfNotNull("gpt-4o", imageModel),
            enabled = true,
            needsApiKey = true,
            createdAt = 1,
            updatedAt = 1,
        )
}
