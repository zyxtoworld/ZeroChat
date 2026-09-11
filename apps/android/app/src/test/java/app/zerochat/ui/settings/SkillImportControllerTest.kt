package app.zerochat.ui.settings

import app.zerochat.data.UserSkill
import app.zerochat.ui.chat.GenerationTaskOwner
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SkillImportControllerTest {
    @Test
    fun replacementDrainsSkillReadBeforeItCanPublishAnImportedSkill() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val readStarted = CompletableDeferred<Unit>()
        val cancellationObserved = CompletableDeferred<Unit>()
        val releaseRead = CompletableDeferred<Unit>()
        val imported = AtomicInteger()
        val notices = AtomicInteger()

        val job = launchSkillImport(
            scope = scope,
            generationTasks = owner,
            read = {
                readStarted.complete(Unit)
                try {
                    releaseRead.await()
                } catch (_: CancellationException) {
                    cancellationObserved.complete(Unit)
                    withContext(NonCancellable) {
                        releaseRead.await()
                    }
                }
                sampleSkill()
            },
            onImported = { imported.incrementAndGet() },
            onFailure = { notices.incrementAndGet() },
        )!!

        readStarted.await()
        val replacement = async {
            owner.withDrain { }
        }

        assertFalse(replacement.isCompleted)
        cancellationObserved.await()
        assertTrue(owner.tryAcquire() == null)
        releaseRead.complete(Unit)
        replacement.await()
        job.join()

        assertEquals(0, imported.get())
        assertEquals(0, notices.get())
        val nextLease = owner.tryAcquire()
        assertTrue(nextLease != null)
        nextLease?.release()
        scope.cancel()
    }

    @Test
    fun completedSkillImportPublishesExactlyOnceWhileItsLeaseIsCurrent() = runBlocking {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val owner = GenerationTaskOwner()
        val imported = AtomicInteger()
        val notices = AtomicInteger()

        val job = launchSkillImport(
            scope = scope,
            generationTasks = owner,
            read = { sampleSkill() },
            onImported = { imported.incrementAndGet() },
            onFailure = { notices.incrementAndGet() },
        )!!
        job.join()

        assertEquals(1, imported.get())
        assertEquals(0, notices.get())
        scope.cancel()
    }

    private fun sampleSkill(): UserSkill = UserSkill(
        id = "imported-skill",
        name = "Imported",
        createdAt = 1L,
        updatedAt = 1L,
    )
}
