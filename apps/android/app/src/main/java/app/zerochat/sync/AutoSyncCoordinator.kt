package app.zerochat.sync

import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderKeyImportIntentMetadata
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SkillSettings
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import app.zerochat.data.SyncVault
import app.zerochat.data.ZeroChatRepository
import app.zerochat.data.defaultProviderIds
import app.zerochat.data.localResetSnapshotFingerprint
import app.zerochat.security.SecretStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AutoSyncCoordinator(
    private val repository: ZeroChatRepository,
    private val secretStore: SecretStore,
    private val syncClient: SyncClient,
    private val crypto: CryptoEngine = CryptoEngine(),
    private val statusNotifier: SyncStatusNotifier? = null,
    private val statusLabel: (AppSnapshot, String?) -> String = { _, status -> status.orEmpty() },
) {
    private val operationMutex = Mutex()
    private val pendingMutex = Mutex()
    private var pending: PendingSync? = null

    suspend fun enqueue(
        snapshot: AppSnapshot,
        firstSyncStrategy: FirstSyncStrategy = FirstSyncStrategy.Ask,
        onSynced: (source: AppSnapshot, commit: SnapshotCommit) -> Unit,
    ) {
        pendingMutex.withLock {
            pending = PendingSync(snapshot, firstSyncStrategy, onSynced)
        }

        operationMutex.withLock {
            drainPending()
        }
    }

    suspend fun syncNow(
        snapshot: AppSnapshot,
        firstSyncStrategy: FirstSyncStrategy = FirstSyncStrategy.Ask,
        onSynced: (source: AppSnapshot, commit: SnapshotCommit) -> Unit,
    ): AppSnapshot? = operationMutex.withLock {
        try {
            processSync(
                snapshot = snapshot,
                firstSyncStrategy = firstSyncStrategy,
                requiresAutoSync = false,
                onSynced = onSynced,
            )
        } finally {
            drainPending()
        }
    }

    suspend fun <T> runExclusiveLocalReset(operation: suspend () -> T): T =
        runExclusiveSnapshotReplacement(operation)

    suspend fun <T> runExclusiveSnapshotReplacement(operation: suspend () -> T): T =
        operationMutex.withLock {
            pendingMutex.withLock { pending = null }
            try {
                operation()
            } finally {
                pendingMutex.withLock { pending = null }
            }
        }

    private suspend fun drainPending() {
        while (true) {
            if (pendingMutex.withLock { pending == null }) {
                return
            }
            // Coalesce rapid settings edits, especially URL fields, before validating and syncing.
            delay(AUTO_SYNC_DEBOUNCE_MS)
            val next = pendingMutex.withLock {
                pending.also { pending = null }
            } ?: return
            processSync(
                snapshot = next.snapshot,
                firstSyncStrategy = next.firstSyncStrategy,
                requiresAutoSync = true,
                onSynced = next.onSynced,
            )
        }
    }

    private suspend fun processSync(
        snapshot: AppSnapshot,
        firstSyncStrategy: FirstSyncStrategy,
        requiresAutoSync: Boolean,
        onSynced: (source: AppSnapshot, commit: SnapshotCommit) -> Unit,
    ): AppSnapshot? {
        val candidate = runCatchingPreservingCancellation {
            syncIfConfigured(
                snapshot = snapshot,
                firstSyncStrategy = firstSyncStrategy,
                requiresAutoSync = requiresAutoSync,
            )
        }.getOrElse { error ->
            val status = error.message?.takeIf { it.isNotBlank() } ?: "Cloud sync failed"
            statusNotifier?.showStatus(statusLabel(snapshot, status), completed = false)
            SyncCandidate(snapshot.withSyncStatus(status, completed = false))
        } ?: return null

        val merged = mergeSyncResult(
            current = snapshot,
            source = snapshot,
            synced = candidate.snapshot,
        )
        val accepted = if (candidate.syncedVault != null) {
            ensureDistinctSyncedProviderKeyCandidate(snapshot, merged)
        } else {
            merged
        }
        val commit = candidate.syncedVault?.let { syncedVault ->
            val intent = withContext(Dispatchers.Default) {
                providerKeyIntentForSyncedSnapshot(snapshot, accepted)
            }
            commitSyncedSnapshotAndProviderKeys(
                source = snapshot,
                candidate = accepted,
                replacements = providerKeyReplacementsForSyncedVault(
                    snapshot,
                    syncedVault.data,
                    syncedVault.secrets.providerKeys,
                ),
                stageProviderKeys = { replacements ->
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
        } ?: repository.compareAndSet(snapshot, accepted)
        if (!commit.committed) {
            if (requiresAutoSync && commit.snapshot.sync.autoSync) {
                pendingMutex.withLock {
                    if (pending == null) {
                        pending = PendingSync(commit.snapshot, FirstSyncStrategy.Ask, onSynced)
                    }
                }
            }
            return null
        }

        if (candidate.syncedVault != null) {
            val status = accepted.sync.lastSyncStatus ?: "Sync complete"
            statusNotifier?.showStatus(statusLabel(accepted, status), completed = true)
        }
        onSynced(snapshot, SnapshotCommit(accepted, commit.revision))
        return accepted
    }

    private suspend fun syncIfConfigured(
        snapshot: AppSnapshot,
        firstSyncStrategy: FirstSyncStrategy,
        requiresAutoSync: Boolean,
    ): SyncCandidate? {
        if (
            snapshot.sync.mode !in setOf("gist", "cloudflare") ||
            (requiresAutoSync && !snapshot.sync.autoSync)
        ) {
            statusNotifier?.clear()
            return null
        }

        val passphrase = secretStore.syncPassphrase()
        if (passphrase.isBlank()) {
            val status = "Cloud sync is waiting for the data encryption password."
            statusNotifier?.showStatus(statusLabel(snapshot, status), completed = false)
            return SyncCandidate(
                snapshot.withSyncStatus(
                    status,
                    completed = false,
                ),
            )
        }

        val completeStatus = "Sync complete"
        val localVault = SyncVault(
            data = snapshot.withSyncStatus(completeStatus, completed = true),
            secrets = ProviderSecrets(providerKeys = providerKeys(snapshot)),
        )
        val syncedVault = when (snapshot.sync.mode) {
            "gist" -> {
                val token = secretStore.githubToken()
                if (token.isBlank()) {
                    val status = "GitHub token is required."
                    statusNotifier?.showStatus(statusLabel(snapshot, status), completed = false)
                    return SyncCandidate(snapshot.withSyncStatus(status, completed = false))
                }

                withContext(Dispatchers.Default) {
                    syncClient.syncGistVault(
                        vault = localVault,
                        passphrase = passphrase,
                        gistId = snapshot.sync.gistId,
                        gistFile = snapshot.sync.gistFile,
                        token = token,
                        firstSyncStrategy = firstSyncStrategy,
                        hasCompletedSync = snapshot.sync.lastSyncAt != null,
                        hasLocalUserContent = hasLocalUserContent(snapshot),
                        hasUnsyncedLocalChanges = hasUnsyncedLocalChanges(snapshot),
                    )
                }
            }
            "cloudflare" -> {
                val workerEndpoint = snapshot.sync.workerEndpoint
                if (workerEndpoint.isNullOrBlank()) {
                    statusNotifier?.clear()
                    return null
                }
                val token = secretStore.cloudflareAccessKey()
                if (token.isBlank()) {
                    val status = "Cloud sync is waiting for the data encryption password."
                    statusNotifier?.showStatus(statusLabel(snapshot, status), completed = false)
                    return SyncCandidate(snapshot.withSyncStatus(status, completed = false))
                }

                withContext(Dispatchers.Default) {
                    syncClient.syncCloudflareVault(
                        vault = localVault,
                        passphrase = passphrase,
                        workerEndpoint = workerEndpoint,
                        token = token,
                        firstSyncStrategy = firstSyncStrategy,
                        hasCompletedSync = snapshot.sync.lastSyncAt != null,
                        hasLocalUserContent = hasLocalUserContent(snapshot),
                        hasUnsyncedLocalChanges = hasUnsyncedLocalChanges(snapshot),
                    )
                }
            }
            else -> return null
        }

        val status = syncedVault.data.sync.lastSyncStatus ?: completeStatus
        return SyncCandidate(
            snapshot = syncedVault.data.withSyncStatus(status, completed = true),
            syncedVault = syncedVault,
        )
    }

    private fun providerKeys(snapshot: AppSnapshot): Map<String, String> =
        snapshot.providers
            .associate { provider -> provider.id to secretStore.providerKey(provider.id) }
            .filterValues { it.isNotBlank() }

    private fun hasLocalUserContent(snapshot: AppSnapshot): Boolean {
        val defaultSkillSettings = SkillSettings()
        return snapshot.conversations.any { it.messages.isNotEmpty() } ||
            hasUserProviderContent(snapshot) ||
            snapshot.skills.isNotEmpty() ||
            snapshot.skillSettings != defaultSkillSettings ||
            snapshot.preferences.theme != "system" ||
            snapshot.preferences.language != "system" ||
            snapshot.preferences.compactMode
    }

    private fun hasUserProviderContent(snapshot: AppSnapshot): Boolean =
        snapshot.providers.any { provider ->
            provider.updatedAt != provider.createdAt ||
                (provider.custom && provider.enabled && !provider.id.startsWith("custom-"))
        }

    private fun AppSnapshot.withSyncStatus(
        status: String,
        completed: Boolean,
    ): AppSnapshot =
        copy(
            sync = sync.copy(
                encryptionEnabled = true,
                lastSyncAt = if (completed) System.currentTimeMillis() else sync.lastSyncAt,
                lastSyncStatus = status,
            ),
        )

    private fun mergeSyncResult(
        current: AppSnapshot,
        source: AppSnapshot,
        synced: AppSnapshot,
    ): AppSnapshot =
        if (synced.updatedAt == source.updatedAt) {
            current.copy(
                sync = current.sync.copy(
                    encryptionEnabled = synced.sync.encryptionEnabled,
                    lastSyncAt = synced.sync.lastSyncAt,
                    lastSyncStatus = synced.sync.lastSyncStatus,
                ),
            )
        } else {
            synced
        }

    private companion object {
        const val AUTO_SYNC_DEBOUNCE_MS = 700L
    }
}

private data class PendingSync(
    val snapshot: AppSnapshot,
    val firstSyncStrategy: FirstSyncStrategy,
    val onSynced: (source: AppSnapshot, commit: SnapshotCommit) -> Unit,
)

private data class SyncCandidate(
    val snapshot: AppSnapshot,
    val syncedVault: SyncVault? = null,
)

internal suspend fun commitSyncedSnapshotAndProviderKeys(
    source: AppSnapshot,
    candidate: AppSnapshot,
    replacements: Map<String, String>,
    stageProviderKeys: suspend (Map<String, String>) -> Unit,
    finishProviderKeys: suspend () -> Unit,
    restoreProviderKeys: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCompareAndSetResult {
    require(candidate != source) { "Synced Provider-key candidate must advance the snapshot." }
    if (replacements.isEmpty()) {
        return compareAndSetSnapshot(source, candidate)
    }

    stageProviderKeys(replacements)
    val commit = try {
        compareAndSetSnapshot(source, candidate)
    } catch (error: Throwable) {
        restoreSyncedProviderKeys(error, restoreProviderKeys)
        throw error
    }

    if (!commit.committed) {
        if (commit.snapshot == candidate) {
            finishProviderKeys()
            return commit.copy(committed = true)
        }
        restoreSyncedProviderKeys(null, restoreProviderKeys)
        return commit
    }

    try {
        finishProviderKeys()
    } catch (error: Throwable) {
        if (
            compensateSyncedProviderKeyFinalization(
                source = source,
                candidate = candidate,
                primaryError = error,
                finishProviderKeys = finishProviderKeys,
                restoreProviderKeys = restoreProviderKeys,
                compareAndSetSnapshot = compareAndSetSnapshot,
            )
        ) {
            return commit
        }
        throw error
    }

    return commit
}

internal fun providerKeyIntentForSyncedSnapshot(
    source: AppSnapshot,
    candidate: AppSnapshot,
): ProviderKeyImportIntentMetadata {
    require(candidate != source) { "Synced Provider-key candidate must advance the snapshot." }
    return ProviderKeyImportIntentMetadata(
        sourceFingerprint = localResetSnapshotFingerprint(source),
        replacementFingerprint = localResetSnapshotFingerprint(candidate),
        replacementUpdatedAt = candidate.updatedAt,
    )
}

internal fun ensureDistinctSyncedProviderKeyCandidate(
    source: AppSnapshot,
    merged: AppSnapshot,
): AppSnapshot =
    if (merged != source) {
        merged
    } else {
        merged.copy(updatedAt = Math.addExact(source.updatedAt, 1L))
    }

private suspend fun compensateSyncedProviderKeyFinalization(
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    finishProviderKeys: suspend () -> Unit,
    restoreProviderKeys: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): Boolean {
    val rollback = try {
        compareAndSetSnapshot(candidate, source)
    } catch (rollbackError: Throwable) {
        primaryError.addSuppressed(rollbackError)
        return false
    }

    return when {
        rollback.committed || rollback.snapshot == source -> {
            restoreSyncedProviderKeys(primaryError, restoreProviderKeys)
            false
        }
        rollback.snapshot == candidate -> {
            try {
                finishProviderKeys()
                true
            } catch (retryError: Throwable) {
                primaryError.addSuppressed(retryError)
                false
            }
        }
        else -> {
            primaryError.addSuppressed(
                IllegalStateException(
                    "Synced Provider-key compensation found an unrelated snapshot.",
                ),
            )
            false
        }
    }
}

private suspend fun restoreSyncedProviderKeys(
    primaryError: Throwable?,
    restoreProviderKeys: suspend () -> Unit,
) {
    try {
        restoreProviderKeys()
    } catch (restoreError: Throwable) {
        if (primaryError == null) {
            throw restoreError
        }
        primaryError.addSuppressed(restoreError)
    }
}

internal fun providerKeyReplacementsForSyncedVault(
    local: AppSnapshot,
    synced: AppSnapshot,
    providerKeys: Map<String, String>,
): Map<String, String> {
    val providerIds = linkedSetOf<String>()
    providerIds.addAll(local.providers.map { it.id })
    providerIds.addAll(synced.providers.map { it.id })
    providerIds.addAll(defaultProviderIds())
    return providerIds.associateWith { providerId -> providerKeys[providerId].orEmpty() }
}
