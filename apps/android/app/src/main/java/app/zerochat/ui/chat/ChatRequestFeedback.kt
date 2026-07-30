package app.zerochat.ui.chat

internal data class ChatRequestBlockerFeedback(
    val messageKey: String,
    val settingsTarget: ChatSetupSettingsTarget? = null,
)

internal fun chatMessageBlockerFeedback(
    blocker: ChatMessageBlocker,
): ChatRequestBlockerFeedback = when (blocker) {
    ChatMessageBlocker.Generating -> ChatRequestBlockerFeedback("message.generating")
    ChatMessageBlocker.ProviderRequired -> ChatRequestBlockerFeedback("message.noEnabledProvider")
    ChatMessageBlocker.ModelRequired -> ChatRequestBlockerFeedback(
        "message.chooseModel",
        ChatSetupSettingsTarget.Models,
    )
    ChatMessageBlocker.ProviderKeyRequired -> ChatRequestBlockerFeedback(
        "error.providerKeyRequired",
        ChatSetupSettingsTarget.Providers,
    )
    ChatMessageBlocker.PromptRequired -> ChatRequestBlockerFeedback("message.emptyInput")
}

internal fun imageMessageBlockerFeedback(
    blocker: ImageMessageBlocker,
): ChatRequestBlockerFeedback = when (blocker) {
    ImageMessageBlocker.ProviderRequired -> ChatRequestBlockerFeedback("message.imageProviderRequired")
    ImageMessageBlocker.ProviderKeyRequired -> ChatRequestBlockerFeedback(
        "error.providerKeyRequired",
        ChatSetupSettingsTarget.Providers,
    )
    ImageMessageBlocker.ImageModelRequired -> ChatRequestBlockerFeedback(
        "message.imageModelRequired",
        ChatSetupSettingsTarget.Models,
    )
    ImageMessageBlocker.PromptRequired -> ChatRequestBlockerFeedback("message.imagePromptRequired")
    ImageMessageBlocker.SourceImageRequired -> ChatRequestBlockerFeedback("message.sourceImageRequired")
    ImageMessageBlocker.MaskImageRequired -> ChatRequestBlockerFeedback("message.maskImageRequired")
}

internal fun messageSpeechBlockerFeedback(
    blocker: MessageSpeechBlocker,
): ChatRequestBlockerFeedback = when (blocker) {
    MessageSpeechBlocker.TextRequired -> ChatRequestBlockerFeedback("notice.audioSpeechEmpty")
    MessageSpeechBlocker.StreamingMessage -> ChatRequestBlockerFeedback("message.generating")
    MessageSpeechBlocker.ProviderRequired -> ChatRequestBlockerFeedback("message.noEnabledProvider")
    MessageSpeechBlocker.SpeechModelRequired -> ChatRequestBlockerFeedback(
        "message.audioSpeechModelRequired",
        ChatSetupSettingsTarget.Models,
    )
    MessageSpeechBlocker.ProviderKeyRequired -> ChatRequestBlockerFeedback(
        "error.providerKeyRequired",
        ChatSetupSettingsTarget.Providers,
    )
}
