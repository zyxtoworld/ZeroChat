package app.zerochat.ui

import app.zerochat.data.AppSnapshot
import app.zerochat.data.SnapshotCommit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.locks.ReentrantLock
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.withLock

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
        if (committed == null || revision >= this.revision) {
            committed = snapshot
            this.revision = revision
        }
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

internal sealed interface SnapshotPersistenceEvent {
    val sequence: Long
    val source: AppSnapshot

    data class Persisted(
        override val sequence: Long,
        override val source: AppSnapshot,
        val commit: SnapshotCommit,
    ) : SnapshotPersistenceEvent

    data class Failed(
        override val sequence: Long,
        override val source: AppSnapshot,
        val error: Throwable,
    ) : SnapshotPersistenceEvent

    data class Synced(
        override val sequence: Long,
        override val source: AppSnapshot,
        val commit: SnapshotCommit,
    ) : SnapshotPersistenceEvent
}

internal class SnapshotReplacementInProgressException :
    IllegalStateException("Local snapshot replacement is in progress.")

private class SnapshotReplacementCycle {
    val completed = CompletableDeferred<Boolean>()
}

private sealed interface SnapshotSaveStep {
    object Completed : SnapshotSaveStep
    object Dropped : SnapshotSaveStep
    class AwaitReplacement(val cycle: SnapshotReplacementCycle) : SnapshotSaveStep
}

private sealed interface SnapshotMutationStep<out T> {
    class Completed<T>(val value: T) : SnapshotMutationStep<T>
    object Dropped : SnapshotMutationStep<Nothing>
    class AwaitReplacement(val cycle: SnapshotReplacementCycle) : SnapshotMutationStep<Nothing>
}

internal class SnapshotPersistenceOwner(
    private val scope: CoroutineScope,
    private val persistSnapshot: suspend (AppSnapshot) -> Result<SnapshotCommit>,
    private val requestAutoSync: suspend (AppSnapshot) -> Unit,
) {
    private val nextSequence = AtomicLong()
    private val pendingEvents = MutableStateFlow<List<SnapshotPersistenceEvent>>(emptyList())
    private val replacementMutex = Mutex()
    private val admissionLock = ReentrantLock()
    private var replacementReservations = 0
    private var replacementActive = false
    private var replacementGeneration = 0L
    private val replacementCycles = mutableListOf<SnapshotReplacementCycle>()

    private val queue = SnapshotPersistenceQueue(scope)
    val events: StateFlow<List<SnapshotPersistenceEvent>> = pendingEvents.asStateFlow()

    fun enqueueSnapshot(candidate: AppSnapshot, shouldSync: Boolean): Job =
        tryEnqueueSnapshot(candidate, shouldSync) ?: scope.launch(start = CoroutineStart.UNDISPATCHED) {}

    fun tryEnqueueSnapshot(
        candidate: AppSnapshot,
        shouldSync: Boolean,
        beforeEnqueue: () -> Unit = {},
        onDropped: () -> Unit = {},
    ): Job? {
        val generation = admissionLock.withLock {
            if (replacementReservations > 0 || replacementActive) {
                return null
            }

            beforeEnqueue()
            replacementGeneration
        }

        return scope.launch(start = CoroutineStart.UNDISPATCHED) {
            persistEnqueuedSnapshot(candidate, shouldSync, generation, onDropped)
        }
    }

    private suspend fun persistEnqueuedSnapshot(
        candidate: AppSnapshot,
        shouldSync: Boolean,
        generation: Long,
        onDropped: () -> Unit,
    ) {
        while (true) {
            val step = queue.runSerially {
                val gate = admissionLock.withLock {
                    when {
                        replacementGeneration != generation -> SnapshotSaveStep.Dropped
                        replacementReservations > 0 || replacementActive -> {
                            SnapshotSaveStep.AwaitReplacement(
                                cycle = checkNotNull(replacementCycles.firstOrNull()),
                            )
                        }
                        else -> null
                    }
                }
                if (gate != null) {
                    return@runSerially gate
                }

                val result = persistSnapshot(candidate)
                if (result.isFailure) {
                    publish(
                        SnapshotPersistenceEvent.Failed(
                            sequence = nextSequence.incrementAndGet(),
                            source = candidate,
                            error = checkNotNull(result.exceptionOrNull()),
                        ),
                    )
                    return@runSerially SnapshotSaveStep.Completed
                }

                val commit = result.getOrThrow()
                publish(
                    SnapshotPersistenceEvent.Persisted(
                        sequence = nextSequence.incrementAndGet(),
                        source = candidate,
                        commit = commit,
                    ),
                )
                if (shouldSync) {
                    scope.launch(start = CoroutineStart.UNDISPATCHED) {
                        requestAutoSync(candidate)
                    }
                }
                SnapshotSaveStep.Completed
            }

            when (step) {
                SnapshotSaveStep.Completed,
                -> return

                SnapshotSaveStep.Dropped -> {
                    onDropped()
                    return
                }

                is SnapshotSaveStep.AwaitReplacement -> {
                    if (step.cycle.completed.await()) {
                        onDropped()
                        return
                    }
                }
            }
        }
    }

    suspend fun <T> runSnapshotMutation(block: suspend () -> T): T {
        val generation = admissionLock.withLock {
            if (replacementReservations > 0 || replacementActive) {
                throw SnapshotReplacementInProgressException()
            }

            replacementGeneration
        }

        while (true) {
            val step = queue.runSerially {
                val gate = admissionLock.withLock {
                    when {
                        replacementGeneration != generation -> SnapshotMutationStep.Dropped
                        replacementReservations > 0 || replacementActive -> {
                            SnapshotMutationStep.AwaitReplacement(
                                cycle = checkNotNull(replacementCycles.firstOrNull()),
                            )
                        }
                        else -> null
                    }
                }
                if (gate != null) {
                    return@runSerially gate
                }
                SnapshotMutationStep.Completed(block())
            }

            when (step) {
                is SnapshotMutationStep.Completed -> return step.value
                SnapshotMutationStep.Dropped -> throw SnapshotReplacementInProgressException()
                is SnapshotMutationStep.AwaitReplacement -> {
                    if (step.cycle.completed.await()) {
                        throw SnapshotReplacementInProgressException()
                    }
                }
            }
        }
    }

    suspend fun <T> runSnapshotReplacement(block: suspend () -> T): T {
        val cycle = SnapshotReplacementCycle()
        admissionLock.withLock {
            replacementReservations += 1
            replacementCycles += cycle
        }
        var active = false

        try {
            return replacementMutex.withLock {
                queue.runSerially { }
                currentCoroutineContext().ensureActive()
                admissionLock.withLock {
                    replacementReservations -= 1
                    replacementActive = true
                    replacementGeneration += 1
                }
                active = true

                try {
                    currentCoroutineContext().ensureActive()
                    block()
                } finally {
                    admissionLock.withLock {
                        replacementActive = false
                        replacementCycles.remove(cycle)
                    }
                    cycle.completed.complete(true)
                }
            }
        } finally {
            if (!active) {
                admissionLock.withLock {
                    replacementReservations = (replacementReservations - 1).coerceAtLeast(0)
                    replacementCycles.remove(cycle)
                }
                cycle.completed.complete(false)
            }
        }
    }

    fun publishSynced(source: AppSnapshot, commit: SnapshotCommit) {
        publish(
            SnapshotPersistenceEvent.Synced(
                sequence = nextSequence.incrementAndGet(),
                source = source,
                commit = commit,
            ),
        )
    }

    fun acknowledge(sequence: Long) {
        pendingEvents.update { events -> events.filter { it.sequence > sequence } }
    }

    fun launch(block: suspend () -> Unit): Job = scope.launch { block() }

    private fun publish(event: SnapshotPersistenceEvent) {
        pendingEvents.update { events -> events + event }
    }
}
