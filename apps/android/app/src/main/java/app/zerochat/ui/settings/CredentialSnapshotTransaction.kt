package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException

internal class CredentialSnapshotConflictException :
    IllegalStateException("Local data changed while the credential was being saved.")

internal suspend fun commitCredentialSnapshotTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    writeCredential: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
    conflictError: () -> IllegalStateException = ::CredentialSnapshotConflictException,
): SnapshotCommit {
    require(candidate != source) { "Credential save candidate did not change the snapshot." }
    val committed = compareAndSetSnapshot(source, candidate)
    if (!committed.committed) {
        throw conflictError()
    }

    if (currentRevision() != sourceRevision) {
        val conflict = conflictError()
        rollbackCredentialSnapshot(source, candidate, conflict, compareAndSetSnapshot)
        throw conflict
    }

    try {
        writeCredential()
    } catch (error: Throwable) {
        rollbackCredentialSnapshot(source, candidate, error, compareAndSetSnapshot)
        throw error
    }

    return SnapshotCommit(candidate, committed.revision)
}

private suspend fun rollbackCredentialSnapshot(
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
) {
    try {
        val rollback = compareAndSetSnapshot(candidate, source)
        if (!rollback.committed) {
            primaryError.addSuppressed(
                IllegalStateException("Credential snapshot compensation was rejected."),
            )
        }
    } catch (rollbackError: Throwable) {
        if (rollbackError is CancellationException) {
            rollbackError.addSuppressed(primaryError)
            throw rollbackError
        }
        primaryError.addSuppressed(rollbackError)
    }
}
