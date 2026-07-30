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
import androidx.compose.runtime.rememberCoroutineScope
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
import app.zerochat.client.R
import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.LocalSnapshotRecoveryGate
import app.zerochat.data.LocalSnapshotRecoveryIssue
import app.zerochat.data.LocalSnapshotTooLargeException
import app.zerochat.data.LocalResetIntentMetadata
import app.zerochat.data.ProviderKeyImportIntentMetadata
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.ZeroChatRepository
import app.zerochat.data.defaultChatModelForProvider
import app.zerochat.data.defaultProviderConfigs
import app.zerochat.data.defaultProviderIds
import app.zerochat.data.localResetSnapshotFingerprint
import app.zerochat.data.normalizeOfficialProviderContracts
import app.zerochat.security.SecretStore
import app.zerochat.sync.AndroidSyncStatusNotifier
import app.zerochat.sync.AutoSyncCoordinator
import app.zerochat.sync.FirstSyncStrategy
import app.zerochat.sync.SharedPreferencesGistCursorStorage
import app.zerochat.sync.SyncClient
import app.zerochat.ui.settings.commitProviderDeletionTransaction
import app.zerochat.ui.settings.commitProviderKeyImportRecoveryTransaction
import app.zerochat.ui.settings.commitProviderKeyImportTransaction
import app.zerochat.ui.settings.commitProviderKeySaveTransaction
import app.zerochat.ui.settings.commitLocalResetRecoveryTransaction
import app.zerochat.ui.settings.commitLocalResetTransaction
import app.zerochat.ui.settings.commitSyncPassphraseSaveTransaction
import app.zerochat.ui.settings.providerSettingsDeleteProvider
import app.zerochat.ui.settings.providerSettingsReplaceProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val BrandPrimaryLight = Color(0xFF6366F1)
private val BrandPrimaryDark = Color(0xFF818CF8)
private val BrandSoftLight = Color(0xFFEEF2FF)
private val BrandSoftDark = Color(0xFF1E1B4B)
private val BrandBorderLight = Color(0xFFA5B4FC)
private val BrandBorderDark = Color(0xFF4338CA)

private val ZeroChatLightColorScheme = lightColorScheme(
    primary = BrandPrimaryLight,
    onPrimary = Color.White,
    primaryContainer = BrandSoftLight,
    onPrimaryContainer = Color(0xFF1E1B4B),
    secondary = Color(0xFF4F46E5),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE0E7FF),
    onSecondaryContainer = Color(0xFF312E81),
    tertiary = Color(0xFF3B82F6),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDBEAFE),
    onTertiaryContainer = Color(0xFF1E3A8A),
    background = Color(0xFFFAFBFC),
    onBackground = Color(0xFF111827),
    surface = Color(0xFFFAFBFC),
    onSurface = Color(0xFF111827),
    surfaceVariant = Color(0xFFF4F6F8),
    onSurfaceVariant = Color(0xFF4B5563),
    outline = Color(0xFFE5E7EB),
    outlineVariant = Color(0xFFF3F4F6),
    error = Color(0xFFB3261E),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val ZeroChatDarkColorScheme = darkColorScheme(
    primary = BrandPrimaryDark,
    onPrimary = Color(0xFF111827),
    primaryContainer = BrandSoftDark,
    onPrimaryContainer = Color(0xFFE0E7FF),
    secondary = Color(0xFFA5B4FC),
    onSecondary = Color(0xFF111827),
    secondaryContainer = Color(0xFF312E81),
    onSecondaryContainer = Color(0xFFE0E7FF),
    tertiary = Color(0xFF93C5FD),
    onTertiary = Color(0xFF111827),
    tertiaryContainer = Color(0xFF1E3A8A),
    onTertiaryContainer = Color(0xFFDBEAFE),
    background = Color(0xFF0F1117),
    onBackground = Color(0xFFF9FAFB),
    surface = Color(0xFF0F1117),
    onSurface = Color(0xFFF9FAFB),
    surfaceVariant = Color(0xFF1E2230),
    onSurfaceVariant = Color(0xFF9CA3AF),
    outline = Color(0xFF2D3348),
    outlineVariant = Color(0xFF1F2437),
    error = Color(0xFFFFB4AB),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
)

@Composable
fun ZeroChatApp(quickAskRequestId: Long = 0L) {
    val context = LocalContext.current
    val repository = remember { ZeroChatRepository(context) }
    val localSnapshotRecoveryGate = remember { LocalSnapshotRecoveryGate() }
    val secretStore = remember { SecretStore(context) }
    val committedSnapshots = remember { CommittedSnapshotBaseline() }
    var snapshot by remember { mutableStateOf<AppSnapshot?>(null) }
    var snapshotRevision by remember { mutableLongStateOf(0L) }
    var startupNotice by remember { mutableStateOf<String?>(null) }
    var localSaveNotice by remember { mutableStateOf<String?>(null) }
    var localSnapshotIssue by remember { mutableStateOf<LocalSnapshotRecoveryIssue?>(null) }
    val syncStatusNotifier = remember {
        AndroidSyncStatusNotifier(
            context,
            NativeI18n.forMode("system").syncNotificationLabels(),
        )
    }
    val autoSync = remember {
        AutoSyncCoordinator(
            repository,
            secretStore,
            SyncClient(gistCursorStorage = SharedPreferencesGistCursorStorage(context)),
            statusNotifier = syncStatusNotifier,
            statusLabel = { statusSnapshot, status ->
                NativeI18n.forMode(statusSnapshot.preferences.language).syncStatusMessage(status)
            },
        )
    }
    val scope = rememberCoroutineScope()
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
        var commit: SnapshotCommit? = null
        val result = localSnapshotRecoveryGate.persist(recovery) {
            commit = repository.save(candidate)
        }
        localSnapshotIssue = localSnapshotRecoveryGate.issue
        return result.map {
            checkNotNull(commit).also(committedSnapshots::advance)
        }
    }

    fun localSaveFailureMessage(error: Throwable, languageMode: String): String {
        val i18n = NativeI18n.forMode(languageMode)
        return "${i18n.t("message.localDataSaveFailedPrefix")}: ${i18n.errorMessage(error.message)}"
    }

    fun acceptSyncedSnapshot(source: AppSnapshot, commit: SnapshotCommit) {
        publishSnapshot(committedSnapshots.acceptSynced(snapshot, source, commit))
    }

    LaunchedEffect(notificationLanguageMode) {
        syncStatusNotifier.updateLabels(
            NativeI18n.forMode(notificationLanguageMode).syncNotificationLabels(),
        )
    }

    LaunchedEffect(repository) {
        syncStatusNotifier.ensureChannel()
        val loadedSnapshotResult = runCatchingPreservingCancellation {
            SnapshotPersistence.queue.runSerially { repository.load() }
        }
        val pendingImportRestoreFailure = if (loadedSnapshotResult.isFailure) {
            runCatchingPreservingCancellation {
                withContext(Dispatchers.IO) {
                    secretStore.restorePendingProviderKeyImportAfterSnapshotLoadFailure()
                }
            }.exceptionOrNull()
        } else {
            null
        }
        val loadedSnapshot = loadedSnapshotResult.getOrElse { error ->
            pendingImportRestoreFailure?.let(error::addSuppressed)
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
            SnapshotPersistence.queue.runSerially {
                persistLocalSnapshot(normalized)
            }.fold(
                onSuccess = {
                    autoSync.enqueue(normalized, onSynced = ::acceptSyncedSnapshot)
                },
                onFailure = { error ->
                    localSaveNotice = localSaveFailureMessage(error, normalized.preferences.language)
                },
            )
        }
    }

    suspend fun importSnapshot(
        imported: AppSnapshot,
        importedProviderKeys: Map<String, String>,
    ): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            autoSync.runExclusiveSnapshotReplacement {
                SnapshotPersistence.queue.runSerially {
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
        result.onSuccess {
            committed?.let { commit ->
                SnapshotPersistence.launch {
                    autoSync.enqueue(commit.snapshot, onSynced = ::acceptSyncedSnapshot)
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

    suspend fun resetLocalData(requested: AppSnapshot): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            autoSync.runExclusiveLocalReset {
                SnapshotPersistence.queue.runSerially {
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
        publishSnapshot(committed)
        SnapshotPersistence.queue.enqueue {
            persistLocalSnapshot(committed).fold(
                onSuccess = {
                    localSaveNotice = null
                    if (shouldSync) {
                        SnapshotPersistence.launch {
                            autoSync.enqueue(committed, onSynced = ::acceptSyncedSnapshot)
                        }
                    }
                },
                onFailure = { error ->
                    publishSnapshot(committedSnapshots.rollbackFailed(snapshot, committed))
                    localSaveNotice = localSaveFailureMessage(
                        error,
                        committed.preferences.language,
                    )
                },
            )
        }
    }

    suspend fun saveProviderKey(providerId: String, value: String): Result<Unit> {
        var committed: SnapshotCommit? = null
        val result = runCatchingPreservingCancellation {
            SnapshotPersistence.queue.runSerially {
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
                val commit = commitProviderKeySaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = sourceRevision,
                    currentRevision = { snapshotRevision },
                    writeProviderKey = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.setProviderKey(providerId, value)
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
                SnapshotPersistence.launch {
                    autoSync.enqueue(commit.snapshot, onSynced = ::acceptSyncedSnapshot)
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
            SnapshotPersistence.queue.runSerially {
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
            SnapshotPersistence.queue.runSerially {
                val source = snapshot ?: error("Local snapshot is not loaded.")
                check(localSnapshotIssue == null) { "Local snapshot recovery is required." }
                if (source.sync.mode == "local") {
                    withContext(NonCancellable + Dispatchers.IO) {
                        secretStore.setSyncPassphrase(value)
                    }
                    return@runSerially
                }

                val now = System.currentTimeMillis()
                val candidate = source.copy(updatedAt = maxOf(source.updatedAt + 1, now))
                val sourceRevision = snapshotRevision
                val commit = commitSyncPassphraseSaveTransaction(
                    source = source,
                    candidate = candidate,
                    sourceRevision = sourceRevision,
                    currentRevision = { snapshotRevision },
                    writeSyncPassphrase = {
                        withContext(NonCancellable + Dispatchers.IO) {
                            secretStore.setSyncPassphrase(value)
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
                SnapshotPersistence.launch {
                    autoSync.enqueue(commit.snapshot, onSynced = ::acceptSyncedSnapshot)
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
            SnapshotPersistence.queue.runSerially {
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
                SnapshotPersistence.launch {
                    autoSync.enqueue(commit.snapshot, onSynced = ::acceptSyncedSnapshot)
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
                    quickAskRequestId = quickAskRequestId,
                    secretStore = secretStore,
                    onFirstSyncStrategy = { strategy: FirstSyncStrategy ->
                        if (localSnapshotIssue == null) {
                            scope.launch {
                                autoSync.enqueue(current, strategy, ::acceptSyncedSnapshot)
                            }
                        }
                    },
                    onManualSync = { source ->
                        SnapshotPersistence.queue.runSerially {
                            persistLocalSnapshot(source)
                        }.getOrThrow()
                        autoSync.syncNow(source, onSynced = ::acceptSyncedSnapshot)
                    },
                    onSnapshotImport = ::importSnapshot,
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
            onPrimary = Color(0xFF111827),
            primaryContainer = BrandSoftDark,
            onPrimaryContainer = Color(0xFFE0E7FF),
            outline = BrandBorderDark,
        )
    } else {
        copy(
            primary = BrandPrimaryLight,
            onPrimary = Color.White,
            primaryContainer = BrandSoftLight,
            onPrimaryContainer = Color(0xFF1E1B4B),
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
