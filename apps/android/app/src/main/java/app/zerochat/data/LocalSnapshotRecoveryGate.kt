package app.zerochat.data

import app.zerochat.runCatchingPreservingCancellation
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class LocalSnapshotRecoveryIssue {
    LoadFailed,
}

internal class LocalSnapshotRecoveryRequiredException :
    IllegalStateException("Local snapshot recovery is required.")

internal class LocalSnapshotRecoveryGate {
    private val mutex = Mutex()

    @Volatile
    var issue: LocalSnapshotRecoveryIssue? = null
        private set

    fun markLoadFailed() {
        issue = LocalSnapshotRecoveryIssue.LoadFailed
    }

    suspend fun persist(
        recovery: Boolean = false,
        write: suspend () -> Unit,
    ): Result<Unit> = mutex.withLock {
        if (issue != null && !recovery) {
            return@withLock Result.failure(LocalSnapshotRecoveryRequiredException())
        }

        runCatchingPreservingCancellation { write() }.also { result ->
            if (recovery && result.isSuccess) {
                issue = null
            }
        }
    }
}
