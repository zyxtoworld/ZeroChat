package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult

internal suspend fun commitSyncPassphraseSaveTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    writeSyncPassphrase: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit = commitCredentialSnapshotTransaction(
    source = source,
    candidate = candidate,
    sourceRevision = sourceRevision,
    currentRevision = currentRevision,
    writeCredential = writeSyncPassphrase,
    compareAndSetSnapshot = compareAndSetSnapshot,
)
