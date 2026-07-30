package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException

internal class ProviderDeletionConflictException :
    IllegalStateException("Provider data changed while deletion was being committed.")

internal suspend fun commitProviderDeletionTransaction(
    providerId: String,
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    stageCredentialDeletion: suspend () -> Unit,
    finishCredentialDeletion: suspend () -> Unit,
    cancelCredentialDeletion: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
): SnapshotCommit {
    require(source.providers.any { it.id == providerId }) { "Provider does not exist." }
    require(candidate.providers.none { it.id == providerId }) { "Deletion candidate still contains provider." }

    stageCredentialDeletion()
    val committed = compareAndSetSnapshot(source, candidate)
    if (!committed.committed) {
        if (committed.snapshot.providers.any { it.id == providerId }) {
            cancelCredentialDeletion()
            throw ProviderDeletionConflictException()
        }

        finishCredentialDeletion()
        return SnapshotCommit(committed.snapshot, committed.revision)
    }

    if (currentRevision() != sourceRevision) {
        val conflict = ProviderDeletionConflictException()
        compensateCommittedDeletion(
            providerId = providerId,
            source = source,
            candidate = candidate,
            primaryError = conflict,
            finishCredentialDeletion = finishCredentialDeletion,
            cancelCredentialDeletion = cancelCredentialDeletion,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw conflict
    }

    try {
        finishCredentialDeletion()
    } catch (error: Throwable) {
        compensateCommittedDeletion(
            providerId = providerId,
            source = source,
            candidate = candidate,
            primaryError = error,
            finishCredentialDeletion = finishCredentialDeletion,
            cancelCredentialDeletion = cancelCredentialDeletion,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw error
    }

    return SnapshotCommit(candidate, committed.revision)
}

private suspend fun compensateCommittedDeletion(
    providerId: String,
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    finishCredentialDeletion: suspend () -> Unit,
    cancelCredentialDeletion: suspend () -> Unit,
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

    try {
        if (rollback.committed || rollback.snapshot.providers.any { it.id == providerId }) {
            cancelCredentialDeletion()
        } else {
            finishCredentialDeletion()
        }
    } catch (credentialError: Throwable) {
        primaryError.addSuppressed(credentialError)
    }
}
