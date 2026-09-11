package app.zerochat.ui.chat

import java.util.concurrent.CancellationException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GenerationTaskOwnerTest {
    @Test
    fun replacementInvalidatesAndDrainsAnActiveGenerationBeforeCommit() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val cleanupStarted = CompletableDeferred<Unit>()
        val releaseCleanup = CompletableDeferred<Unit>()
        var staleTerminalCommits = 0

        val lease = owner.tryAcquire()!!
        val job = owner.launch(scope, lease) {
                try {
                    awaitCancellation()
                } finally {
                    withContext(NonCancellable) {
                        cleanupStarted.complete(Unit)
                        releaseCleanup.await()
                    }
                    lease.runIfCurrent { staleTerminalCommits += 1 }
                }
            }!!

        val replacementCommitted = CompletableDeferred<Unit>()
        val replacement = async {
            owner.withDrain {
                replacementCommitted.complete(Unit)
            }
        }

        cleanupStarted.await()
        yield()
        assertFalse(replacementCommitted.isCompleted)
        assertEquals(0, staleTerminalCommits)

        releaseCleanup.complete(Unit)
        replacement.await()
        job.join()
        assertTrue(replacementCommitted.isCompleted)
        scope.cancel()
    }

    @Test
    fun replacementAdmissionRejectsNewGenerationUntilCommitFinishes() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val releaseReplacement = CompletableDeferred<Unit>()
        val replacementStarted = CompletableDeferred<Unit>()

        val replacement = async {
            owner.withDrain {
                replacementStarted.complete(Unit)
                releaseReplacement.await()
            }
        }

        replacementStarted.await()
        assertNull(owner.tryAcquire())
        releaseReplacement.complete(Unit)
        replacement.await()
        assertNotNull(owner.tryAcquire())
        scope.cancel()
    }

    @Test
    fun replacementFailureRestoresGenerationAdmission() = runBlocking {
        val owner = GenerationTaskOwner()

        val failure = runCatching {
            owner.withDrain<Unit> {
                error("replacement failed")
            }
        }.exceptionOrNull()

        assertTrue(failure is IllegalStateException)
        assertEquals("replacement failed", failure?.message)
        assertNotNull(owner.tryAcquire())
    }

    @Test
    fun cancelledReplacementCallerDrainsOldCleanupAndRestoresAdmission() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val cleanupStarted = CompletableDeferred<Unit>()
        val releaseCleanup = CompletableDeferred<Unit>()
        val blockRan = AtomicBoolean(false)
        val replacementCancellation = CompletableDeferred<Throwable?>()
        val lease = owner.tryAcquire()!!
        val oldJob = owner.launch(scope, lease) {
            try {
                CompletableDeferred<Unit>().await()
            } catch (_: CancellationException) {
                withContext(NonCancellable) {
                    cleanupStarted.complete(Unit)
                    releaseCleanup.await()
                }
            }
        }!!

        val replacement = launch(Dispatchers.Default) {
            owner.withDrain {
                blockRan.set(true)
            }
        }
        replacement.invokeOnCompletion { cause -> replacementCancellation.complete(cause) }

        cleanupStarted.await()
        assertNull(owner.tryAcquire())

        val callerCancellation = CancellationException("replacement caller cancelled")
        replacement.cancel(callerCancellation)
        releaseCleanup.complete(Unit)
        replacement.join()
        oldJob.join()

        assertFalse(blockRan.get())
        val observedCancellation = replacementCancellation.await()
        assertTrue(observedCancellation is CancellationException)
        assertEquals(callerCancellation.message, observedCancellation?.message)
        val nextLease = owner.tryAcquire()
        assertNotNull(nextLease)
        nextLease!!.release()
        scope.cancel()
    }

    @Test
    fun textAndImageGenerationCallbacksDropLateOutcomesAcrossReplacement() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val kinds = listOf("text", "image")
        val cleanupStarted = kinds.map { CompletableDeferred<Unit>() }
        val releaseCleanup = kinds.map { CompletableDeferred<Unit>() }
        val snapshotReductions = mutableListOf<String>()
        val onSnapshotReduce: (String) -> Unit = { snapshotReductions += it }
        val leases = kinds.map { owner.tryAcquire()!! }

        val jobs = kinds.mapIndexed { index, kind ->
            owner.launch(scope, leases[index]) {
                try {
                    awaitCancellation()
                } catch (_: CancellationException) {
                    // This is the ChatScreen cancellation callback for text/image generation.
                    leases[index].runIfCurrent { onSnapshotReduce("$kind-cancel") }
                } finally {
                    withContext(NonCancellable) {
                        cleanupStarted[index].complete(Unit)
                        releaseCleanup[index].await()
                    }
                }
            }!!
        }

        val replacementCommitted = CompletableDeferred<Unit>()
        val replacement = async {
            owner.withDrain {
                replacementCommitted.complete(Unit)
            }
        }

        cleanupStarted.forEach { it.await() }
        yield()
        assertFalse(replacementCommitted.isCompleted)

        // These model the success and failure callbacks that can arrive after a provider
        // request has returned, but before its old generation has fully unwound.
        kinds.forEachIndexed { index, kind ->
            leases[index].runIfCurrent { onSnapshotReduce("$kind-success") }
            leases[index].runIfCurrent { onSnapshotReduce("$kind-failure") }
        }
        assertTrue(snapshotReductions.isEmpty())

        releaseCleanup.forEach { it.complete(Unit) }
        replacement.await()
        jobs.forEach { it.join() }
        assertTrue(replacementCommitted.isCompleted)
        assertTrue(snapshotReductions.isEmpty())

        // A new text and image generation must still be able to commit after replacement.
        kinds.forEach { kind ->
            val nextLease = owner.tryAcquire()!!
            val nextJob = owner.launch(scope, nextLease) {
                nextLease.runIfCurrent { onSnapshotReduce("$kind-success-after-replacement") }
            }!!
            nextJob.join()
        }
        assertEquals(
            listOf("text-success-after-replacement", "image-success-after-replacement"),
            snapshotReductions,
        )
        scope.cancel()
    }

    @Test
    fun replacementCannotBeginBetweenGenerationCheckAndCommit() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val lease = owner.tryAcquire()!!
        val commitEntered = CountDownLatch(1)
        val releaseCommit = CountDownLatch(1)
        val replacementAttempted = CountDownLatch(1)
        val replacementEntered = CountDownLatch(1)
        val replacementStarted = AtomicBoolean(false)
        val snapshotReduceAfterReplacement = AtomicBoolean(false)
        val onSnapshotReduce = { snapshotReduceAfterReplacement.set(true) }

        val commit = async(Dispatchers.Default) {
            lease.runIfCurrent {
                commitEntered.countDown()
                check(releaseCommit.await(2, TimeUnit.SECONDS))
                if (replacementStarted.get()) {
                    onSnapshotReduce()
                }
            }
        }
        assertTrue(commitEntered.await(2, TimeUnit.SECONDS))

        val replacement = async(Dispatchers.Default) {
            replacementAttempted.countDown()
            owner.withDrain {
                replacementStarted.set(true)
                replacementEntered.countDown()
            }
        }
        assertTrue(replacementAttempted.await(2, TimeUnit.SECONDS))
        val replacementCrossedGate = replacementEntered.await(200, TimeUnit.MILLISECONDS)
        try {
            assertFalse(replacementStarted.get())
            assertFalse(replacementCrossedGate)
        } finally {
            releaseCommit.countDown()
        }
        assertTrue(commit.await())
        replacement.await()
        assertFalse(snapshotReduceAfterReplacement.get())
        scope.cancel()
    }

    @Test
    fun generationCommitCallbackMayReenterOwnerWithoutDeadlock() = runBlocking {
        val owner = GenerationTaskOwner()
        val lease = owner.tryAcquire()!!
        var nestedLease: GenerationLease? = null

        assertTrue(
            lease.runIfCurrent {
                nestedLease = owner.tryAcquire()
            },
        )
        assertNotNull(nestedLease)
        nestedLease!!.release()
        lease.release()
    }
}
