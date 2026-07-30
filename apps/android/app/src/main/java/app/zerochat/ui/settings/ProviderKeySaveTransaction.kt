package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult

internal suspend fun commitProviderKeySaveTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    writeProviderKey: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit {
    return commitCredentialSnapshotTransaction(
        source = source,
        candidate = candidate,
        sourceRevision = sourceRevision,
        currentRevision = currentRevision,
        writeCredential = writeProviderKey,
        compareAndSetSnapshot = compareAndSetSnapshot,
        conflictError = ::ProviderDeletionConflictException,
    )
}
