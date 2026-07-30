package app.zerochat.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.unit.dp
import app.zerochat.ai.ImageUpload
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.ProviderConfig
import app.zerochat.ui.ComposerMode
import app.zerochat.ui.ImageTaskMode
import app.zerochat.ui.NativeI18n

@Composable
internal fun ChatConversationPane(
    snapshot: AppSnapshot,
    conversationSearch: String,
    onConversationSearchChange: (String) -> Unit,
    onClearConversationSearch: () -> Unit,
    filteredConversations: List<Conversation>,
    conversationSearchActive: Boolean,
    activeConversation: Conversation?,
    enabledProviders: List<ProviderConfig>,
    activeProvider: ProviderConfig?,
    activeModel: String,
    activeImageModel: String,
    activeProviderKeyMissing: Boolean,
    composerMode: ComposerMode,
    onComposerModeChange: (ComposerMode) -> Unit,
    imageTask: ImageTaskMode,
    onImageTaskChange: (ImageTaskMode) -> Unit,
    chatSetupHint: String?,
    emptyStateSettingsActionLabel: String?,
    showProviderModelFeatureHint: Boolean,
    persistentNotice: InlineNotice?,
    mainNotice: InlineNotice?,
    manualSyncRefreshing: Boolean,
    manualSyncBlockedReason: String?,
    input: String,
    onInputChange: (String) -> Unit,
    focusRequester: FocusRequester,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    editing: Boolean,
    streaming: Boolean,
    canSend: Boolean,
    onProviderModelSelected: (ProviderConfig, String) -> Unit,
    onDismissProviderModelFeatureHint: () -> Unit,
    providerDisplayName: (ProviderConfig) -> String,
    chatModelsForProvider: (ProviderConfig) -> List<String>,
    imageModelsForProvider: (ProviderConfig) -> List<String>,
    onSelectConversation: (String) -> Unit,
    onDeleteConversation: (Conversation) -> Unit,
    onManualSync: () -> Unit,
    onOpenSyncSettings: () -> Unit,
    onEditMessage: (ChatMessage) -> Unit,
    onRegenerateMessage: (ChatMessage) -> Unit,
    onDeleteMessage: (ChatMessage) -> Unit,
    speakingMessageId: String?,
    onSpeakMessage: (ChatMessage) -> Unit,
    onStopSpeaking: () -> Unit,
    onOpenEmptyStateSettings: () -> Unit,
    onPickSource: () -> Unit,
    onClearSource: () -> Unit,
    onPickMask: () -> Unit,
    onClearMask: () -> Unit,
    onCancelEdit: () -> Unit,
    onStopGenerating: () -> Unit,
    onSend: () -> Unit,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier) {
        val layoutMode = androidChatLayoutMode(maxWidth.value.toInt())
        val compactHomeSyncStrip = maxHeight < 720.dp
        val compactImageMode = compactHomeSyncStrip && composerMode == ComposerMode.Image
        val showHomeSyncStrip = !compactImageMode
        val showProviderHint = showProviderModelFeatureHint && !compactImageMode

        when (layoutMode) {
            AndroidChatLayoutMode.Compact -> {
                Column(modifier = Modifier.fillMaxSize()) {
                    CompactConversationBar(
                        conversationSearch = conversationSearch,
                        onConversationSearchChange = onConversationSearchChange,
                        onClearConversationSearch = onClearConversationSearch,
                        filteredConversations = filteredConversations,
                        conversationSearchActive = conversationSearchActive,
                        activeConversation = activeConversation,
                        onSelectConversation = onSelectConversation,
                        onDeleteConversation = onDeleteConversation,
                        i18n = i18n,
                        composerFocusMode = compactImageMode,
                    )
                    ChatMainColumn(
                        snapshot = snapshot,
                        activeConversation = activeConversation,
                        enabledProviders = enabledProviders,
                        activeProvider = activeProvider,
                        activeModel = activeModel,
                        activeImageModel = activeImageModel,
                        activeProviderKeyMissing = activeProviderKeyMissing,
                        composerMode = composerMode,
                        onComposerModeChange = onComposerModeChange,
                        imageTask = imageTask,
                        onImageTaskChange = onImageTaskChange,
                        chatSetupHint = chatSetupHint,
                        emptyStateSettingsActionLabel = emptyStateSettingsActionLabel,
                        showProviderHint = showProviderHint,
                        showHomeSyncStrip = showHomeSyncStrip,
                        compactHomeSyncStrip = compactHomeSyncStrip,
                        persistentNotice = persistentNotice,
                        mainNotice = mainNotice,
                        manualSyncRefreshing = manualSyncRefreshing,
                        manualSyncBlockedReason = manualSyncBlockedReason,
                        input = input,
                        onInputChange = onInputChange,
                        focusRequester = focusRequester,
                        sourceImage = sourceImage,
                        maskImage = maskImage,
                        editing = editing,
                        streaming = streaming,
                        canSend = canSend,
                        onProviderModelSelected = onProviderModelSelected,
                        onDismissProviderModelFeatureHint = onDismissProviderModelFeatureHint,
                        providerDisplayName = providerDisplayName,
                        chatModelsForProvider = chatModelsForProvider,
                        imageModelsForProvider = imageModelsForProvider,
                        onManualSync = onManualSync,
                        onOpenSyncSettings = onOpenSyncSettings,
                        onEditMessage = onEditMessage,
                        onRegenerateMessage = onRegenerateMessage,
                        onDeleteMessage = onDeleteMessage,
                        speakingMessageId = speakingMessageId,
                        onSpeakMessage = onSpeakMessage,
                        onStopSpeaking = onStopSpeaking,
                        onOpenEmptyStateSettings = onOpenEmptyStateSettings,
                        onPickSource = onPickSource,
                        onClearSource = onClearSource,
                        onPickMask = onPickMask,
                        onClearMask = onClearMask,
                        onCancelEdit = onCancelEdit,
                        onStopGenerating = onStopGenerating,
                        onSend = onSend,
                        i18n = i18n,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                    )
                }
            }

            AndroidChatLayoutMode.AdaptiveTwoPane -> {
                Row(modifier = Modifier.fillMaxSize()) {
                    ConversationSidebar(
                        conversationSearch = conversationSearch,
                        onConversationSearchChange = onConversationSearchChange,
                        onClearConversationSearch = onClearConversationSearch,
                        filteredConversations = filteredConversations,
                        conversationSearchActive = conversationSearchActive,
                        activeConversation = activeConversation,
                        onSelectConversation = onSelectConversation,
                        onDeleteConversation = onDeleteConversation,
                        i18n = i18n,
                        modifier = Modifier.width(ANDROID_CHAT_SIDEBAR_WIDTH_DP.dp),
                    )
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(1.dp)
                            .background(MaterialTheme.colorScheme.outlineVariant),
                    )
                    ChatMainColumn(
                        snapshot = snapshot,
                        activeConversation = activeConversation,
                        enabledProviders = enabledProviders,
                        activeProvider = activeProvider,
                        activeModel = activeModel,
                        activeImageModel = activeImageModel,
                        activeProviderKeyMissing = activeProviderKeyMissing,
                        composerMode = composerMode,
                        onComposerModeChange = onComposerModeChange,
                        imageTask = imageTask,
                        onImageTaskChange = onImageTaskChange,
                        chatSetupHint = chatSetupHint,
                        emptyStateSettingsActionLabel = emptyStateSettingsActionLabel,
                        showProviderHint = showProviderHint,
                        showHomeSyncStrip = showHomeSyncStrip,
                        compactHomeSyncStrip = compactHomeSyncStrip,
                        persistentNotice = persistentNotice,
                        mainNotice = mainNotice,
                        manualSyncRefreshing = manualSyncRefreshing,
                        manualSyncBlockedReason = manualSyncBlockedReason,
                        input = input,
                        onInputChange = onInputChange,
                        focusRequester = focusRequester,
                        sourceImage = sourceImage,
                        maskImage = maskImage,
                        editing = editing,
                        streaming = streaming,
                        canSend = canSend,
                        onProviderModelSelected = onProviderModelSelected,
                        onDismissProviderModelFeatureHint = onDismissProviderModelFeatureHint,
                        providerDisplayName = providerDisplayName,
                        chatModelsForProvider = chatModelsForProvider,
                        imageModelsForProvider = imageModelsForProvider,
                        onManualSync = onManualSync,
                        onOpenSyncSettings = onOpenSyncSettings,
                        onEditMessage = onEditMessage,
                        onRegenerateMessage = onRegenerateMessage,
                        onDeleteMessage = onDeleteMessage,
                        speakingMessageId = speakingMessageId,
                        onSpeakMessage = onSpeakMessage,
                        onStopSpeaking = onStopSpeaking,
                        onOpenEmptyStateSettings = onOpenEmptyStateSettings,
                        onPickSource = onPickSource,
                        onClearSource = onClearSource,
                        onPickMask = onPickMask,
                        onClearMask = onClearMask,
                        onCancelEdit = onCancelEdit,
                        onStopGenerating = onStopGenerating,
                        onSend = onSend,
                        i18n = i18n,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight(),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatMainColumn(
    snapshot: AppSnapshot,
    activeConversation: Conversation?,
    enabledProviders: List<ProviderConfig>,
    activeProvider: ProviderConfig?,
    activeModel: String,
    activeImageModel: String,
    activeProviderKeyMissing: Boolean,
    composerMode: ComposerMode,
    onComposerModeChange: (ComposerMode) -> Unit,
    imageTask: ImageTaskMode,
    onImageTaskChange: (ImageTaskMode) -> Unit,
    chatSetupHint: String?,
    emptyStateSettingsActionLabel: String?,
    showProviderHint: Boolean,
    showHomeSyncStrip: Boolean,
    compactHomeSyncStrip: Boolean,
    persistentNotice: InlineNotice?,
    mainNotice: InlineNotice?,
    manualSyncRefreshing: Boolean,
    manualSyncBlockedReason: String?,
    input: String,
    onInputChange: (String) -> Unit,
    focusRequester: FocusRequester,
    sourceImage: ImageUpload?,
    maskImage: ImageUpload?,
    editing: Boolean,
    streaming: Boolean,
    canSend: Boolean,
    onProviderModelSelected: (ProviderConfig, String) -> Unit,
    onDismissProviderModelFeatureHint: () -> Unit,
    providerDisplayName: (ProviderConfig) -> String,
    chatModelsForProvider: (ProviderConfig) -> List<String>,
    imageModelsForProvider: (ProviderConfig) -> List<String>,
    onManualSync: () -> Unit,
    onOpenSyncSettings: () -> Unit,
    onEditMessage: (ChatMessage) -> Unit,
    onRegenerateMessage: (ChatMessage) -> Unit,
    onDeleteMessage: (ChatMessage) -> Unit,
    speakingMessageId: String?,
    onSpeakMessage: (ChatMessage) -> Unit,
    onStopSpeaking: () -> Unit,
    onOpenEmptyStateSettings: () -> Unit,
    onPickSource: () -> Unit,
    onClearSource: () -> Unit,
    onPickMask: () -> Unit,
    onClearMask: () -> Unit,
    onCancelEdit: () -> Unit,
    onStopGenerating: () -> Unit,
    onSend: () -> Unit,
    i18n: NativeI18n,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize(),
    ) {
        val hasMessages = activeConversation?.messages?.isNotEmpty() == true

        ProviderModelSelector(
            providers = enabledProviders,
            activeProvider = activeProvider,
            mode = composerMode,
            activeModel = if (composerMode == ComposerMode.Image) activeImageModel else activeModel,
            providerDisplayName = providerDisplayName,
            chatModelsForProvider = chatModelsForProvider,
            imageModelsForProvider = imageModelsForProvider,
            onSelected = onProviderModelSelected,
            i18n = i18n,
        )
        if (showProviderHint) {
            FeatureHintCard(
                id = ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID,
                message = i18n.t("featureHint.provider-model"),
                dismissLabel = i18n.t("featureHint.dismiss"),
                onDismiss = onDismissProviderModelFeatureHint,
            )
        }

        if (showHomeSyncStrip) {
            CloudSyncStatusStrip(
                snapshot = snapshot,
                compact = compactHomeSyncStrip || hasMessages,
                manualSyncRunning = manualSyncRefreshing,
                manualSyncBlockedReason = manualSyncBlockedReason,
                onSyncClick = onManualSync,
                onOpenSettings = onOpenSyncSettings,
                i18n = i18n,
            )
        }

        InlineNoticeView(persistentNotice)
        InlineNoticeView(mainNotice)

        MessageList(
            messages = activeConversation?.messages.orEmpty(),
            hasActiveChat = activeConversation != null,
            manualSyncRefreshing = manualSyncRefreshing,
            onRefresh = onManualSync,
            onEditMessage = onEditMessage,
            onRegenerateMessage = onRegenerateMessage,
            onDeleteMessage = onDeleteMessage,
            speakingMessageId = speakingMessageId,
            onSpeakMessage = onSpeakMessage,
            onStopSpeaking = onStopSpeaking,
            i18n = i18n,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            EmptyState(
                hasProvider = activeProvider != null,
                mode = composerMode,
                imageTask = imageTask,
                setupHint = chatSetupHint,
                imageHint = imageComposerHint(
                    provider = activeProvider,
                    providerKeyMissing = activeProviderKeyMissing,
                    imageModel = activeImageModel,
                    imageTask = imageTask,
                    sourceImage = sourceImage,
                    maskImage = maskImage,
                    i18n = i18n,
                ),
                settingsActionLabel = emptyStateSettingsActionLabel,
                onOpenSettings = onOpenEmptyStateSettings,
                i18n = i18n,
            )
        }

        Composer(
            input = input,
            onInputChange = onInputChange,
            focusRequester = focusRequester,
            mode = composerMode,
            onModeChange = onComposerModeChange,
            imageTask = imageTask,
            onImageTaskChange = onImageTaskChange,
            sourceImage = sourceImage,
            maskImage = maskImage,
            editing = editing,
            onPickSource = onPickSource,
            onClearSource = onClearSource,
            onPickMask = onPickMask,
            onClearMask = onClearMask,
            onCancelEdit = onCancelEdit,
            streaming = streaming,
            onStopGenerating = onStopGenerating,
            canSend = canSend,
            onSend = onSend,
            i18n = i18n,
        )
    }
}
