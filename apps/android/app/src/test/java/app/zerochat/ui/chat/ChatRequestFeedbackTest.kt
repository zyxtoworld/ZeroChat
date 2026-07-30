package app.zerochat.ui.chat

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class ChatRequestFeedbackTest {
    @Test
    fun chatMessageBlockerFeedbackKeepsMainNoticeWarningsForLocalBlockers() {
        assertMainNotice("message.generating", chatMessageBlockerFeedback(ChatMessageBlocker.Generating))
        assertMainNotice(
            "message.noEnabledProvider",
            chatMessageBlockerFeedback(ChatMessageBlocker.ProviderRequired),
        )
        assertMainNotice("message.emptyInput", chatMessageBlockerFeedback(ChatMessageBlocker.PromptRequired))
    }

    @Test
    fun chatMessageBlockerFeedbackRoutesSetupBlockersToSettings() {
        assertSettings(
            "message.chooseModel",
            ChatSetupSettingsTarget.Models,
            chatMessageBlockerFeedback(ChatMessageBlocker.ModelRequired),
        )
        assertSettings(
            "error.providerKeyRequired",
            ChatSetupSettingsTarget.Providers,
            chatMessageBlockerFeedback(ChatMessageBlocker.ProviderKeyRequired),
        )
    }

    @Test
    fun imageMessageBlockerFeedbackKeepsMainNoticeWarningsForLocalBlockers() {
        assertMainNotice(
            "message.imageProviderRequired",
            imageMessageBlockerFeedback(ImageMessageBlocker.ProviderRequired),
        )
        assertMainNotice(
            "message.imagePromptRequired",
            imageMessageBlockerFeedback(ImageMessageBlocker.PromptRequired),
        )
        assertMainNotice(
            "message.sourceImageRequired",
            imageMessageBlockerFeedback(ImageMessageBlocker.SourceImageRequired),
        )
        assertMainNotice(
            "message.maskImageRequired",
            imageMessageBlockerFeedback(ImageMessageBlocker.MaskImageRequired),
        )
    }

    @Test
    fun imageMessageBlockerFeedbackRoutesSetupBlockersToSettings() {
        assertSettings(
            "error.providerKeyRequired",
            ChatSetupSettingsTarget.Providers,
            imageMessageBlockerFeedback(ImageMessageBlocker.ProviderKeyRequired),
        )
        assertSettings(
            "message.imageModelRequired",
            ChatSetupSettingsTarget.Models,
            imageMessageBlockerFeedback(ImageMessageBlocker.ImageModelRequired),
        )
    }

    @Test
    fun messageSpeechBlockerFeedbackKeepsMainNoticeWarningsForLocalBlockers() {
        assertMainNotice(
            "notice.audioSpeechEmpty",
            messageSpeechBlockerFeedback(MessageSpeechBlocker.TextRequired),
        )
        assertMainNotice(
            "message.generating",
            messageSpeechBlockerFeedback(MessageSpeechBlocker.StreamingMessage),
        )
        assertMainNotice(
            "message.noEnabledProvider",
            messageSpeechBlockerFeedback(MessageSpeechBlocker.ProviderRequired),
        )
    }

    @Test
    fun messageSpeechBlockerFeedbackRoutesSetupBlockersToSettings() {
        assertSettings(
            "message.audioSpeechModelRequired",
            ChatSetupSettingsTarget.Models,
            messageSpeechBlockerFeedback(MessageSpeechBlocker.SpeechModelRequired),
        )
        assertSettings(
            "error.providerKeyRequired",
            ChatSetupSettingsTarget.Providers,
            messageSpeechBlockerFeedback(MessageSpeechBlocker.ProviderKeyRequired),
        )
    }

    private fun assertMainNotice(
        expectedMessageKey: String,
        feedback: ChatRequestBlockerFeedback,
    ) {
        assertEquals(expectedMessageKey, feedback.messageKey)
        assertNull(feedback.settingsTarget)
    }

    private fun assertSettings(
        expectedMessageKey: String,
        expectedTarget: ChatSetupSettingsTarget,
        feedback: ChatRequestBlockerFeedback,
    ) {
        assertEquals(expectedMessageKey, feedback.messageKey)
        assertEquals(expectedTarget, feedback.settingsTarget)
    }
}
