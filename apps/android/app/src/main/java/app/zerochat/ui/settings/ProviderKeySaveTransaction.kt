package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult

internal class ProviderKeySaveConflictException :
    IllegalStateException("Local data changed while the provider credential was being saved.")

internal suspend fun commitProviderKeySnapshotSaveTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    stageProviderKey: suspend () -> Unit,
    finishProviderKey: suspend () -> Unit,
    restoreProviderKey: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit = commitProviderKeyImportTransaction(
    source = source,
    candidate = candidate,
    sourceRevision = sourceRevision,
    currentRevision = currentRevision,
    stageProviderKeys = stageProviderKey,
    finishProviderKeys = finishProviderKey,
    restoreProviderKeys = restoreProviderKey,
    compareAndSetSnapshot = compareAndSetSnapshot,
    conflictError = ::ProviderKeySaveConflictException,
)
