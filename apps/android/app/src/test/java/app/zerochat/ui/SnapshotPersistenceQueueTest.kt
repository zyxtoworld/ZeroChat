package app.zerochat.ui

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Preferences
import app.zerochat.data.SnapshotCommit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicInteger

class SnapshotPersistenceQueueTest {
    @Test
    fun queuedWritesRunInSubmissionOrder() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val queue = SnapshotPersistenceQueue(scope)
        val firstMayFinish = CompletableDeferred<Unit>()
        val order = mutableListOf<String>()

        val first = queue.enqueue {
            order += "first-start"
            firstMayFinish.await()
            order += "first-end"
        }
        val second = queue.enqueue { order += "second" }

        assertEquals(listOf("first-start"), order)
        firstMayFinish.complete(Unit)
        first.join()
        second.join()

        assertEquals(listOf("first-start", "first-end", "second"), order)
        scope.cancel()
    }

    @Test
    fun successfulSyncAdvancesRollbackBaselineBeforeLaterSaveFailure() {
        val initial = snapshot(updatedAt = 100, theme = "light")
        val synced = snapshot(updatedAt = 200, theme = "system")
        val failedLocal = snapshot(updatedAt = 300, theme = "dark")
        val baseline = CommittedSnapshotBaseline()
        baseline.initialize(initial)

        val published = baseline.acceptSynced(
            current = initial,
            source = initial,
            commit = SnapshotCommit(synced, revision = 2),
        )
        baseline.advance(SnapshotCommit(initial, revision = 1))
        val rolledBack = baseline.rollbackFailed(failedLocal, failedLocal)

        assertEquals(synced, published)
        assertEquals(synced, baseline.snapshot())
        assertEquals(synced, rolledBack)
    }

    @Test
    fun activityReloadDoesNotDowngradeTheProcessCommitBaseline() {
        val initial = snapshot(updatedAt = 100, theme = "light")
        val synced = snapshot(updatedAt = 200, theme = "dark")
        val baseline = CommittedSnapshotBaseline()
        baseline.initialize(initial)
        baseline.advance(SnapshotCommit(synced, revision = 2))

        baseline.initialize(initial)

        assertEquals(synced, baseline.snapshot())
    }

    @Test
    fun staleSyncedCommitDoesNotPublishOrDowngradeBaseline() {
        val committed = snapshot(updatedAt = 300, theme = "dark")
        val current = snapshot(updatedAt = 400, theme = "system")
        val stale = snapshot(updatedAt = 200, theme = "light")
        val baseline = CommittedSnapshotBaseline()
        baseline.initialize(committed, revision = 3)

        val published = baseline.acceptSynced(
            current = current,
            source = current,
            commit = SnapshotCommit(stale, revision = 2),
        )

        assertEquals(current, published)
        assertEquals(committed, baseline.snapshot())
    }

    @Test
    fun activityCollectorReplacementReceivesProcessOwnedSaveAndSingleSync() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val saveStarted = CompletableDeferred<Unit>()
        val releaseSave = CompletableDeferred<Unit>()
        val source = snapshot(updatedAt = 100, theme = "light")
        val synced = snapshot(updatedAt = 200, theme = "dark")
        val syncCalls = AtomicInteger()
        lateinit var owner: SnapshotPersistenceOwner
        owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                saveStarted.complete(Unit)
                releaseSave.await()
                Result.success(SnapshotCommit(candidate, revision = 1L))
            },
            requestAutoSync = { candidate ->
                syncCalls.incrementAndGet()
                owner.publishSynced(candidate, SnapshotCommit(synced, revision = 2L))
            },
        )
        val oldEvents = mutableListOf<SnapshotPersistenceEvent>()
        val oldCollector = scope.launch {
            owner.events.collect(oldEvents::addAll)
        }

        val save = owner.enqueueSnapshot(source, shouldSync = true)
        saveStarted.await()
        oldCollector.cancelAndJoin()
        val currentSynced = scope.async {
            owner.events
                .mapNotNull { events ->
                    events.filterIsInstance<SnapshotPersistenceEvent.Synced>().lastOrNull()
                }
                .first()
        }

        releaseSave.complete(Unit)
        save.join()
        val event = currentSynced.await()

        assertEquals(emptyList<SnapshotPersistenceEvent>(), oldEvents)
        assertEquals(1, syncCalls.get())
        assertEquals(source, event.source)
        assertEquals(synced, event.commit.snapshot)
        owner.acknowledge(event.sequence)
        assertEquals(emptyList<SnapshotPersistenceEvent>(), owner.events.value)
        scope.cancel()
    }

    @Test
    fun slowAutoSyncDoesNotHoldThePersistenceQueue() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val syncStarted = CompletableDeferred<Unit>()
        val releaseSync = CompletableDeferred<Unit>()
        val persisted = mutableListOf<AppSnapshot>()
        val first = snapshot(updatedAt = 100, theme = "light")
        val second = snapshot(updatedAt = 200, theme = "dark")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {
                syncStarted.complete(Unit)
                releaseSync.await()
            },
        )

        try {
            owner.enqueueSnapshot(first, shouldSync = true)
            syncStarted.await()
            val secondSave = owner.enqueueSnapshot(second, shouldSync = false)

            withTimeout(1_000) { secondSave.join() }

            assertEquals(listOf(first, second), persisted)
        } finally {
            releaseSync.complete(Unit)
            scope.cancel()
        }
    }

    @Test
    fun snapshotMutationAdmittedDuringReplacementDoesNotPersistAfterReplacement() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val replacementStarted = CompletableDeferred<Unit>()
        val releaseReplacement = CompletableDeferred<Unit>()
        val persisted = mutableListOf<AppSnapshot>()
        val replacement = snapshot(updatedAt = 300, theme = "reset")
        val staleMutation = snapshot(updatedAt = 400, theme = "stale-edit")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {},
        )

        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement {
                replacementStarted.complete(Unit)
                releaseReplacement.await()
                persisted += replacement
            }
        }
        replacementStarted.await()

        val staleSave = owner.enqueueSnapshot(staleMutation, shouldSync = false)
        releaseReplacement.complete(Unit)

        replacementJob.await()
        withTimeout(1_000) { staleSave.join() }

        assertEquals(listOf(replacement), persisted)
        scope.cancel()
    }

    @Test
    fun admittedSaveSurvivesReplacementThatIsCanceledBeforeQueueOwnership() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val blockerStarted = CompletableDeferred<Unit>()
        val releaseBlocker = CompletableDeferred<Unit>()
        val persisted = mutableListOf<AppSnapshot>()
        val replacementBlockCalls = AtomicInteger()
        val blocker = snapshot(updatedAt = 100, theme = "blocker")
        val admitted = snapshot(updatedAt = 200, theme = "admitted")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                if (candidate == blocker) {
                    blockerStarted.complete(Unit)
                    releaseBlocker.await()
                }
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {},
        )

        val blockerJob = owner.enqueueSnapshot(blocker, shouldSync = false)
        blockerStarted.await()
        val admittedJob = owner.enqueueSnapshot(admitted, shouldSync = false)
        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement {
                replacementBlockCalls.incrementAndGet()
                error("canceled before queue ownership")
            }
        }

        replacementJob.cancelAndJoin()
        releaseBlocker.complete(Unit)
        blockerJob.join()
        admittedJob.join()

        assertEquals(0, replacementBlockCalls.get())
        assertEquals(listOf(blocker, admitted), persisted)
        assertEquals(
            listOf(blocker, admitted),
            owner.events.value.map { it.source },
        )
        scope.cancel()
    }

    @Test
    fun admittedSnapshotMutationSurvivesReplacementCanceledBeforeQueueOwnership() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val blockerStarted = CompletableDeferred<Unit>()
        val releaseBlocker = CompletableDeferred<Unit>()
        val mutationRuns = AtomicInteger()
        val blocker = snapshot(updatedAt = 100, theme = "blocker")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                if (candidate == blocker) {
                    blockerStarted.complete(Unit)
                    releaseBlocker.await()
                }
                Result.success(SnapshotCommit(candidate, 1L))
            },
            requestAutoSync = {},
        )

        val blockerJob = owner.enqueueSnapshot(blocker, shouldSync = false)
        blockerStarted.await()
        val mutation = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotMutation {
                mutationRuns.incrementAndGet()
                "admitted"
            }
        }
        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement { error("canceled before queue ownership") }
        }

        replacementJob.cancelAndJoin()
        releaseBlocker.complete(Unit)
        blockerJob.join()

        assertEquals("admitted", mutation.await())
        assertEquals(1, mutationRuns.get())
        scope.cancel()
    }

    @Test
    fun successfulReplacementDropsAdmittedSnapshotMutationBeforeExecution() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val blockerStarted = CompletableDeferred<Unit>()
        val releaseBlocker = CompletableDeferred<Unit>()
        val mutationRuns = AtomicInteger()
        val blocker = snapshot(updatedAt = 100, theme = "blocker")
        val replacement = snapshot(updatedAt = 200, theme = "replacement")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                if (candidate == blocker) {
                    blockerStarted.complete(Unit)
                    releaseBlocker.await()
                }
                Result.success(SnapshotCommit(candidate, 1L))
            },
            requestAutoSync = {},
        )

        val blockerJob = owner.enqueueSnapshot(blocker, shouldSync = false)
        blockerStarted.await()
        val mutation = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotMutation {
                mutationRuns.incrementAndGet()
                "stale"
            }
        }
        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement { replacement }
        }

        releaseBlocker.complete(Unit)
        blockerJob.join()
        replacementJob.await()

        val failure = runCatching { mutation.await() }.exceptionOrNull()
        assertTrue(failure is SnapshotReplacementInProgressException)
        assertEquals(0, mutationRuns.get())
        scope.cancel()
    }

    @Test
    fun successfulReplacementOwnsQueueAndDropsEarlierAdmittedSave() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val blockerStarted = CompletableDeferred<Unit>()
        val releaseBlocker = CompletableDeferred<Unit>()
        val persisted = mutableListOf<AppSnapshot>()
        val blocker = snapshot(updatedAt = 100, theme = "blocker")
        val admitted = snapshot(updatedAt = 200, theme = "admitted")
        val replacement = snapshot(updatedAt = 300, theme = "replacement")
        val afterReplacement = snapshot(updatedAt = 400, theme = "after-replacement")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                if (candidate == blocker) {
                    blockerStarted.complete(Unit)
                    releaseBlocker.await()
                }
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {},
        )

        val blockerJob = owner.enqueueSnapshot(blocker, shouldSync = false)
        blockerStarted.await()
        val admittedJob = owner.enqueueSnapshot(admitted, shouldSync = false)
        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement { persisted += replacement }
        }

        releaseBlocker.complete(Unit)
        blockerJob.join()
        replacementJob.await()
        admittedJob.join()

        assertEquals(
            listOf(blocker),
            owner.events.value.map { it.source },
        )

        val afterReplacementJob = owner.enqueueSnapshot(afterReplacement, shouldSync = false)
        afterReplacementJob.join()

        assertEquals(listOf(blocker, replacement, afterReplacement), persisted)
        assertEquals(
            listOf(blocker, afterReplacement),
            owner.events.value.map { it.source },
        )
        scope.cancel()
    }

    @Test
    fun droppedAdmittedSaveNotifiesOwnerToRollbackPublishedSnapshot() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val blockerStarted = CompletableDeferred<Unit>()
        val releaseBlocker = CompletableDeferred<Unit>()
        val persisted = mutableListOf<AppSnapshot>()
        val visible = mutableListOf<AppSnapshot>()
        val synced = mutableListOf<AppSnapshot>()
        val dropped = mutableListOf<AppSnapshot>()
        val blocker = snapshot(updatedAt = 100, theme = "blocker")
        val admitted = snapshot(updatedAt = 200, theme = "admitted")
        val replacement = snapshot(updatedAt = 300, theme = "replacement")
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                if (candidate == blocker) {
                    blockerStarted.complete(Unit)
                    releaseBlocker.await()
                }
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = { synced += it },
        )

        val blockerJob = owner.enqueueSnapshot(blocker, shouldSync = false)
        blockerStarted.await()
        val admittedJob = owner.tryEnqueueSnapshot(
            candidate = admitted,
            shouldSync = true,
            beforeEnqueue = { visible += admitted },
            onDropped = { dropped += admitted },
        )
        checkNotNull(admittedJob)
        val replacementJob = scope.async(start = kotlinx.coroutines.CoroutineStart.UNDISPATCHED) {
            owner.runSnapshotReplacement { persisted += replacement }
        }

        releaseBlocker.complete(Unit)
        blockerJob.join()
        replacementJob.await()
        admittedJob.join()

        assertEquals(listOf(admitted), visible)
        assertEquals(listOf(admitted), dropped)
        assertEquals(listOf(blocker, replacement), persisted)
        assertEquals(emptyList<AppSnapshot>(), synced)
        scope.cancel()
    }

    @Test
    fun failedReplacementReleasesAdmissionForTheNextSnapshotSave() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val persisted = mutableListOf<AppSnapshot>()
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {},
        )

        assertThrows(IllegalStateException::class.java) {
            runBlocking {
                owner.runSnapshotReplacement {
                    error("replacement failed")
                }
            }
        }

        val next = snapshot(updatedAt = 500, theme = "after-failure")
        val save = owner.enqueueSnapshot(next, shouldSync = false)
        withTimeout(1_000) { save.join() }

        assertEquals(listOf(next), persisted)
        scope.cancel()
    }

    @Test
    fun canceledReplacementReleasesAdmissionForTheNextSnapshotSave() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val persisted = mutableListOf<AppSnapshot>()
        val owner = SnapshotPersistenceOwner(
            scope = scope,
            persistSnapshot = { candidate ->
                persisted += candidate
                Result.success(SnapshotCommit(candidate, persisted.size.toLong()))
            },
            requestAutoSync = {},
        )

        assertThrows(CancellationException::class.java) {
            runBlocking {
                owner.runSnapshotReplacement {
                    throw CancellationException("replacement canceled")
                }
            }
        }

        val next = snapshot(updatedAt = 600, theme = "after-cancel")
        val save = owner.enqueueSnapshot(next, shouldSync = false)
        withTimeout(1_000) { save.join() }

        assertEquals(listOf(next), persisted)
        scope.cancel()
    }

    private fun snapshot(updatedAt: Long, theme: String): AppSnapshot =
        AppSnapshot(
            preferences = Preferences(theme = theme),
            updatedAt = updatedAt,
        )
}
