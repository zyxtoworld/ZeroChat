package app.zerochat.ui.settings

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.SnapshotCompareAndSetResult
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ProviderDeletionTransactionTest {
    @Test
    fun commitsSnapshotBeforeRemovingCredentialAndPendingIntent() = runBlocking {
        val source = snapshot("deleted", "fallback")
        val candidate = snapshot("fallback")
        val events = mutableListOf<String>()

        val commit = commitProviderDeletionTransaction(
            providerId = "deleted",
            source = source,
            candidate = candidate,
            sourceRevision = 7,
            currentRevision = { 7 },
            stageCredentialDeletion = { events += "stage" },
            finishCredentialDeletion = { events += "finish" },
            cancelCredentialDeletion = { events += "cancel" },
            compareAndSetSnapshot = { expected, replacement ->
                assertEquals(source, expected)
                assertEquals(candidate, replacement)
                events += "snapshot"
                SnapshotCompareAndSetResult(candidate, 11, committed = true)
            },
        )

        assertEquals(listOf("stage", "snapshot", "finish"), events)
        assertEquals(candidate, commit.snapshot)
        assertEquals(11, commit.revision)
    }

    @Test
    fun rejectsStaleSnapshotAndCancelsDeletionIntent() {
        val source = snapshot("deleted", "fallback")
        val candidate = snapshot("fallback")
        val events = mutableListOf<String>()

        assertThrows(ProviderDeletionConflictException::class.java) {
            runBlocking {
                commitProviderDeletionTransaction(
                    providerId = "deleted",
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageCredentialDeletion = { events += "stage" },
                    finishCredentialDeletion = { events += "finish" },
                    cancelCredentialDeletion = { events += "cancel" },
                    compareAndSetSnapshot = { _, _ ->
                        events += "snapshot"
                        SnapshotCompareAndSetResult(source, 4, committed = false)
                    },
                )
            }
        }

        assertEquals(listOf("stage", "snapshot", "cancel"), events)
    }

    @Test
    fun concurrentVisibleRevisionRollsSnapshotBackBeforeCancellingIntent() {
        val source = snapshot("deleted", "fallback")
        val candidate = snapshot("fallback")
        val events = mutableListOf<String>()
        var call = 0

        assertThrows(ProviderDeletionConflictException::class.java) {
            runBlocking {
                commitProviderDeletionTransaction(
                    providerId = "deleted",
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    stageCredentialDeletion = { events += "stage" },
                    finishCredentialDeletion = { events += "finish" },
                    cancelCredentialDeletion = { events += "cancel" },
                    compareAndSetSnapshot = { _, replacement ->
                        call += 1
                        events += if (call == 1) "commit" else "rollback"
                        SnapshotCompareAndSetResult(replacement, call.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals(listOf("stage", "commit", "rollback", "cancel"), events)
    }

    @Test
    fun credentialFinishFailureRollsSnapshotBackAndPreservesProviderKey() {
        val source = snapshot("deleted", "fallback")
        val candidate = snapshot("fallback")
        val credentialPresent = true
        var pending = false
        var call = 0

        val failure = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                commitProviderDeletionTransaction(
                    providerId = "deleted",
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 1 },
                    stageCredentialDeletion = { pending = true },
                    finishCredentialDeletion = { throw IllegalStateException("key store failed") },
                    cancelCredentialDeletion = { pending = false },
                    compareAndSetSnapshot = { _, replacement ->
                        call += 1
                        SnapshotCompareAndSetResult(replacement, call.toLong(), committed = true)
                    },
                )
            }
        }

        assertEquals("key store failed", failure.message)
        assertEquals(2, call)
        assertTrue(credentialPresent)
        assertFalse(pending)
    }

    @Test
    fun rollbackCancellationRemainsThePrimarySignal() {
        val source = snapshot("deleted", "fallback")
        val candidate = snapshot("fallback")
        var call = 0

        val cancellation = assertThrows(CancellationException::class.java) {
            runBlocking {
                commitProviderDeletionTransaction(
                    providerId = "deleted",
                    source = source,
                    candidate = candidate,
                    sourceRevision = 1,
                    currentRevision = { 2 },
                    stageCredentialDeletion = {},
                    finishCredentialDeletion = {},
                    cancelCredentialDeletion = {},
                    compareAndSetSnapshot = { _, replacement ->
                        call += 1
                        if (call == 2) {
                            throw CancellationException("cancel rollback")
                        }
                        SnapshotCompareAndSetResult(replacement, 1, committed = true)
                    },
                )
            }
        }

        assertEquals("cancel rollback", cancellation.message)
        assertTrue(cancellation.suppressed.single() is ProviderDeletionConflictException)
    }

    private fun snapshot(vararg providerIds: String): AppSnapshot = AppSnapshot(
        providers = providerIds.map { id ->
            ProviderConfig(
                id = id,
                name = id,
                kind = ProviderKind.OpenAICompatible,
                baseUrl = "https://example.invalid/v1",
                model = "$id-model",
                enabled = true,
                needsApiKey = true,
                createdAt = 1,
                updatedAt = 1,
            )
        },
    )
}
