package app.zerochat.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

class ZeroChatRepository private constructor(
    private val snapshotFile: File,
) {
    constructor(context: Context) : this(File(context.filesDir, "snapshot.v1.json"))

    internal constructor(filesDir: File, snapshotName: String) : this(File(filesDir, snapshotName))

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        prettyPrint = true
    }
    private val snapshotTempFile = snapshotTempFile(snapshotFile)
    private val emptySnapshot = AppSnapshot()
    private var commitRevision = 0L

    suspend fun load(): AppSnapshot = withContext(Dispatchers.IO) {
        storageMutex.withLock { loadLocked() }
    }

    suspend fun save(snapshot: AppSnapshot): SnapshotCommit = withContext(Dispatchers.IO) {
        storageMutex.withLock {
            saveLocked(snapshot)
            SnapshotCommit(snapshot, nextCommitRevision())
        }
    }

    internal suspend fun compareAndSet(
        expected: AppSnapshot,
        replacement: AppSnapshot,
    ): SnapshotCompareAndSetResult = withContext(Dispatchers.IO) {
        storageMutex.withLock {
            val current = loadLocked()
            if (current != expected) {
                return@withLock SnapshotCompareAndSetResult(
                    snapshot = current,
                    revision = commitRevision,
                    committed = false,
                )
            }

            saveLocked(replacement)
            SnapshotCompareAndSetResult(
                snapshot = replacement,
                revision = nextCommitRevision(),
                committed = true,
            )
        }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        storageMutex.withLock {
            snapshotFile.delete()
            snapshotTempFile.delete()
            nextCommitRevision()
        }
    }

    private fun loadLocked(): AppSnapshot {
        val source = when {
            snapshotFile.exists() -> snapshotFile
            snapshotTempFile.exists() -> snapshotTempFile
            else -> return emptySnapshot
        }

        val snapshot = json.decodeFromString<AppSnapshot>(readBoundedSnapshotText(source))
        if (source == snapshotTempFile) {
            replaceSnapshotFile(snapshotTempFile, snapshotFile)
        }
        return snapshot
    }

    private fun saveLocked(snapshot: AppSnapshot) {
        writeBoundedSnapshotTextAtomically(
            snapshotFile,
            json.encodeToString(AppSnapshot.serializer(), snapshot),
        )
    }

    private fun nextCommitRevision(): Long {
        commitRevision += 1
        return commitRevision
    }

    private companion object {
        val storageMutex = Mutex()
    }
}

internal data class SnapshotCompareAndSetResult(
    val snapshot: AppSnapshot,
    val revision: Long,
    val committed: Boolean,
)

data class SnapshotCommit(
    val snapshot: AppSnapshot,
    val revision: Long,
)
