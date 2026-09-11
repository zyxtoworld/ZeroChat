package app.zerochat

import android.app.Application
import android.content.Context
import app.zerochat.data.AppSnapshot
import app.zerochat.data.LocalSnapshotRecoveryGate
import app.zerochat.data.SnapshotCommit
import app.zerochat.data.ZeroChatRepository
import app.zerochat.security.SecretStore
import app.zerochat.sync.AndroidSyncStatusNotifier
import app.zerochat.sync.AutoSyncCoordinator
import app.zerochat.sync.SharedPreferencesGistCursorStorage
import app.zerochat.sync.SyncClient
import app.zerochat.ui.CommittedSnapshotBaseline
import app.zerochat.ui.NativeI18n
import app.zerochat.ui.SnapshotPersistenceOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

class ZeroChatApplication : Application() {
    private val runtimeDelegate = lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        ZeroChatRuntime(this)
    }

    internal val runtime: ZeroChatRuntime
        get() = runtimeDelegate.value

    override fun onTerminate() {
        if (runtimeDelegate.isInitialized()) {
            runtimeDelegate.value.close()
        }
        super.onTerminate()
    }
}

internal class ZeroChatRuntime(context: Context) : AutoCloseable {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var persistencePublisher: SnapshotPersistenceOwner

    val repository = ZeroChatRepository(appContext)
    val localSnapshotRecoveryGate = LocalSnapshotRecoveryGate()
    val secretStore = SecretStore(appContext)
    val committedSnapshots = CommittedSnapshotBaseline()
    val syncStatusNotifier = AndroidSyncStatusNotifier(
        appContext,
        NativeI18n.forMode("system").syncNotificationLabels(),
    )
    val autoSync = AutoSyncCoordinator(
        repository = repository,
        secretStore = secretStore,
        syncClient = SyncClient(
            gistCursorStorage = SharedPreferencesGistCursorStorage(appContext),
        ),
        statusNotifier = syncStatusNotifier,
        statusLabel = { snapshot, status ->
            NativeI18n.forMode(snapshot.preferences.language).syncStatusMessage(status)
        },
        onSynced = { source, commit ->
            committedSnapshots.advance(commit)
            persistencePublisher.publishSynced(source, commit)
        },
    )
    val persistence = SnapshotPersistenceOwner(
        scope = scope,
        persistSnapshot = ::persistLocalSnapshot,
        requestAutoSync = { snapshot -> autoSync.enqueue(snapshot) },
    ).also { persistencePublisher = it }

    suspend fun persistLocalSnapshot(
        candidate: AppSnapshot,
        recovery: Boolean = false,
    ): Result<SnapshotCommit> {
        var commit: SnapshotCommit? = null
        val result = localSnapshotRecoveryGate.persist(recovery) {
            commit = repository.save(candidate)
        }
        return result.map {
            checkNotNull(commit).also(committedSnapshots::advance)
        }
    }

    override fun close() {
        scope.cancel()
        autoSync.close()
    }
}
