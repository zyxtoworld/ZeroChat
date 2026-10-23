package app.zerochat.ui

import android.content.Context
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.zerochat.ZeroChatApplication
import app.zerochat.client.R
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.LocalSnapshotRecoveryIssue
import app.zerochat.data.LocalSnapshotTooLargeException
import app.zerochat.data.LocalResetIntentMetadata
import app.zerochat.data.ProviderKeyImportIntentMetadata
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SyncPassphraseIntentMetadata
import app.zerochat.data.defaultChatModelForProvider
import app.zerochat.data.defaultProviderConfigs
import app.zerochat.data.defaultProviderIds
import app.zerochat.data.localResetSnapshotFingerprint
import app.zerochat.data.normalizeOfficialProviderContracts
import app.zerochat.security.SecretStore
import app.zerochat.security.restorePendingSecretTransactionsAfterSnapshotLoadFailure
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.ui.chat.GenerationTaskOwner
import app.zerochat.ui.settings.commitProviderDeletionTransaction
import app.zerochat.ui.settings.commitProviderKeyImportRecoveryTransaction
import app.zerochat.ui.settings.commitProviderKeyImportTransaction
import app.zerochat.ui.settings.commitProviderKeySnapshotSaveTransaction
import app.zerochat.ui.settings.commitLocalResetRecoveryTransaction
import app.zerochat.ui.settings.commitLocalResetTransaction
import app.zerochat.ui.settings.commitSyncPassphraseSnapshotTransaction
import app.zerochat.ui.settings.BackupTaskViewModel
import app.zerochat.ui.settings.SettingsTab
import app.zerochat.ui.settings.providerSettingsDeleteProvider
import app.zerochat.ui.settings.providerSettingsReplaceProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

// ZeroChat current design tokens (mirrors src/app/app.css).
private val BrandPrimaryLight = Color(0xFF0A7CFF)
private val BrandPrimaryDark = Color(0xFF3B93FF)
private val BrandSoftLight = Color(0x1A0A7CFF)
private val BrandSoftDark = Color(0x293B93FF)
private val BrandBorderLight = Color(0xFFCDD2DA)
private val BrandBorderDark = Color(0xFF384050)

private val ZeroChatLightColorScheme = lightColorScheme(
    primary = BrandPrimaryLight,
    onPrimary = Color.White,
    primaryContainer = BrandSoftLight,
    onPrimaryContainer = Color(0xFF0A3C7A),
    secondary = Color(0xFF0069E0),
    onSecondary = Color.White,
    secondaryContainer = Color(0x1A0A7CFF),
    onSecondaryContainer = Color(0xFF0A3C7A),
    tertiary = Color(0xFF17803D),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDCFCE7),
    onTertiaryContainer = Color(0xFF14532D),
    background = Color(0xFFF7F8FA),
    onBackground = Color(0xFF16181D),
    surface = Color(0xFFF7F8FA),
    onSurface = Color(0xFF16181D),
    surfaceVariant = Color(0xFFEEF0F3),
    onSurfaceVariant = Color(0xFF5B6472),
    outline = Color(0xFFE3E6EB),
    outlineVariant = Color(0xFFF0F2F5),
    error = Color(0xFFD93025),
    errorContainer = Color(0x14D93025),
    onErrorContainer = Color(0xFF7A1A12),
)

private val ZeroChatDarkColorScheme = darkColorScheme(
    primary = BrandPrimaryDark,
    onPrimary = Color(0xFF0B1220),
    primaryContainer = BrandSoftDark,
    onPrimaryContainer = Color(0xFFCFE3FF),
    secondary = Color(0xFF63AAFF),
    onSecondary = Color(0xFF0B1220),
    secondaryContainer = Color(0x293B93FF),
    onSecondaryContainer = Color(0xFFCFE3FF),
    tertiary = Color(0xFF4CC38A),
    onTertiary = Color(0xFF0B1220),
    tertiaryContainer = Color(0xFF14532D),
    onTertiaryContainer = Color(0xFFDCFCE7),
    background = Color(0xFF0F1115),
    onBackground = Color(0xFFE8EAF0),
    surface = Color(0xFF0F1115),
    onSurface = Color(0xFFE8EAF0),
    surfaceVariant = Color(0xFF1C2029),
    onSurfaceVariant = Color(0xFFA4ADBC),
    outline = Color(0xFF262B36),
    outlineVariant = Color(0xFF1A1E26),
    error = Color(0xFFF0665C),
    errorContainer = Color(0x24F0665C),
    onErrorContainer = Color(0xFFFFDAD6),
)

@Composable
fun ZeroChatApp(
    quickAskDeliveryCount: Long = 0L,
    backupTaskViewModel: BackupTaskViewModel,
) {
    val context = LocalContext.current
    val application = context.applicationContext as ZeroChatApplication
    var runtimeReady by remember(application) { mutableStateOf(false) }
    LaunchedEffect(application) {
        withContext(Dispatchers.Default) {
            application.runtime
        }
        runtimeReady = true
    }
    if (!runtimeReady) {
        ZeroChatTheme("system") {
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .semantics { testTagsAsResourceId = true },
            ) {
                AppLoadingState()
            }
        }
        return
    }
    val runtime = application.runtime
    val repository = runtime.repository
    val localSnapshotRecoveryGate = runtime.localSnapshotRecoveryGate
    val secretStore = runtime.secretStore
    val committedSnapshots = runtime.committedSnapshots
    val syncStatusNotifier = runtime.syncStatusNotifier
    val autoSync = runtime.autoSync
    val persistence = runtime.persistence
    var snapshot by remember { mutableStateOf<AppSnapshot?>(null) }
    var snapshotRevision by remember { mutableLongStateOf(0L) }
    var startupNotice by remember { mutableStateOf<String?>(null) }
    var localSaveNotice by remember { mutableStateOf<String?>(null) }
    var localSnapshotIssue by remember {
        mutableStateOf<LocalSnapshotRecoveryIssue?>(localSnapshotRecoveryGate.issue)
    }
    var settingsOpen by rememberSaveable { mutableStateOf(false) }
    var settingsInitialTabName by rememberSaveable { mutableStateOf(SettingsTab.Appearance.name) }
    val generationTasks = remember { GenerationTaskOwner() }
    val notificationLanguageMode = snapshot?.preferences?.language ?: "system"

    fun publishSnapshot(next: AppSnapshot?) {
        if (snapshot != next) {
            snapshot = next
            snapshotRevision += 1
        }
    }

    suspend fun persistLocalSnapshot(
        candidate: AppSnapshot,
        recovery: Boolean = false,
    ): Result<SnapshotCommit> {
        val result = runtime.persistLocalSnapshot(candidate, recovery)
        localSnapshotIssue = localSnapshotRecoveryGate.issue
        return result
    }

    fun localSaveFailureMessage(error: Throwable, languageMode: String): String {
        val i18n = NativeI18n.forMode(languageMode)
        return "${i18n.t("message.localDataSaveFailedPrefix")}: ${i18n.errorMessage(error.message)}"
    }

    LaunchedEffect(persistence) {
        persistence.events.collect { events ->
            events.forEach { event ->
                try {
                    when (event) {
                        is SnapshotPersistenceEvent.Persisted -> {
                            localSaveNotice = null
                            localSnapshotIssue = localSnapshotRecoveryGate.issue
                        }
                        is SnapshotPersistenceEvent.Failed -> {
                            publishSnapshot(
                                committedSnapshots.rollbackFailed(snapshot, event.source),
                            )
                            localSnapshotIssue = localSnapshotRecoveryGate.issue
                            localSaveNotice = localSaveFailureMessage(
                                event.error,
                                event.source.preferences.language,
                            )
                        }
                        is SnapshotPersistenceEvent.Synced -> {
                            publishSnapshot(
                                committedSnapshots.acceptSynced(
                                    current = snapshot,
                                    source = event.source,
                                    commit = event.commit,
                                ),
                            )
                        }
                    }
                } finally {
                    persistence.acknowledge(event.sequence)
                }
            }
        }
    }

    LaunchedEffect(notificationLanguageMode) {
        syncStatusNotifier.updateLabels(
            NativeI18n.forMode(notificationLanguageMode).syncNotificationLabels(),
        )
    }

    LaunchedEffect(repository) {
        syncStatusNotifier.ensureChannel()
        val loadedSnapshotResult = runCatchingPreservingCancellation {
            persistence.runSnapshotMutation { repository.load() }
        }
        val pendingRestoreFailure = if (loadedSnapshotResult.isFailure) {
            runCatchingPreservingCancellation {
                withContext(Dispatchers.IO) {
                    restorePendingSecretTransactionsAfterSnapshotLoadFailure(secretStore)
                }
            }.exceptionOrNull()
        } else {
            null
        }
        val loadedSnapshot = loadedSnapshotResult.getOrElse { error ->
            pendingRestoreFailure?.let(error::addSuppressed)
            localSnapshotRecoveryGate.markLoadFailed()
            localSnapshotIssue = localSnapshotRecoveryGate.issue
            val i18n = NativeI18n.forMode("system")
            val detail = if (error is LocalSnapshotTooLargeException) {
                i18n.t("message.fileTooLarge").replace(
                    "{maxMb}",
                    (error.maxBytes / 1_000_000).toString(),
                )
            } else {
                i18n.errorMessage(error.message)
            }
            startupNotice = "${i18n.t("message.localDataLoadFailedPrefix")}: $detail"
            AppSnapshot()
        }
        var credentialTransactionsReconciled = loadedSnapshotResult.isSuccess
        if (loadedSnapshotResult.isSuccess) {
            runCatchingPreservingCancellation {
                withContext(Dispatchers.IO) {
                    val fingerprint = localResetSnapshotFingerprint(loadedSnapshot)
                    secretStore.reconcilePendingLocalReset(fingerprint)
                    secretStore.reconcilePendingProviderKeyImport(fingerprint)
                    secretStore.reconcilePendingSyncPassphrase(fingerprint)
                }
            }.onFailure { error ->
                credentialTransactionsReconciled = false
                localSnapshotRecoveryGate.markLoadFailed()
                localSnapshotIssue = localSnapshotRecoveryGate.issue
                startupNotice = localSaveFailureMessage(
                    error,
                    loadedSnapshot.preferences.language,
                )
            }
        }
        val loaded = loadedSnapshot.let {
            if (it.providers.isEmpty()) {
                val i18n = NativeI18n.forMode(it.preferences.language)
                it.copy(
                    providers = defaultProviderConfigs(i18n.t("provider.preset.custom-openai-relay")),
                    preferences = it.preferences.copy(firstRunDone = true),
                    updatedAt = System.currentTimeMillis(),
                )
            } else {
                it
            }
        }
        val normalized = normalizeOfficialProviderContracts(loaded)
        if (credentialTransactionsReconciled) {
            runCatchingPreservingCancellation {
                withContext(Dispatchers.IO) {
                    secretStore.reconcilePendingProviderDeletions(
                        normalized.providers.map { it.id }.toSet(),
                    )
                }
            }.onFailure { error ->
                startupNotice = localSaveFailureMessage(error, normalized.preferences.language)
            }
        }
        publishSnapshot(normalized)
        committedSnapshots.initialize(loaded)

        if (normalized != loaded && localSnapshotIssue == null) {
            persistence.enqueueSnapshot(normalized, shouldSync = true)
        }
    }

    suspend fun importSnapshot(
        imported: AppSnapshot,
        importedProviderKeys: Map<String, String>,
    ): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            persistence.runSnapshotReplacement {
                generationTasks.withDrain {
                    autoSync.runExclusiveSnapshotReplacement {
                    val source = snapshot ?: error("Local snapshot is not loaded.")
                    val recovery = localSnapshotIssue != null
                    val pending = if (recovery) {
                        withContext(Dispatchers.IO) {
                            secretStore.pendingProviderKeyImportIntent()
                        }
                    } else {
                        null
                    }
                    val candidate = imported.copy(
                        updatedAt = pending?.replacementUpdatedAt ?: maxOf(
                            imported.updatedAt,
                            source.updatedAt + 1,
                            System.currentTimeMillis(),
                        ),
                    )
                    val requestedIntent = ProviderKeyImportIntentMetadata(
                        sourceFingerprint = if (recovery) null else {
                            localResetSnapshotFingerprint(source)
                        },
                        replacementFingerprint = localResetSnapshotFingerprint(candidate),
                        replacementUpdatedAt = candidate.updatedAt,
                    )
                    val intent = pending ?: requestedIntent
                    pending?.let {
                        check(it.replacementFingerprint == requestedIntent.replacementFingerprint) {
                            "Pending provider credential import does not match this backup."
                        }
                    }
                    val providerIds = linkedSetOf<String>().apply {
                        addAll(source.providers.map { it.id })
                        addAll(candidate.providers.map { it.id })
                        addAll(defaultProviderIds())
                    }
                    val replacements = providerIds.associateWith { providerId ->
                        importedProviderKeys[providerId].orEmpty()
                    }
                    val sourceRevision = snapshotRevision
                    val persisted = localSnapshotRecoveryGate.persist(recovery = recovery) {
                        committed = if (recovery) {
                            commitProviderKeyImportRecoveryTransaction(
                                stageProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.stageProviderKeyImport(intent, replacements)
                                    }
                                },
                                saveSnapshot = { repository.save(candidate) },
                                finishProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.finishProviderKeyImport(intent)
                                    }
                                },
                                restoreProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.restoreProviderKeyImport(intent)
                                    }
                                },
                            )
                        } else {
                            commitProviderKeyImportTransaction(
                                source = source,
                                candidate = candidate,
                                sourceRevision = sourceRevision,
                                currentRevision = { snapshotRevision },
                                stageProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.stageProviderKeyImport(intent, replacements)
                                    }
                                },
                                finishProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.finishProviderKeyImport(intent)
                                    }
                                },
                                restoreProviderKeys = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.restoreProviderKeyImport(intent)
                                    }
                                },
                                compareAndSetSnapshot = repository::compareAndSet,
                            )
                        }
                    }
                    localSnapshotIssue = localSnapshotRecoveryGate.issue
                    persisted.getOrThrow()
                    val commit = checkNotNull(committed)
                    committedSnapshots.advance(commit)
                    publishSnapshot(commit.snapshot)
                    startupNotice = null
                    localSaveNotice = null
                }
            }
            }
        }
        result.onSuccess {
            committed?.let { commit ->
                persistence.launch {
                    autoSync.enqueue(commit.snapshot)
                }
            }
        }.onFailure { error ->
            localSnapshotIssue = localSnapshotRecoveryGate.issue
            localSaveNotice = localSaveFailureMessage(
                error,
                snapshot?.preferences?.language ?: "system",
            )
        }
        return result.map { Unit }
    }

    LaunchedEffect(backupTaskViewModel) {
        backupTaskViewModel.tasks.importRequests.collect { requests ->
            requests.forEach { request ->
                request.executionMutex.withLock {
                    if (backupTaskViewModel.tasks.isImportPending(request.id)) {
                        backupTaskViewModel.tasks.completeImport(
                            request.id,
                            importSnapshot(request.snapshot, request.providerKeys),
                        )
                    }
                }
            }
        }
    }

    suspend fun resetLocalData(requested: AppSnapshot): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            persistence.runSnapshotReplacement {
                generationTasks.withDrain {
                    autoSync.runExclusiveLocalReset {
                    val source = snapshot ?: error("Local snapshot is not loaded.")
                    val recovery = localSnapshotIssue != null
                    val pending = if (recovery) {
                        withContext(Dispatchers.IO) { secretStore.pendingLocalResetIntent() }
                    } else {
                        null
                    }
                    val now = System.currentTimeMillis()
                    val candidate = requested.copy(
                        updatedAt = pending?.replacementUpdatedAt ?: maxOf(
                            requested.updatedAt,
                            source.updatedAt + 1,
                            now,
                        ),
                    )
                    val requestedIntent = LocalResetIntentMetadata(
                        sourceFingerprint = if (recovery) null else {
                            localResetSnapshotFingerprint(source)
                        },
                        replacementFingerprint = localResetSnapshotFingerprint(candidate),
                        replacementUpdatedAt = candidate.updatedAt,
                    )
                    val intent = pending ?: requestedIntent
                    pending?.let {
                        check(it.replacementFingerprint == requestedIntent.replacementFingerprint) {
                            "Pending local credential reset does not match the recovery snapshot."
                        }
                    }
                    val sourceRevision = snapshotRevision
                    val persisted = localSnapshotRecoveryGate.persist(recovery = recovery) {
                        committed = if (recovery) {
                            commitLocalResetRecoveryTransaction(
                                stageCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.stageLocalReset(intent)
                                    }
                                },
                                saveSnapshot = { repository.save(candidate) },
                                finishCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.finishLocalReset(intent)
                                    }
                                },
                                restoreCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.restoreLocalReset(intent)
                                    }
                                },
                            )
                        } else {
                            commitLocalResetTransaction(
                                source = source,
                                candidate = candidate,
                                sourceRevision = sourceRevision,
                                currentRevision = { snapshotRevision },
                                stageCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.stageLocalReset(intent)
                                    }
                                },
                                finishCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.finishLocalReset(intent)
                                    }
                                },
                                restoreCredentials = {
                                    withContext(NonCancellable + Dispatchers.IO) {
                                        secretStore.restoreLocalReset(intent)
                                    }
                                },
                                compareAndSetSnapshot = repository::compareAndSet,
                            )
                        }
                    }
                    localSnapshotIssue = localSnapshotRecoveryGate.issue
                    persisted.getOrThrow()
                    val commit = checkNotNull(committed)
                    committedSnapshots.advance(commit)
                    publishSnapshot(commit.snapshot)
                    startupNotice = null
                    localSaveNotice = null
                }
            }
            }
        }
        result.onFailure { error ->
            localSnapshotIssue = localSnapshotRecoveryGate.issue
            localSaveNotice = localSaveFailureMessage(
                error,
                snapshot?.preferences?.language ?: "system",
            )
        }
        return result.map { Unit }
    }

    fun commitSnapshotUpdate(
        reducer: (AppSnapshot) -> AppSnapshot,
        shouldSync: Boolean,
    ) {
        val active = snapshot ?: return
        val reduced = reducer(active)
        if (reduced == active) {
            return
        }
        val committed = reduced.copy(
            updatedAt = maxOf(
                reduced.updatedAt,
                active.updatedAt + 1,
                System.currentTimeMillis(),
            ),
        )
        persistence.tryEnqueueSnapshot(
            candidate = committed,
            shouldSync = shouldSync,
            beforeEnqueue = { publishSnapshot(committed) },
            onDropped = {
                publishSnapshot(committedSnapshots.rollbackFailed(snapshot, committed))
            },
        )
    }

    suspend fun saveProviderKey(providerId: String, value: String): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            persistence.runSnapshotMutation {
                val source = snapshot ?: error("Local snapshot is not loaded.")
                check(localSnapshotIssue == null) { "Local snapshot recovery is required." }
                val provider = source.providers.firstOrNull { it.id == providerId }
                    ?: error("Provider does not exist.")
                val now = System.currentTimeMillis()
                val candidate = source.copy(
                    providers = providerSettingsReplaceProvider(
                        source.providers,
                        provider.copy(updatedAt = maxOf(provider.updatedAt + 1, now)),
                    ),
                    updatedAt = maxOf(source.updatedAt + 1, now),
                )
                val sourceRevision = snapshotRevision
                val intent = ProviderKeyImportIntentMetadata(
                    sourceFingerprint = localResetSnapshotFingerprint(source),
                    replacementFingerprint = localResetSnapshotFingerprint(candidate),
                    replacementUpdatedAt = candidate.updatedAt,
                )
                val commit = commitProviderKeySnapshotSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = sourceRevision,
                    currentRevision = { snapshotRevision },
                    stageProviderKey = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.stageProviderKeyImport(intent, mapOf(providerId to value))
                        }
                    },
                    finishProviderKey = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.finishProviderKeyImport(intent)
                        }
                    },
                    restoreProviderKey = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.restoreProviderKeyImport(intent)
                        }
                    },
                    compareAndSetSnapshot = repository::compareAndSet,
                )
                committedSnapshots.advance(commit)
                publishSnapshot(commit.snapshot)
                localSaveNotice = null
                committed = commit
            }
        }
        result.onSuccess {
            committed?.let { commit ->
                persistence.launch {
                    autoSync.enqueue(commit.snapshot)
                }
            }
        }.onFailure { error ->
            localSaveNotice = localSaveFailureMessage(
                error,
                snapshot?.preferences?.language ?: "system",
            )
        }
        return result.map { Unit }
    }

    suspend fun saveGithubToken(value: String): Result<Unit> =
        runCatchingPreservingCancellation {
            persistence.runSnapshotMutation {
                check(snapshot != null) { "Local snapshot is not loaded." }
                check(localSnapshotIssue == null) { "Local snapshot recovery is required." }
                withContext(NonCancellable + Dispatchers.IO) {
                    secretStore.setGithubToken(value)
                }
            }
        }

    suspend fun saveSyncPassphrase(value: String): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            persistence.runSnapshotMutation {
                val source = snapshot ?: error("Local snapshot is not loaded.")
                check(localSnapshotIssue == null) { "Local snapshot recovery is required." }
                if (source.sync.mode == "local") {
                    withContext(NonCancellable + Dispatchers.IO) {
                        secretStore.setSyncPassphrase(value)
                    }
                    return@runSnapshotMutation
                }

                val now = System.currentTimeMillis()
                val candidate = source.copy(updatedAt = maxOf(source.updatedAt + 1, now))
                val sourceRevision = snapshotRevision
                val intent = SyncPassphraseIntentMetadata(
                    sourceFingerprint = localResetSnapshotFingerprint(source),
                    replacementFingerprint = localResetSnapshotFingerprint(candidate),
                    replacementUpdatedAt = candidate.updatedAt,
                )
                val commit = commitSyncPassphraseSnapshotTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = sourceRevision,
                    currentRevision = { snapshotRevision },
                    stageSyncPassphrase = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.stageSyncPassphrase(intent, value)
                        }
                    },
                    finishSyncPassphrase = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.finishSyncPassphrase(intent)
                        }
                    },
                    restoreSyncPassphrase = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.restoreSyncPassphrase(intent)
                        }
                    },
                    compareAndSetSnapshot = repository::compareAndSet,
                )
                committedSnapshots.advance(commit)
                publishSnapshot(commit.snapshot)
                localSaveNotice = null
                committed = commit
            }
        }
        result.onSuccess {
            committed?.let { commit ->
                persistence.launch {
                    autoSync.enqueue(commit.snapshot)
                }
            }
        }.onFailure { error ->
            localSaveNotice = localSaveFailureMessage(
                error,
                snapshot?.preferences?.language ?: "system",
            )
        }
        return result.map { Unit }
    }

    suspend fun deleteProvider(providerId: String): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            persistence.runSnapshotMutation {
                val source = snapshot ?: error("Local snapshot is not loaded.")
                check(localSnapshotIssue == null) { "Local snapshot recovery is required." }
                val reduced = providerSettingsDeleteProvider(
                    snapshot = source,
                    deletedProviderId = providerId,
                    fallbackModelForProvider = ::defaultChatModelForProvider,
                    now = System.currentTimeMillis(),
                )
                check(reduced != source) { "Provider cannot be deleted." }
                val candidate = reduced.copy(
                    updatedAt = maxOf(
                        reduced.updatedAt,
                        source.updatedAt + 1,
                        System.currentTimeMillis(),
                    ),
                )
                val sourceRevision = snapshotRevision
                val commit = commitProviderDeletionTransaction(
                    providerId = providerId,
                    source = source,
                    candidate = candidate,
                    sourceRevision = sourceRevision,
                    currentRevision = { snapshotRevision },
                    stageCredentialDeletion = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.stageProviderDeletion(providerId)
                        }
                    },
                    finishCredentialDeletion = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.finishProviderDeletion(providerId)
                        }
                    },
                    cancelCredentialDeletion = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.cancelProviderDeletion(providerId)
                        }
                    },
                    compareAndSetSnapshot = repository::compareAndSet,
                )
                committedSnapshots.advance(commit)
                publishSnapshot(commit.snapshot)
                localSaveNotice = null
                committed = commit
            }
        }
        result.onSuccess {
            committed?.let { commit ->
                persistence.launch {
                    autoSync.enqueue(commit.snapshot)
                }
            }
        }.onFailure { error ->
            localSaveNotice = localSaveFailureMessage(
                error,
                snapshot?.preferences?.language ?: "system",
            )
        }
        return result.map { Unit }
    }

    ZeroChatTheme(snapshot?.preferences?.theme ?: "system") {
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .semantics { testTagsAsResourceId = true },
        ) {
            snapshot?.let { current ->
                ChatScreen(
                    snapshot = current,
                    initialNotice = localSaveNotice ?: startupNotice,
                    localSnapshotIssue = localSnapshotIssue,
                    quickAskDeliveryCount = quickAskDeliveryCount,
                    backupTaskViewModel = backupTaskViewModel,
                    generationTasks = generationTasks,
                    settingsOpen = settingsOpen,
                    settingsInitialTabName = settingsInitialTabName,
                    onSettingsOpen = { tab ->
                        settingsInitialTabName = tab.name
                        settingsOpen = true
                    },
                    onSettingsClose = { settingsOpen = false },
                    secretStore = secretStore,
                    onFirstSyncStrategy = { strategy: FirstSyncStrategy ->
                        if (localSnapshotIssue == null) {
                            persistence.launch {
                                autoSync.enqueue(current, strategy)
                            }
                        }
                    },
                    onManualSync = { source ->
                        persistence.runSnapshotMutation {
                            persistLocalSnapshot(source)
                        }.getOrThrow()
                        autoSync.syncNow(source)
                    },
                    onResetLocalData = ::resetLocalData,
                    onSaveProviderKey = ::saveProviderKey,
                    onDeleteProvider = ::deleteProvider,
                    onSaveGithubToken = ::saveGithubToken,
                    onSaveSyncPassphrase = ::saveSyncPassphrase,
                    onSnapshotChange = { next, shouldSync ->
                        commitSnapshotUpdate({ next }, shouldSync)
                    },
                    onSnapshotReduce = ::commitSnapshotUpdate,
                )
            } ?: AppLoadingState()
        }
    }
}

@Composable
private fun ZeroChatTheme(themeMode: String, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val systemDark = isSystemInDarkTheme()
    val dark = when (themeMode) {
        "light" -> false
        "dark" -> true
        else -> systemDark
    }

    MaterialTheme(
        colorScheme = zeroChatColorScheme(context, dark),
        content = content,
    )
}

private fun zeroChatColorScheme(context: Context, dark: Boolean): ColorScheme =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val dynamicScheme = if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dynamicScheme.withZeroChatBrand(dark)
    } else if (dark) {
        ZeroChatDarkColorScheme
    } else {
        ZeroChatLightColorScheme
    }

private fun ColorScheme.withZeroChatBrand(dark: Boolean): ColorScheme =
    if (dark) {
        copy(
            primary = BrandPrimaryDark,
            onPrimary = Color(0xFF0B1220),
            primaryContainer = BrandSoftDark,
            onPrimaryContainer = Color(0xFFCFE3FF),
            outline = BrandBorderDark,
        )
    } else {
        copy(
            primary = BrandPrimaryLight,
            onPrimary = Color.White,
            primaryContainer = BrandSoftLight,
            onPrimaryContainer = Color(0xFF0A3C7A),
            outline = BrandBorderLight,
        )
    }

@Composable
private fun AppLoadingState() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(
                painter = painterResource(id = R.drawable.ic_launcher_foreground),
                contentDescription = null,
                modifier = Modifier
                    .size(64.dp)
                    .testTag("zerochat-app-icon"),
                tint = Color.Unspecified,
            )
            Text("ZeroChat", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
            CircularProgressIndicator()
        }
    }
}
