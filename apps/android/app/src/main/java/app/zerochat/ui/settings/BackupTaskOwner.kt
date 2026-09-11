package app.zerochat.ui.settings

import androidx.lifecycle.ViewModel
import app.zerochat.data.AppSnapshot
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

internal data class BackupImportRequest(
    val id: Long,
    val snapshot: AppSnapshot,
    val providerKeys: Map<String, String>,
    val executionMutex: Mutex = Mutex(),
)

internal data class BackupTaskNotice(
    val id: Long,
    val message: String,
    val kind: SettingsNoticeKind,
)

internal class BackupTaskOwner(
    private val scope: CoroutineScope,
) {
    private val nextId = AtomicLong()
    private val importWaiters = ConcurrentHashMap<Long, CompletableDeferred<Result<Unit>>>()
    private val pendingImports = MutableStateFlow<List<BackupImportRequest>>(emptyList())
    private val pendingNotices = MutableStateFlow<List<BackupTaskNotice>>(emptyList())

    val importRequests: StateFlow<List<BackupImportRequest>> = pendingImports.asStateFlow()
    val notices: StateFlow<List<BackupTaskNotice>> = pendingNotices.asStateFlow()

    fun launch(block: suspend () -> Unit): Job = scope.launch { block() }

    suspend fun requestImport(
        snapshot: AppSnapshot,
        providerKeys: Map<String, String>,
    ): Result<Unit> {
        val id = nextId.incrementAndGet()
        val completion = CompletableDeferred<Result<Unit>>()
        check(importWaiters.putIfAbsent(id, completion) == null)
        pendingImports.update { requests ->
            requests + BackupImportRequest(id, snapshot, providerKeys)
        }

        return try {
            completion.await()
        } finally {
            importWaiters.remove(id, completion)
            pendingImports.update { requests -> requests.filterNot { it.id == id } }
        }
    }

    fun isImportPending(id: Long): Boolean = importWaiters.containsKey(id)

    fun completeImport(id: Long, result: Result<Unit>) {
        val completion = importWaiters.remove(id) ?: return
        pendingImports.update { requests -> requests.filterNot { it.id == id } }
        completion.complete(result)
    }

    fun publishNotice(message: String, kind: SettingsNoticeKind) {
        pendingNotices.update { notices ->
            notices + BackupTaskNotice(nextId.incrementAndGet(), message, kind)
        }
    }

    fun acknowledgeNotice(id: Long) {
        pendingNotices.update { notices -> notices.filter { it.id > id } }
    }
}

class BackupTaskViewModel : ViewModel() {
    private val taskScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    internal val tasks = BackupTaskOwner(taskScope)

    override fun onCleared() {
        taskScope.cancel()
    }
}
