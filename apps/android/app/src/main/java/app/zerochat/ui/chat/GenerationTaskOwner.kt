package app.zerochat.ui.chat

import java.util.IdentityHashMap
import java.util.concurrent.CancellationException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal class GenerationTaskOwner {
    private val stateLock = ReentrantLock()
    private val replacementMutex = Mutex()
    private val active = IdentityHashMap<GenerationLease, Job?>()
    private var epoch = 0L
    private var draining = false
    private var closed = false

    fun tryAcquire(): GenerationLease? = stateLock.withLock {
        if (closed || draining) {
            return@withLock null
        }

        GenerationLease(this, epoch).also { active[it] = null }
    }

    fun prepare(
        scope: CoroutineScope,
        lease: GenerationLease,
        block: suspend () -> Unit,
    ): Job? {
        val job = scope.launch(start = CoroutineStart.LAZY) { block() }
        val accepted = stateLock.withLock {
            if (
                active.containsKey(lease) &&
                active[lease] == null &&
                isCurrentLocked(lease)
            ) {
                active[lease] = job
                true
            } else {
                false
            }
        }

        if (!accepted) {
            job.cancel()
            return null
        }

        job.invokeOnCompletion { release(lease) }
        return job
    }

    fun launch(
        scope: CoroutineScope,
        lease: GenerationLease,
        block: suspend () -> Unit,
    ): Job? = prepare(scope, lease, block)?.also { it.start() }

    internal fun isCurrent(lease: GenerationLease): Boolean = stateLock.withLock {
        isCurrentLocked(lease)
    }

    internal inline fun runIfCurrent(
        lease: GenerationLease,
        commit: () -> Unit,
    ): Boolean = stateLock.withLock {
        if (!isCurrentLocked(lease)) {
            false
        } else {
            commit()
            true
        }
    }

    internal fun release(lease: GenerationLease) {
        stateLock.withLock { active.remove(lease) }
    }

    suspend fun <T> withDrain(block: suspend () -> T): T = replacementMutex.withLock {
        val jobs = stateLock.withLock {
            check(!closed) { "Generation task owner is closed." }
            draining = true
            epoch += 1
            val jobs = active.values.filterNotNull()
            active.entries.removeIf { it.value == null }
            jobs
        }

        try {
            withContext(NonCancellable) {
                jobs.forEach { job ->
                    job.cancel(CancellationException("Generation invalidated by data replacement"))
                }
                jobs.joinAll()
            }
            currentCoroutineContext().ensureActive()
            block()
        } finally {
            stateLock.withLock {
                if (!closed) {
                    draining = false
                }
            }
        }
    }

    fun close() {
        val jobs = stateLock.withLock {
            if (closed) {
                return
            }
            closed = true
            draining = true
            epoch += 1
            active.values.filterNotNull().also { active.clear() }
        }

        jobs.forEach { job ->
            job.cancel(CancellationException("Generation task owner closed"))
        }
    }

    private fun isCurrentLocked(lease: GenerationLease): Boolean =
        !closed && !draining && lease.epoch == epoch && active.containsKey(lease)
}

internal class GenerationLease internal constructor(
    internal val owner: GenerationTaskOwner,
    internal val epoch: Long,
) {
    fun isCurrent(): Boolean = owner.isCurrent(this)

    fun release() {
        owner.release(this)
    }
}

internal inline fun GenerationLease.runIfCurrent(commit: () -> Unit): Boolean =
    owner.runIfCurrent(this, commit)
