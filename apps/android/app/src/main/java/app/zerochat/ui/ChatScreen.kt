@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package app.zerochat.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.LayoutDirection
import app.zerochat.ai.AiClient
import app.zerochat.ai.ImageUpload
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.LocalSnapshotRecoveryIssue
import app.zerochat.data.MessageRole
import app.zerochat.security.SecretStore
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.sync.SharedPreferencesGistCursorStorage
import app.zerochat.sync.SyncClient
import app.zerochat.ui.chat.ChatConversationPane
import app.zerochat.ui.chat.ChatMessageRequestPlan
import app.zerochat.ui.chat.ChatRequestBlockerFeedback
import app.zerochat.ui.chat.ChatSetupSettingsTarget
import app.zerochat.ui.chat.ConversationDeleteDialog
import app.zerochat.ui.chat.ANDROID_CLOUD_SYNC_FEATURE_HINT_ID
import app.zerochat.ui.chat.ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID
import app.zerochat.ui.chat.InlineNotice
import app.zerochat.ui.chat.InlineNoticeView
import app.zerochat.ui.chat.ImageMessageRequestPlan
import app.zerochat.ui.chat.NoticeKind
import app.zerochat.ui.chat.ChatTopBar
import app.zerochat.ui.chat.activeConversation
import app.zerochat.ui.chat.addConversation
import app.zerochat.ui.chat.applyProviderModelSelection
import app.zerochat.ui.chat.canSubmitComposer
import app.zerochat.ui.chat.chatModelForConversation
import app.zerochat.ui.chat.chatModelsForProvider
import app.zerochat.ui.chat.chatMessageBlockerFeedback
import app.zerochat.ui.chat.chatSetupHintKey
import app.zerochat.ui.chat.conversationMatchesSearch
import app.zerochat.ui.chat.createPendingChatTurn
import app.zerochat.ui.chat.canReuseUninteractedNewConversation
import app.zerochat.ui.chat.createPendingImageMessage
import app.zerochat.ui.chat.defaultChatModelForProvider
import app.zerochat.ui.chat.deleteConversation
import app.zerochat.ui.chat.deleteMessage
import app.zerochat.ui.chat.dismissFeatureHintId
import app.zerochat.ui.chat.emptyStateSettingsActionKey
import app.zerochat.ui.chat.emptyStateSettingsTarget
import app.zerochat.ui.chat.completeImageMessage
import app.zerochat.ui.chat.failImageMessage
import app.zerochat.ui.chat.executeImageRequest
import app.zerochat.ui.chat.GenerationTaskOwner
import app.zerochat.ui.chat.runIfCurrent
import app.zerochat.ui.chat.hydrateChatSnapshot
import app.zerochat.ui.chat.imageMessageBlockerFeedback
import app.zerochat.ui.chat.imageModelsForProvider
import app.zerochat.ui.chat.imageRetryPrompt
import app.zerochat.ui.chat.initializeResourceOrRelease
import app.zerochat.ui.chat.manualCloudSyncBlocker
import app.zerochat.ui.chat.manualCloudSyncBlockerMessageKey
import app.zerochat.ui.chat.manualCloudSyncErrorNotice
import app.zerochat.ui.chat.manualCloudSyncSettingsStatusNotice
import app.zerochat.ui.chat.manualCloudSyncStatusNotice
import app.zerochat.ui.chat.messageSpeechBlockerFeedback
import app.zerochat.ui.chat.MessageSpeechRequestPlan
import app.zerochat.ui.chat.newConversation
import app.zerochat.ui.chat.newId
import app.zerochat.ui.chat.normalizeAssistantMessageContent
import app.zerochat.ui.chat.normalizeConversationSearchValue
import app.zerochat.ui.chat.prepareMessageSpeechRequest
import app.zerochat.ui.chat.nowMillis
import app.zerochat.ui.chat.prepareChatMessageRequest
import app.zerochat.ui.chat.prepareImageMessageRequest
import app.zerochat.ui.chat.providerDisplayName
import app.zerochat.ui.chat.providerNeedsClientKey
import app.zerochat.ui.chat.providerProxyTokenForRequest
import app.zerochat.ui.chat.providerRequest
import app.zerochat.ui.chat.readUpload
import app.zerochat.ui.chat.replaceMessageReducer
import app.zerochat.ui.chat.selectConversation as selectConversationSnapshot
import app.zerochat.ui.chat.selectedImageModel
import app.zerochat.ui.chat.shouldShowFeatureHint
import app.zerochat.ui.chat.stoppedAssistantMessage
import app.zerochat.ui.chat.stoppedImageMessage
import app.zerochat.ui.chat.streamChatGenerationWithRetry
import app.zerochat.ui.settings.ChatSettingsSheet
import app.zerochat.ui.settings.BackupTaskViewModel
import app.zerochat.ui.settings.SettingsNoticeKind
import app.zerochat.ui.settings.SettingsTab
import app.zerochat.ui.settings.syncSettingsStatusPresentation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File


enum class ComposerMode(val title: String) {
    Chat("Chat"),
    Image("Image"),
}

enum class ImageTaskMode(val title: String) {
    Generate("Text to image"),
    Edit("Edit image"),
    Inpaint("Inpaint"),
}

private fun settingsNotice(message: String, kind: SettingsNoticeKind): InlineNotice =
    InlineNotice(
        message,
        when (kind) {
            SettingsNoticeKind.Success -> NoticeKind.Success
            SettingsNoticeKind.Warning -> NoticeKind.Warning
            SettingsNoticeKind.Error -> NoticeKind.Error
        },
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatScreen(
    snapshot: AppSnapshot,
    onSnapshotChange: (AppSnapshot, Boolean) -> Unit,
    onSnapshotReduce: ((AppSnapshot) -> AppSnapshot, Boolean) -> Unit,
    initialNotice: String? = null,
    localSnapshotIssue: LocalSnapshotRecoveryIssue?,
    backupTaskViewModel: BackupTaskViewModel,
    generationTasks: GenerationTaskOwner,
    settingsOpen: Boolean,
    settingsInitialTabName: String,
    onSettingsOpen: (SettingsTab) -> Unit,
    onSettingsClose: () -> Unit,
    onResetLocalData: suspend (AppSnapshot) -> Result<Unit>,
    onSaveProviderKey: suspend (String, String) -> Result<Unit>,
    onDeleteProvider: suspend (String) -> Result<Unit>,
    onSaveGithubToken: suspend (String) -> Result<Unit>,
    onSaveSyncPassphrase: suspend (String) -> Result<Unit>,
    onFirstSyncStrategy: (FirstSyncStrategy) -> Unit = {},
    onManualSync: suspend (AppSnapshot) -> AppSnapshot? = { null },
    quickAskDeliveryCount: Long = 0L,
    secretStore: SecretStore,
) {
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val keyboardVisible = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val scope = rememberCoroutineScope()
    val aiClient = remember { AiClient() }
    val syncClient = remember(context) {
        SyncClient(gistCursorStorage = SharedPreferencesGistCursorStorage(context))
    }
    var input by rememberSaveable { mutableStateOf("") }
    var composerModeName by rememberSaveable { mutableStateOf(ComposerMode.Chat.name) }
    var imageTaskName by rememberSaveable { mutableStateOf(ImageTaskMode.Generate.name) }
    val composerMode = ComposerMode.entries.firstOrNull { it.name == composerModeName } ?: ComposerMode.Chat
    val imageTask = ImageTaskMode.entries.firstOrNull { it.name == imageTaskName } ?: ImageTaskMode.Generate
    var conversationSearch by rememberSaveable { mutableStateOf("") }
    var conversationPickerOpen by rememberSaveable { mutableStateOf(false) }
    var conversationPendingDeleteId by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingNewConversationId by remember { mutableStateOf<String?>(null) }
    var sourceImageUriString by rememberSaveable { mutableStateOf<String?>(null) }
    var maskImageUriString by rememberSaveable { mutableStateOf<String?>(null) }
    var sourceImage by remember { mutableStateOf<ImageUpload?>(null) }
    var maskImage by remember { mutableStateOf<ImageUpload?>(null) }
    var editingMessageId by rememberSaveable { mutableStateOf<String?>(null) }
    var mainNotice by remember(initialNotice) {
        mutableStateOf(initialNotice?.let { InlineNotice(it, NoticeKind.Error) })
    }
    var settingsNotice by remember { mutableStateOf<InlineNotice?>(null) }
    var chatStreamingJob by remember { mutableStateOf<Job?>(null) }
    var imageGenerationJob by remember { mutableStateOf<Job?>(null) }
    var speechJob by remember { mutableStateOf<Job?>(null) }
    var speechPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var speechTempFile by remember { mutableStateOf<File?>(null) }
    var speakingMessageId by remember { mutableStateOf<String?>(null) }
    var speechRequestSerial by remember { mutableLongStateOf(0L) }
    var manualSyncRefreshing by remember { mutableStateOf(false) }
    var ownedStreamingImageMessageIds by remember { mutableStateOf(emptySet<String>()) }
    val composerFocusRequester = remember { FocusRequester() }
    val i18n = remember(snapshot.preferences.language, NativeI18n.systemLanguageKey()) {
        NativeI18n.forMode(snapshot.preferences.language)
    }
    val localSnapshotRecoveryNotice = localSnapshotIssue?.let {
        InlineNotice(i18n.t("message.localSnapshotLoadFailed"), NoticeKind.Error)
    }

    val sourcePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            sourceImage = null
            sourceImageUriString = uri.toString()
        }
    }
    val maskPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            maskImage = null
            maskImageUriString = uri.toString()
        }
    }

    LaunchedEffect(sourceImageUriString) {
        val uri = sourceImageUriString?.let(Uri::parse) ?: run {
            sourceImage = null
            return@LaunchedEffect
        }
        runCatchingPreservingCancellation { readUpload(context, uri, "source.png", i18n) }
            .onSuccess { sourceImage = it }
            .onFailure { error ->
                sourceImageUriString = null
                mainNotice = InlineNotice(
                    "${i18n.t("message.imageReadFailedPrefix")}: ${i18n.errorMessage(error.message)}",
                    NoticeKind.Error,
                )
            }
    }

    LaunchedEffect(maskImageUriString) {
        val uri = maskImageUriString?.let(Uri::parse) ?: run {
            maskImage = null
            return@LaunchedEffect
        }
        runCatchingPreservingCancellation { readUpload(context, uri, "mask.png", i18n) }
            .onSuccess { maskImage = it }
            .onFailure { error ->
                maskImageUriString = null
                mainNotice = InlineNotice(
                    "${i18n.t("message.imageReadFailedPrefix")}: ${i18n.errorMessage(error.message)}",
                    NoticeKind.Error,
                )
            }
    }
    val layoutDirection = if (i18n.locale == "ar-SA") {
        LayoutDirection.Rtl
    } else {
        LayoutDirection.Ltr
    }

    val data = remember(snapshot, i18n.locale, ownedStreamingImageMessageIds) {
        hydrateChatSnapshot(
            snapshot,
            i18n.t("provider.preset.custom-openai-relay"),
            nowMillis(),
            ownedStreamingImageMessageIds = ownedStreamingImageMessageIds,
            orphanedImageFailureCopy = i18n.t("message.imageRequestFailed"),
        )
    }
    val conversationPendingDelete = conversationPendingDeleteId?.let { pendingId ->
        data.conversations.firstOrNull { it.id == pendingId }
    }

    LaunchedEffect(data) {
        if (data !== snapshot) {
            onSnapshotChange(data, true)
        }
    }

    val conversationSearchQuery = conversationSearch.trim()
    val normalizedConversationSearchQuery = normalizeConversationSearchValue(conversationSearchQuery)
    val filteredConversations = remember(data.conversations, normalizedConversationSearchQuery, i18n.locale) {
        if (normalizedConversationSearchQuery.isBlank()) {
            data.conversations
        } else {
            data.conversations.filter { conversation ->
                conversationMatchesSearch(conversation, normalizedConversationSearchQuery, i18n)
            }
        }
    }
    val conversationSearchActive = conversationSearchQuery.isNotEmpty()
    val activeConversation = activeConversation(data)
    val enabledProviders = data.providers.filter { it.enabled }
    val activeProvider = activeConversation
        ?.providerId
        ?.let { id -> data.providers.firstOrNull { it.id == id && it.enabled } }
        ?: enabledProviders.firstOrNull()
    val activeModel = chatModelForConversation(activeConversation, activeProvider)
    val activeImageModel = selectedImageModel(activeProvider)
    val activeProviderRequest = activeProvider?.let { providerRequest(it, data) }
    val activeProviderKeyMissing = activeProviderRequest?.let { requestProvider ->
        providerNeedsClientKey(requestProvider) &&
            activeProvider?.let { secretStore.providerKey(it.id).isBlank() } == true
    } == true
    val chatSetupHint = chatSetupHintKey(
        activeProvider,
        activeProviderKeyMissing,
        activeModel,
    )?.let(i18n::t)
    val emptyStateSettingsActionLabel = emptyStateSettingsActionKey(
        composerMode,
        activeProvider,
        activeProviderKeyMissing,
        activeModel,
        activeImageModel,
    )?.let(i18n::t)
    val emptyStateTarget = emptyStateSettingsTarget(
        composerMode,
        activeProvider,
        activeProviderKeyMissing,
        activeModel,
        activeImageModel,
    )
    val isGenerating =
        chatStreamingJob?.isActive == true || imageGenerationJob?.isActive == true
    val composerCanSend = canSubmitComposer(
        input = input,
        isChatStreaming = isGenerating,
        activeProvider = activeProvider,
        activeProviderKeyMissing = activeProviderKeyMissing,
        composerMode = composerMode,
        activeModel = activeModel,
        activeImageModel = activeImageModel,
        imageTask = imageTask,
        sourceImage = sourceImage,
        maskImage = maskImage,
    )

    fun commitWithSync(next: AppSnapshot, autoSync: Boolean) {
        onSnapshotChange(next.copy(updatedAt = nowMillis()), autoSync)
    }

    fun commit(next: AppSnapshot) {
        commitWithSync(next, true)
    }

    fun commitLocalSettings(next: AppSnapshot) {
        commitWithSync(next, false)
    }

    fun manualSyncBlockedReason(): String? =
        localSnapshotRecoveryNotice?.message ?: manualCloudSyncBlocker(
            snapshot = data,
            isChatStreaming = isGenerating,
            hasSyncPassphrase = secretStore.syncPassphrase().isNotBlank(),
            hasGithubToken = secretStore.githubToken().isNotBlank(),
            hasCloudflareAccessKey = secretStore.cloudflareAccessKey().isNotBlank(),
        )?.let { blocker ->
            i18n.t(manualCloudSyncBlockerMessageKey(blocker))
        }

    fun runManualCloudSync(
        noticeTarget: (InlineNotice) -> Unit,
        syncedNotice: (AppSnapshot) -> InlineNotice?,
    ) {
        if (manualSyncRefreshing) {
            return
        }
        manualSyncBlockedReason()?.let { reason ->
            noticeTarget(InlineNotice(reason, NoticeKind.Warning))
            return
        }

        manualSyncRefreshing = true
        scope.launch {
            try {
                val result = runCatchingPreservingCancellation { onManualSync(data) }
                result.fold(
                    onSuccess = { synced ->
                        if (synced == null) {
                            noticeTarget(
                                InlineNotice(
                                    manualSyncBlockedReason() ?: i18n.t("sync.requirement.local"),
                                    NoticeKind.Warning,
                                ),
                            )
                        } else {
                            syncedNotice(synced)?.let(noticeTarget)
                        }
                    },
                    onFailure = { error ->
                        noticeTarget(manualCloudSyncErrorNotice(error, i18n::errorMessage))
                    },
                )
            } finally {
                manualSyncRefreshing = false
            }
        }
    }

    fun pullToRefreshSync() {
        runManualCloudSync(
            noticeTarget = { notice -> mainNotice = notice },
            syncedNotice = { synced ->
                manualCloudSyncStatusNotice(
                    synced.sync.lastSyncStatus,
                    i18n::syncStatusMessage,
                )
            },
        )
    }

    fun selectConversation(id: String) {
        pendingNewConversationId = null
        commit(selectConversationSnapshot(data, id))
    }

    fun openSettings(
        notice: InlineNotice? = null,
        initialTab: SettingsTab = SettingsTab.Appearance,
    ) {
        settingsNotice = notice
        onSettingsOpen(initialTab)
    }

    fun showRequestBlockerFeedback(feedback: ChatRequestBlockerFeedback) {
        val notice = InlineNotice(i18n.t(feedback.messageKey), NoticeKind.Warning)
        when (feedback.settingsTarget) {
            ChatSetupSettingsTarget.Providers -> openSettings(notice, SettingsTab.Providers)
            ChatSetupSettingsTarget.Models -> openSettings(notice, SettingsTab.Models)
            ChatSetupSettingsTarget.Appearance -> openSettings(notice, SettingsTab.Appearance)
            null -> mainNotice = notice
        }
    }

    fun closeSettings() {
        onSettingsClose()
        settingsNotice = null
    }

    fun clearSpeechTempFile() {
        speechTempFile?.delete()
        speechTempFile = null
    }

    fun stopSpeaking(showNotice: Boolean = true) {
        speechRequestSerial += 1
        speechJob?.cancel()
        speechJob = null
        speechPlayer?.let { player ->
            runCatching {
                if (player.isPlaying) {
                    player.stop()
                }
            }
            player.release()
        }
        speechPlayer = null
        speakingMessageId = null
        clearSpeechTempFile()
        if (showNotice) {
            mainNotice = InlineNotice(i18n.t("notice.audioSpeechStopped"), NoticeKind.Warning)
        }
    }

    fun audioSpeechFailedNotice(error: Throwable): InlineNotice =
        InlineNotice(
            i18n.t("notice.audioSpeechFailed")
                .replace("{message}", i18n.errorMessage(error.message ?: error::class.java.simpleName)),
            NoticeKind.Error,
        )

    fun speakMessage(message: ChatMessage) {
        if (speakingMessageId == message.id) {
            stopSpeaking()
            return
        }

        val plan = when (val prepared = prepareMessageSpeechRequest(
            snapshot = data,
            conversation = activeConversation,
            message = message,
            hasProviderKey = { providerId -> secretStore.providerKey(providerId).isNotBlank() },
        )) {
            is MessageSpeechRequestPlan.Ready -> prepared.request
            is MessageSpeechRequestPlan.Blocked -> {
                showRequestBlockerFeedback(messageSpeechBlockerFeedback(prepared.blocker))
                return
            }
        }

        stopSpeaking(showNotice = false)
        val requestSerial = speechRequestSerial + 1
        speechRequestSerial = requestSerial
        speakingMessageId = message.id
        speechJob = scope.launch {
            try {
                val audio = aiClient.createSpeech(
                    provider = plan.requestProvider,
                    apiKey = secretStore.providerKey(plan.provider.id),
                    proxyToken = providerProxyTokenForRequest(plan.requestProvider) {
                        secretStore.cloudflareAccessKey()
                    },
                    model = plan.model,
                    input = plan.input,
                    responseFormat = "mp3",
                )
                if (speechRequestSerial != requestSerial) {
                    return@launch
                }
                val audioFile = withContext(Dispatchers.IO) {
                    File.createTempFile("zerochat-speech-", ".mp3", context.cacheDir).also { file ->
                        file.writeBytes(audio)
                    }
                }
                if (speechRequestSerial != requestSerial) {
                    audioFile.delete()
                    return@launch
                }
                speechTempFile?.delete()
                speechTempFile = audioFile
                val player = initializeResourceOrRelease(
                    resource = MediaPlayer(),
                    release = MediaPlayer::release,
                ) {
                    setDataSource(audioFile.absolutePath)
                    setOnCompletionListener { completed ->
                        if (speechRequestSerial == requestSerial && speechPlayer === completed) {
                            speechPlayer = null
                            speakingMessageId = null
                            clearSpeechTempFile()
                        }
                        completed.release()
                    }
                    setOnErrorListener { failed, _, _ ->
                        if (speechRequestSerial == requestSerial && speechPlayer === failed) {
                            speechPlayer = null
                            speakingMessageId = null
                            clearSpeechTempFile()
                            mainNotice = audioSpeechFailedNotice(
                                IllegalStateException("MediaPlayer playback failed"),
                            )
                        }
                        failed.release()
                        true
                    }
                    prepare()
                    start()
                }
                speechPlayer = player
                mainNotice = InlineNotice(
                    i18n.t("notice.audioSpeechPlaying").replace("{model}", plan.model),
                    NoticeKind.Success,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                if (speechRequestSerial == requestSerial) {
                    speakingMessageId = null
                    clearSpeechTempFile()
                    mainNotice = audioSpeechFailedNotice(error)
                }
            } finally {
                if (speechRequestSerial == requestSerial) {
                    speechJob = null
                }
            }
        }
    }

    DisposableEffect(aiClient, syncClient) {
        onDispose {
            chatStreamingJob?.cancel()
            imageGenerationJob?.cancel()
            stopSpeaking(showNotice = false)
            aiClient.close()
            syncClient.close()
        }
    }

    DisposableEffect(generationTasks) {
        onDispose { generationTasks.close() }
    }

    val backNavigationAction = androidBackNavigationAction(settingsOpen, conversationPendingDelete != null)
    BackHandler(enabled = backNavigationAction != AndroidBackNavigationAction.None) {
        when (backNavigationAction) {
            AndroidBackNavigationAction.DismissConversationDelete -> conversationPendingDeleteId = null
            AndroidBackNavigationAction.CloseSettings -> closeSettings()
            AndroidBackNavigationAction.None -> Unit
        }
    }

    fun createChat(): Conversation? {
        val fallbackTitle = i18n.t("title.newChat")
        val pending = pendingNewConversationId?.let { pendingId ->
            data.conversations.firstOrNull { it.id == pendingId }
        }
        if (
            canReuseUninteractedNewConversation(
                conversation = pending,
                fallbackTitle = fallbackTitle,
                input = input,
                editing = editingMessageId != null,
                composerMode = composerMode,
                imageTask = imageTask,
                hasSourceImage = sourceImage != null,
                hasMaskImage = maskImage != null,
            )
        ) {
            return pending
        }
        if (
            canReuseUninteractedNewConversation(
                conversation = activeConversation,
                fallbackTitle = fallbackTitle,
                input = input,
                editing = editingMessageId != null,
                composerMode = composerMode,
                imageTask = imageTask,
                hasSourceImage = sourceImage != null,
                hasMaskImage = maskImage != null,
            )
        ) {
            return activeConversation
        }
        val provider = enabledProviders.firstOrNull()
        if (provider == null) {
            openSettings(
                InlineNotice(
                    i18n.t("message.configureModelFirst"),
                    NoticeKind.Warning,
                ),
                SettingsTab.Providers,
            )
            return null
        }

        val model = defaultChatModelForProvider(provider)
        if (model.isBlank()) {
            openSettings(
                InlineNotice(
                    i18n.t("message.modelRequired"),
                    NoticeKind.Warning,
                ),
                SettingsTab.Models,
            )
            return null
        }

        val conversation = newConversation(provider, model, i18n.t("title.newChat"))
        pendingNewConversationId = conversation.id
        commit(addConversation(data, conversation))
        return conversation
    }

    LaunchedEffect(quickAskDeliveryCount) {
        if (quickAskDeliveryCount <= 0L) {
            return@LaunchedEffect
        }

        conversationSearch = ""
        input = ""
        editingMessageId = null
        composerModeName = ComposerMode.Chat.name
        sourceImageUriString = null
        maskImageUriString = null
        sourceImage = null
        maskImage = null
        createChat()
        delay(120)
        runCatching { composerFocusRequester.requestFocus() }
    }

    fun sendChatMessage(conversation: Conversation, text: String, editId: String?) {
        val lease = generationTasks.tryAcquire() ?: return
        val request = when (val plan = prepareChatMessageRequest(
            snapshot = data,
            conversation = conversation,
            prompt = text,
            isChatStreaming =
                chatStreamingJob?.isActive == true || imageGenerationJob?.isActive == true,
            hasProviderKey = { providerId -> secretStore.providerKey(providerId).isNotBlank() },
        )) {
            is ChatMessageRequestPlan.Ready -> plan.request
            is ChatMessageRequestPlan.Blocked -> {
                lease.release()
                showRequestBlockerFeedback(chatMessageBlockerFeedback(plan.blocker))
                return
            }
        }

        val pending = createPendingChatTurn(
            snapshot = data,
            conversation = conversation,
            model = request.model,
            text = request.prompt,
            editId = editId,
            userMessageId = newId(),
            assistantMessageId = newId(),
            now = nowMillis(),
            fallbackTitle = i18n.t("title.newChat"),
        ) ?: run {
            lease.release()
            mainNotice = InlineNotice(i18n.t("message.onlyOwnMessagesEditable"), NoticeKind.Warning)
            return
        }
        val pendingSnapshot = pending.snapshot
        val baseMessages = pending.baseMessages
        val assistantMessage = pending.pendingAssistantMessage
        if (!lease.runIfCurrent {
            commitWithSync(pendingSnapshot, autoSync = false)
            input = ""
            editingMessageId = null
            mainNotice = InlineNotice(i18n.t("message.savedLocallySyncQueued"), NoticeKind.Success)
        }) {
            lease.release()
            return
        }

        val receivedText = StringBuilder()
        var lastUiCommitAt = 0L

        fun commitAssistantMessage(message: ChatMessage, autoSync: Boolean = true) {
            onSnapshotReduce(
                replaceMessageReducer(
                    conversationId = conversation.id,
                    message = message,
                    updatedAt = nowMillis(),
                ),
                autoSync,
            )
        }

        fun commitStreamingContent(content: String, force: Boolean = false) {
            val now = nowMillis()
            if (!force && now - lastUiCommitAt < STREAMING_UI_FRAME_MS) {
                return
            }
            lastUiCommitAt = now
            commitAssistantMessage(
                assistantMessage.copy(
                    content = content,
                    status = "streaming",
                    error = null,
                ),
                autoSync = false,
            )
        }

        val preparedGenerationJob = generationTasks.prepare(scope, lease) {
            val runningJob = currentCoroutineContext()[Job]
            try {
                val completedText = streamChatGenerationWithRetry(
                    aiClient = aiClient,
                    request = request,
                    apiKey = secretStore.providerKey(request.provider.id),
                    proxyToken = providerProxyTokenForRequest(request.requestProvider) {
                        secretStore.cloudflareAccessKey()
                    },
                    messages = baseMessages,
                    contextMessageLimit = pendingSnapshot.preferences.chatContextMessageLimit,
                    receivedText = receivedText,
                    onRetry = { attempt, total ->
                        lease.runIfCurrent {
                            mainNotice = InlineNotice(
                                i18n.networkRetryingNotice(attempt, total),
                                NoticeKind.Warning,
                            )
                        }
                    },
                    onVisibleText = { visibleText ->
                        lease.runIfCurrent {
                            mainNotice = null
                            commitStreamingContent(normalizeAssistantMessageContent(visibleText))
                        }
                    },
                )
                currentCoroutineContext().ensureActive()
                val normalizedText = normalizeAssistantMessageContent(completedText)
                lease.runIfCurrent {
                    mainNotice = null
                    commitAssistantMessage(
                        assistantMessage.copy(
                            content = normalizedText.ifBlank { i18n.t("message.providerEmptyResponse") },
                            status = "done",
                            error = null,
                        ),
                    )
                }
            } catch (error: CancellationException) {
                lease.runIfCurrent {
                    commitAssistantMessage(
                        stoppedAssistantMessage(
                            pendingMessage = assistantMessage,
                            partialContent = normalizeAssistantMessageContent(receivedText.toString()),
                            stoppedCopy = i18n.t("message.generationStopped"),
                        ),
                    )
                }
            } catch (error: Throwable) {
                lease.runIfCurrent {
                    commitAssistantMessage(
                        assistantMessage.copy(
                            content = i18n.t("message.generationFailed"),
                            status = "error",
                            error = i18n.errorMessage(error.message ?: error::class.java.simpleName),
                        ),
                    )
                }
            } finally {
                if (chatStreamingJob === runningJob) {
                    chatStreamingJob = null
                }
            }
        }
        if (preparedGenerationJob == null) {
            lease.release()
            return
        }
        chatStreamingJob = preparedGenerationJob
        preparedGenerationJob.start()
    }

    fun generateImageMessage(conversation: Conversation, prompt: String) {
        val lease = generationTasks.tryAcquire() ?: return
        val provider = data.providers.firstOrNull { it.id == conversation.providerId && it.enabled }
        val requestProvider = provider?.let { providerRequest(it, data) }
        val providerKeyMissing = provider?.let { currentProvider ->
            requestProvider?.let(::providerNeedsClientKey) == true &&
                secretStore.providerKey(currentProvider.id).isBlank()
        } == true
        val request = when (val plan = prepareImageMessageRequest(
            provider = provider,
            providerKeyMissing = providerKeyMissing,
            imageModel = selectedImageModel(provider, imageTask),
            responsesModel = conversation.model,
            prompt = prompt,
            imageTask = imageTask,
            sourceImage = sourceImage,
            maskImage = maskImage,
        )) {
            is ImageMessageRequestPlan.Blocked -> {
                lease.release()
                showRequestBlockerFeedback(imageMessageBlockerFeedback(plan.blocker))
                return
            }
            is ImageMessageRequestPlan.Ready -> plan.request
        }

        val pending = createPendingImageMessage(
            snapshot = data,
            conversation = conversation,
            prompt = request.prompt,
            pendingMessageId = newId(),
            now = nowMillis(),
            generatingCopy = i18n.t("message.generatingImage"),
            imageConversationPrefix = i18n.t("title.imageConversationPrefix"),
        )
        val pendingSnapshot = pending.snapshot
        val pendingMessage = pending.pendingMessage
        if (!lease.runIfCurrent {
            ownedStreamingImageMessageIds = ownedStreamingImageMessageIds + pendingMessage.id
            commit(pendingSnapshot)
            input = ""
        }) {
            lease.release()
            return
        }

        val preparedImageJob = generationTasks.prepare(scope, lease) {
            val runningJob = currentCoroutineContext()[Job]
            try {
                val result = runCatchingPreservingCancellation {
                    executeImageRequest(
                        aiClient = aiClient,
                        request = request,
                        snapshot = pendingSnapshot,
                        apiKey = secretStore.providerKey(request.provider.id),
                        proxyToken = providerProxyTokenForRequest(providerRequest(request.provider, pendingSnapshot)) {
                            secretStore.cloudflareAccessKey()
                        },
                    )
                }
                currentCoroutineContext().ensureActive()

                lease.runIfCurrent {
                    val completed = result.fold(
                        onSuccess = { image ->
                            completeImageMessage(
                                pendingMessage = pendingMessage,
                                image = image,
                                prompt = request.prompt,
                                imageModel = request.imageModel,
                                attachmentId = newId(),
                                createdAt = nowMillis(),
                            )
                        },
                        onFailure = { error ->
                            failImageMessage(
                                pendingMessage = pendingMessage,
                                failureCopy = i18n.t("message.imageRequestFailed"),
                                errorCopy = i18n.errorMessage(error.message ?: error::class.java.simpleName),
                            )
                        },
                    )
                    onSnapshotReduce(
                        replaceMessageReducer(
                            conversationId = conversation.id,
                            message = completed,
                            updatedAt = nowMillis(),
                        ),
                        true,
                    )
                }
            } catch (error: CancellationException) {
                lease.runIfCurrent {
                    onSnapshotReduce(
                        replaceMessageReducer(
                            conversationId = conversation.id,
                            message = stoppedImageMessage(
                                pendingMessage = pendingMessage,
                                stoppedCopy = i18n.t("message.generationStopped"),
                            ),
                            updatedAt = nowMillis(),
                        ),
                        true,
                    )
                }
            } finally {
                ownedStreamingImageMessageIds = ownedStreamingImageMessageIds - pendingMessage.id
                if (imageGenerationJob === runningJob) {
                    imageGenerationJob = null
                }
            }
        }
        if (preparedImageJob == null) {
            lease.release()
            return
        }
        imageGenerationJob = preparedImageJob
        preparedImageJob.start()
    }

    fun dismissKeyboard() {
        focusManager.clearFocus(force = true)
        keyboardController?.hide()
    }
    CompositionLocalProvider(LocalLayoutDirection provides layoutDirection) {
        Scaffold(
            topBar = {
                if (!keyboardVisible) {
                    ChatTopBar(
                        title = activeConversation?.title ?: "ZeroChat",
                        onNewConversation = {
                            dismissKeyboard()
                            conversationSearch = ""
                            createChat()
                        },
                        onOpenConversations = {
                            dismissKeyboard()
                            conversationPickerOpen = true
                        },
                        onOpenSettings = { openSettings() },
                        i18n = i18n,
                    )
                }
            },
        ) { padding ->
            ChatConversationPane(
                snapshot = data,
                conversationSearch = conversationSearch,
                onConversationSearchChange = { conversationSearch = it },
                onClearConversationSearch = { conversationSearch = "" },
                conversationPickerOpen = conversationPickerOpen,
                onConversationPickerOpenChange = { open ->
                    conversationPickerOpen = open
                    if (!open) {
                        dismissKeyboard()
                    }
                },
                filteredConversations = filteredConversations,
                conversationSearchActive = conversationSearchActive,
                activeConversation = activeConversation,
                enabledProviders = enabledProviders,
                activeProvider = activeProvider,
                activeModel = activeModel,
                activeImageModel = activeImageModel,
                activeProviderKeyMissing = activeProviderKeyMissing,
                composerMode = composerMode,
                onComposerModeChange = { composerModeName = it.name },
                imageTask = imageTask,
                onImageTaskChange = { imageTaskName = it.name },
                chatSetupHint = chatSetupHint,
                emptyStateSettingsActionLabel = emptyStateSettingsActionLabel,
                showProviderModelFeatureHint = shouldShowFeatureHint(
                    data.preferences.dismissedFeatureHints,
                    ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID,
                ),
                showCloudSyncFeatureHint = shouldShowFeatureHint(
                    data.preferences.dismissedFeatureHints,
                    ANDROID_CLOUD_SYNC_FEATURE_HINT_ID,
                ),
                persistentNotice = localSnapshotRecoveryNotice,
                mainNotice = mainNotice,
                manualSyncRefreshing = manualSyncRefreshing,
                manualSyncBlockedReason = manualSyncBlockedReason(),
                input = input,
                onInputChange = { input = it },
                focusRequester = composerFocusRequester,
                sourceImage = sourceImage,
                maskImage = maskImage,
                editing = editingMessageId != null,
                streaming = isGenerating,
                canSend = composerCanSend,
                onProviderModelSelected = { provider, model ->
                    val now = nowMillis()
                    commit(
                        applyProviderModelSelection(
                            snapshot = data,
                            existingConversation = activeConversation,
                            provider = provider,
                            selectedModel = model,
                            imageMode = composerMode == ComposerMode.Image,
                            now = now,
                            fallbackTitle = i18n.t("title.newChat"),
                            newConversationId = newId(),
                        ),
                    )
                },
                onDismissProviderModelFeatureHint = {
                    val dismissed = dismissFeatureHintId(
                        data.preferences.dismissedFeatureHints,
                        ANDROID_PROVIDER_MODEL_FEATURE_HINT_ID,
                    )
                    if (dismissed != data.preferences.dismissedFeatureHints) {
                        commit(
                            data.copy(
                                preferences = data.preferences.copy(
                                    dismissedFeatureHints = dismissed,
                                ),
                            ),
                        )
                    }
                },
                onDismissCloudSyncFeatureHint = {
                    val dismissed = dismissFeatureHintId(
                        data.preferences.dismissedFeatureHints,
                        ANDROID_CLOUD_SYNC_FEATURE_HINT_ID,
                    )
                    if (dismissed != data.preferences.dismissedFeatureHints) {
                        commit(
                            data.copy(
                                preferences = data.preferences.copy(
                                    dismissedFeatureHints = dismissed,
                                ),
                            ),
                        )
                    }
                },
                providerDisplayName = { provider -> providerDisplayName(provider, i18n) },
                chatModelsForProvider = ::chatModelsForProvider,
                imageModelsForProvider = ::imageModelsForProvider,
                onSelectConversation = ::selectConversation,
                onDeleteConversation = { conversationPendingDeleteId = it.id },
                onManualSync = { pullToRefreshSync() },
                onOpenSyncSettings = { openSettings(initialTab = SettingsTab.Sync) },
                onEditMessage = { message ->
                    if (message.role == MessageRole.User) {
                        input = message.content
                        editingMessageId = message.id
                        composerModeName = ComposerMode.Chat.name
                    }
                },
                onRegenerateMessage = { message ->
                    val retryPrompt = activeConversation?.let { conversation ->
                        imageRetryPrompt(conversation, message)
                    }
                    if (retryPrompt != null) {
                        input = retryPrompt
                        editingMessageId = null
                        composerModeName = ComposerMode.Image.name
                        return@ChatConversationPane
                    }
                    val lastUser = activeConversation?.messages
                        ?.takeWhile { it.id != message.id }
                        ?.lastOrNull { it.role == MessageRole.User }
                    if (activeConversation != null && lastUser != null) {
                        input = lastUser.content
                        editingMessageId = lastUser.id
                        sendChatMessage(activeConversation, lastUser.content, lastUser.id)
                    } else {
                        mainNotice = InlineNotice(i18n.t("message.noRegenerate"), NoticeKind.Warning)
                    }
                },
                onDeleteMessage = { message ->
                    val conversation = activeConversation
                    if (conversation != null) {
                        commit(deleteMessage(data, conversation.id, message.id, nowMillis()))
                        mainNotice = InlineNotice(i18n.t("message.messageDeleted"), NoticeKind.Warning)
                    }
                },
                speakingMessageId = speakingMessageId,
                onSpeakMessage = ::speakMessage,
                onStopSpeaking = { stopSpeaking() },
                onOpenEmptyStateSettings = {
                    openSettings(
                        initialTab = when (emptyStateTarget) {
                            ChatSetupSettingsTarget.Providers -> SettingsTab.Providers
                            ChatSetupSettingsTarget.Models -> SettingsTab.Models
                            ChatSetupSettingsTarget.Appearance -> SettingsTab.Appearance
                        },
                    )
                },
                onPickSource = { sourcePicker.launch("image/*") },
                onClearSource = {
                    sourceImageUriString = null
                    sourceImage = null
                },
                onPickMask = { maskPicker.launch("image/*") },
                onClearMask = {
                    maskImageUriString = null
                    maskImage = null
                },
                onCancelEdit = {
                    input = ""
                    editingMessageId = null
                },
                onStopGenerating = {
                    chatStreamingJob?.cancel()
                    imageGenerationJob?.cancel()
                },
                onSend = {
                    val conversation = activeConversation ?: createChat() ?: return@ChatConversationPane
                    if (composerMode == ComposerMode.Chat) {
                        sendChatMessage(conversation, input, editingMessageId)
                    } else {
                        generateImageMessage(conversation, input)
                    }
                },
                onDismissKeyboard = ::dismissKeyboard,
                i18n = i18n,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .imePadding(),
            )
        }

        if (settingsOpen) {
            ChatSettingsSheet(
                snapshot = data,
                initialTabName = settingsInitialTabName,
                noticeContent = {
                    InlineNoticeView(localSnapshotRecoveryNotice)
                    InlineNoticeView(settingsNotice)
                },
                onTabChanged = { settingsNotice = null },
                onDismiss = { closeSettings() },
                onDismissKeyboard = ::dismissKeyboard,
                onSnapshotChange = ::commit,
                onSnapshotReduce = { reducer -> onSnapshotReduce(reducer, true) },
                onSaveProviderKey = onSaveProviderKey,
                onDeleteProvider = onDeleteProvider,
                onSaveGithubToken = onSaveGithubToken,
                onSaveSyncPassphrase = onSaveSyncPassphrase,
                onLocalSnapshotChange = ::commitLocalSettings,
                backupTaskViewModel = backupTaskViewModel,
                onResetLocalData = onResetLocalData,
                onFirstSyncStrategy = { strategy ->
                    if (localSnapshotRecoveryNotice != null) {
                        settingsNotice = localSnapshotRecoveryNotice
                    } else {
                        settingsNotice = null
                        onFirstSyncStrategy(strategy)
                    }
                },
                secretStore = secretStore,
                syncClient = syncClient,
                aiClient = aiClient,
                manualSyncRunning = manualSyncRefreshing,
                manualSyncBlockedReason = manualSyncBlockedReason(),
                onManualSyncClick = {
                    runManualCloudSync(
                        noticeTarget = { notice -> settingsNotice = notice },
                        syncedNotice = { synced ->
                            val presentation = syncSettingsStatusPresentation(
                                sync = synced.sync,
                                syncStatusMessage = i18n::syncStatusMessage,
                                localizedConflictMessage = i18n.t("error.firstSyncConflict"),
                            )
                            manualCloudSyncSettingsStatusNotice(
                                status = synced.sync.lastSyncStatus,
                                isFirstSyncConflict = presentation.isFirstSyncConflict,
                                syncStatusMessage = i18n::syncStatusMessage,
                            )
                        },
                    )
                },
                onNotice = { message, kind -> settingsNotice = settingsNotice(message, kind) },
                providerDisplayName = { provider -> providerDisplayName(provider, i18n) },
                providerRequest = ::providerRequest,
                i18n = i18n,
                generationTasks = generationTasks,
            )
        }

        conversationPendingDelete?.let { target ->
            ConversationDeleteDialog(
                conversation = target,
                i18n = i18n,
                onDismiss = { conversationPendingDeleteId = null },
                onConfirm = {
                    commit(deleteConversation(data, target.id))
                    conversationPendingDeleteId = null
                    mainNotice = InlineNotice(i18n.t("message.conversationDeleted"), NoticeKind.Warning)
                },
            )
        }
    }
}
