package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal class SyncPassphraseSnapshotConflictException :
    IllegalStateException("Local data changed while the sync passphrase was being saved.")

internal suspend fun commitSyncPassphraseSnapshotTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    stageSyncPassphrase: suspend () -> Unit,
    finishSyncPassphrase: suspend () -> Unit,
    restoreSyncPassphrase: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit {
    require(candidate != source) { "Sync passphrase candidate did not change the snapshot." }

    stageSyncPassphrase()
    val committed = try {
        compareAndSetSnapshot(source, candidate)
    } catch (error: Throwable) {
        withContext(NonCancellable) {
            compensateCommittedSyncPassphrase(
                source = source,
                candidate = candidate,
                primaryError = error,
                finishSyncPassphrase = finishSyncPassphrase,
                restoreSyncPassphrase = restoreSyncPassphrase,
                compareAndSetSnapshot = compareAndSetSnapshot,
            )
        }
        throw error
    }

    if (!committed.committed) {
        if (committed.snapshot == candidate) {
            finishSyncPassphrase()
            return SnapshotCommit(candidate, committed.revision)
        }
        val conflict = SyncPassphraseSnapshotConflictException()
        restoreStagedSyncPassphrase(conflict, restoreSyncPassphrase)
        throw conflict
    }

    if (currentRevision() != sourceRevision) {
        val conflict = SyncPassphraseSnapshotConflictException()
        compensateCommittedSyncPassphrase(
            source = source,
            candidate = candidate,
            primaryError = conflict,
            finishSyncPassphrase = finishSyncPassphrase,
            restoreSyncPassphrase = restoreSyncPassphrase,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw conflict
    }

    try {
        finishSyncPassphrase()
    } catch (error: Throwable) {
        compensateCommittedSyncPassphrase(
            source = source,
            candidate = candidate,
            primaryError = error,
            finishSyncPassphrase = finishSyncPassphrase,
            restoreSyncPassphrase = restoreSyncPassphrase,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw error
    }

    return SnapshotCommit(candidate, committed.revision)
}

private suspend fun compensateCommittedSyncPassphrase(
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    finishSyncPassphrase: suspend () -> Unit,
    restoreSyncPassphrase: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
) {
    val rollback = try {
        compareAndSetSnapshot(candidate, source)
    } catch (rollbackError: Throwable) {
        if (rollbackError is CancellationException) {
            rollbackError.addSuppressed(primaryError)
            throw rollbackError
        }
        primaryError.addSuppressed(rollbackError)
        return
    }

    when {
        rollback.committed || rollback.snapshot == source ->
            restoreStagedSyncPassphrase(primaryError, restoreSyncPassphrase)
        rollback.snapshot == candidate ->
            finishStagedSyncPassphrase(primaryError, finishSyncPassphrase)
        else -> primaryError.addSuppressed(
            IllegalStateException("Sync passphrase compensation found an unrelated snapshot."),
        )
    }
}

private suspend fun restoreStagedSyncPassphrase(
    primaryError: Throwable,
    restoreSyncPassphrase: suspend () -> Unit,
) {
    try {
        restoreSyncPassphrase()
    } catch (restoreError: Throwable) {
        if (restoreError is CancellationException) {
            restoreError.addSuppressed(primaryError)
            throw restoreError
        }
        primaryError.addSuppressed(restoreError)
    }
}

private suspend fun finishStagedSyncPassphrase(
    primaryError: Throwable,
    finishSyncPassphrase: suspend () -> Unit,
) {
    try {
        finishSyncPassphrase()
    } catch (finishError: Throwable) {
        if (finishError is CancellationException) {
            finishError.addSuppressed(primaryError)
            throw finishError
        }
        primaryError.addSuppressed(finishError)
    }
}
