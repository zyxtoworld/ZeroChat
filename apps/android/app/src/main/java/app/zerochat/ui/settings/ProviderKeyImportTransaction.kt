package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

internal class ProviderKeyImportConflictException :
    IllegalStateException("Local data changed while the backup was being imported.")

internal suspend fun commitProviderKeyImportTransaction(
    source: AppSnapshot,
    candidate: AppSnapshot,
    sourceRevision: Long,
    currentRevision: () -> Long,
    stageProviderKeys: suspend () -> Unit,
    finishProviderKeys: suspend () -> Unit,
    restoreProviderKeys: suspend () -> Unit,
    compareAndSetSnapshot: suspend (AppSnapshot, AppSnapshot) -> SnapshotCompareAndSetResult,
    conflictError: () -> IllegalStateException = ::ProviderKeyImportConflictException,
): SnapshotCommit {
    require(candidate != source) { "Backup import candidate did not change the snapshot." }

    stageProviderKeys()
    val committed = try {
        compareAndSetSnapshot(source, candidate)
    } catch (error: Throwable) {
        withContext(NonCancellable) {
            compensateCommittedProviderKeyImport(
                source = source,
                candidate = candidate,
                primaryError = error,
                finishProviderKeys = finishProviderKeys,
                restoreProviderKeys = restoreProviderKeys,
                compareAndSetSnapshot = compareAndSetSnapshot,
            )
        }
        throw error
    }

    if (!committed.committed) {
        if (committed.snapshot == candidate) {
            finishProviderKeys()
            return SnapshotCommit(candidate, committed.revision)
        }
        val conflict = conflictError()
        restoreStagedProviderKeys(conflict, restoreProviderKeys)
        throw conflict
    }

    if (currentRevision() != sourceRevision) {
        val conflict = conflictError()
        compensateCommittedProviderKeyImport(
            source = source,
            candidate = candidate,
            primaryError = conflict,
            finishProviderKeys = finishProviderKeys,
            restoreProviderKeys = restoreProviderKeys,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw conflict
    }

    try {
        finishProviderKeys()
    } catch (error: Throwable) {
        compensateCommittedProviderKeyImport(
            source = source,
            candidate = candidate,
            primaryError = error,
            finishProviderKeys = finishProviderKeys,
            restoreProviderKeys = restoreProviderKeys,
            compareAndSetSnapshot = compareAndSetSnapshot,
        )
        throw error
    }

    return SnapshotCommit(candidate, committed.revision)
}

internal suspend fun commitProviderKeyImportRecoveryTransaction(
    stageProviderKeys: suspend () -> Unit,
    saveSnapshot: suspend () -> SnapshotCommit,
    finishProviderKeys: suspend () -> Unit,
    restoreProviderKeys: suspend () -> Unit,
): SnapshotCommit {
    stageProviderKeys()
    val committed = try {
        saveSnapshot()
    } catch (error: Throwable) {
        restoreStagedProviderKeys(error, restoreProviderKeys)
        throw error
    }

    // A committed replacement snapshot is authoritative. Keep the durable
    // intent if finalization fails so startup can retain the replacement keys.
    finishProviderKeys()
    return committed
}

private suspend fun compensateCommittedProviderKeyImport(
    source: AppSnapshot,
    candidate: AppSnapshot,
    primaryError: Throwable,
    finishProviderKeys: suspend () -> Unit,
    restoreProviderKeys: suspend () -> Unit,
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
            restoreStagedProviderKeys(primaryError, restoreProviderKeys)
        rollback.snapshot == candidate ->
            finishStagedProviderKeys(primaryError, finishProviderKeys)
        else -> primaryError.addSuppressed(
            IllegalStateException("Backup import compensation found an unrelated snapshot."),
        )
    }
}

private suspend fun restoreStagedProviderKeys(
    primaryError: Throwable,
    restoreProviderKeys: suspend () -> Unit,
) {
    try {
        restoreProviderKeys()
    } catch (restoreError: Throwable) {
        if (restoreError is CancellationException) {
            restoreError.addSuppressed(primaryError)
            throw restoreError
        }
        primaryError.addSuppressed(restoreError)
    }
}

private suspend fun finishStagedProviderKeys(
    primaryError: Throwable,
    finishProviderKeys: suspend () -> Unit,
) {
    try {
        finishProviderKeys()
    } catch (finishError: Throwable) {
        if (finishError is CancellationException) {
            finishError.addSuppressed(primaryError)
            throw finishError
        }
        primaryError.addSuppressed(finishError)
    }
}
