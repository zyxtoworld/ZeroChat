package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException

internal class LocalResetConflictException :
    IllegalStateException("Local data changed while reset was being committed.")

internal suspend fun commitLocalResetTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    stageCredentials: suspend () -> Unit,
    finishCredentials: suspend () -> Unit,
    restoreCredentials: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit {
    require(candidate != source) { "Local reset candidate did not change the snapshot." }

    stageCredentials()
    val committed = try {
        compareAndSetSnapshot(source, candidate)
    } catch (error: Throwable) {
        restoreStagedCredentials(error, restoreCredentials)
        throw error
    }

    if (!committed.committed) {
        if (committed.snapshot == candidate) {
            finishCredentials()
            return SnapshotCommit(candidate, committed.revision)
        }
        val conflict = LocalResetConflictException()
        restoreStagedCredentials(conflict, restoreCredentials)
        throw conflict
    }

    if (currentRevision() != sourceRevision) {
        val conflict = LocalResetConflictException()
        compensateCommittedReset(
            source = source,
            candidate = candidate,
            primaryError = conflict,
            finishCredentials = finishCredentials,
            restoreCredentials = restoreCredentials,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw conflict
    }

    try {
        finishCredentials()
    } catch (error: Throwable) {
        compensateCommittedReset(
            source = source,
            candidate = candidate,
            primaryError = error,
            finishCredentials = finishCredentials,
            restoreCredentials = restoreCredentials,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw error
    }

    return SnapshotCommit(candidate, committed.revision)
}

internal suspend fun commitLocalResetRecoveryTransaction(
    stageCredentials: suspend () -> Unit,
    saveSnapshot: suspend () -> SnapshotCommit,
    finishCredentials: suspend () -> Unit,
    restoreCredentials: suspend () -> Unit,
): SnapshotCommit {
    stageCredentials()
    val committed = try {
        saveSnapshot()
    } catch (error: Throwable) {
        restoreStagedCredentials(error, restoreCredentials)
        throw error
    }

    // Once corrupt AppData has been replaced, the durable intent must remain if
    // credential cleanup fails so startup can finish the reset from the snapshot fingerprint.
    finishCredentials()
    return committed
}

private suspend fun compensateCommittedReset(
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    finishCredentials: suspend () -> Unit,
    restoreCredentials: suspend () -> Unit,
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
            restoreStagedCredentials(primaryError, restoreCredentials)
        rollback.snapshot == candidate ->
            finishStagedCredentials(primaryError, finishCredentials)
        else -> primaryError.addSuppressed(
            IllegalStateException("Local reset compensation found an unrelated snapshot."),
        )
    }
}

private suspend fun restoreStagedCredentials(
    primaryError: Throwable,
    restoreCredentials: suspend () -> Unit,
) {
    try {
        restoreCredentials()
    } catch (restoreError: Throwable) {
        if (restoreError is CancellationException) {
            restoreError.addSuppressed(primaryError)
            throw restoreError
        }
        primaryError.addSuppressed(restoreError)
    }
}

private suspend fun finishStagedCredentials(
    primaryError: Throwable,
    finishCredentials: suspend () -> Unit,
) {
    try {
        finishCredentials()
    } catch (finishError: Throwable) {
        if (finishError is CancellationException) {
            finishError.addSuppressed(primaryError)
            throw finishError
        }
        primaryError.addSuppressed(finishError)
    }
}
