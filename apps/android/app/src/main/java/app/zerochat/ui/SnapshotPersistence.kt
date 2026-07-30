package app.zerochat.ui

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal class SnapshotPersistenceQueue(
    private val scope: CoroutineScope,
) {
    private val mutex = Mutex()

    fun enqueue(block: suspend () -> Unit): Job =
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            mutex.withLock { block() }
        }

    suspend fun <T> runSerially(block: suspend () -> T): T =
        mutex.withLock { block() }
}

internal class CommittedSnapshotBaseline {
    private var committed: AppSnapshot? = null
    private var revision = -1L

    fun initialize(snapshot: AppSnapshot, revision: Long = 0L) {
        committed = snapshot
        this.revision = revision
    }

    fun advance(commit: SnapshotCommit) {
        if (commit.revision >= revision) {
            committed = commit.snapshot
            revision = commit.revision
        }
    }

    fun acceptSynced(
        current: AppSnapshot?,
        source: AppSnapshot,
        commit: SnapshotCommit,
    ): AppSnapshot? {
        if (commit.revision < revision) {
            return current
        }

        advance(commit)
        return if (current == null || current == source) commit.snapshot else current
    }

    fun rollbackFailed(
        current: AppSnapshot?,
        failed: AppSnapshot,
    ): AppSnapshot? =
        if (current == failed) committed ?: current else current

    fun snapshot(): AppSnapshot? = committed
}

internal object SnapshotPersistence {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val queue = SnapshotPersistenceQueue(scope)

    fun launch(block: suspend () -> Unit): Job = scope.launch { block() }
}
