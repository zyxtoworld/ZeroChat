package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderKeyImportIntentMetadata
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SyncConfig
import app.zerochat.data.SyncVault
import app.zerochat.data.ZeroChatRepository
import app.zerochat.data.SnapshotCompareAndSetResult
import app.zerochat.data.localResetSnapshotFingerprint
import app.zerochat.security.SecretStore
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger

class AutoSyncCoordinatorConcurrencyTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun closeReleasesTheOwnedSyncClient() {
        val syncClient = mockk<SyncClient>(relaxed = true)
        val coordinator = AutoSyncCoordinator(
            repository = mockk(relaxed = true),
            secretStore = mockk(relaxed = true),
            syncClient = syncClient,
        )

        coordinator.close()

        verify(exactly = 1) { syncClient.close() }
    }

    @Test
    fun manualSyncPreservesConcurrentCommitAndConsumesPendingAutoSync() = runBlocking {
        val repository = repository()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = true)
        val concurrent = snapshot(updatedAt = 200, theme = "dark", autoSync = true)
        repository.save(source)

        val firstStarted = CompletableDeferred<Unit>()
        val releaseFirst = CompletableDeferred<Unit>()
        val secondStarted = CompletableDeferred<Unit>()
        val calls = AtomicInteger()
        val storedKeys = mutableMapOf<String, String>()
        val secrets = secrets(storedKeys)
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } coAnswers {
            val local = firstArg<SyncVault>()
            if (calls.incrementAndGet() == 1) {
                firstStarted.complete(Unit)
                releaseFirst.await()
                SyncVault(
                    data = source.copy(
                        preferences = source.preferences.copy(language = "remote"),
                        updatedAt = 150,
                    ),
                    secrets = ProviderSecrets(mapOf("remote-provider" to "stale-key")),
                )
            } else {
                secondStarted.complete(Unit)
                local
            }
        }
        val callbacks = mutableListOf<AppSnapshot>()
        val coordinator = AutoSyncCoordinator(
            repository,
            secrets,
            syncClient,
            onSynced = { _, commit -> callbacks += commit.snapshot },
        )

        val manual = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.syncNow(source)
        }
        firstStarted.await()
        repository.save(concurrent)
        val pending = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.enqueue(concurrent)
        }
        releaseFirst.complete(Unit)

        assertNull(manual.await())
        pending.await()
        secondStarted.await()

        val committed = repository.load()
        assertEquals("dark", committed.preferences.theme)
        assertEquals(concurrent.updatedAt, committed.updatedAt)
        assertFalse(hasUnsyncedLocalChanges(committed))
        assertEquals(2, calls.get())
        assertEquals(listOf(committed), callbacks)
        assertFalse("stale-key" in storedKeys.values)
    }

    @Test
    fun manualSyncQueuedBehindSnapshotReplacementIsDroppedBeforeProviderRequest() = runBlocking {
        val repository = repository()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        repository.save(source)

        val replacementStarted = CompletableDeferred<Unit>()
        val releaseReplacement = CompletableDeferred<Unit>()
        val providerCalls = AtomicInteger()
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } coAnswers {
            providerCalls.incrementAndGet()
            SyncVault(data = source)
        }
        val coordinator = AutoSyncCoordinator(
            repository = repository,
            secretStore = secrets(),
            syncClient = syncClient,
        )

        val replacement = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.runExclusiveSnapshotReplacement {
                replacementStarted.complete(Unit)
                releaseReplacement.await()
            }
        }
        replacementStarted.await()

        val manual = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.syncNow(source)
        }
        releaseReplacement.complete(Unit)

        replacement.await()
        assertNull(manual.await())
        assertEquals(0, providerCalls.get())
    }

    @Test
    fun autoSyncEnqueuedDuringSnapshotReplacementSurvivesReplacementCleanup() = runBlocking {
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = true)
        val newer = snapshot(updatedAt = 200, theme = "dark", autoSync = true)
        val requestStarted = CompletableDeferred<AppSnapshot>()
        val replacementStarted = CompletableDeferred<Unit>()
        val releaseReplacement = CompletableDeferred<Unit>()
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } coAnswers {
            val local = firstArg<SyncVault>()
            requestStarted.complete(local.data)
            local
        }
        val repository = mockk<ZeroChatRepository>()
        coEvery { repository.compareAndSet(any(), any()) } coAnswers {
            SnapshotCompareAndSetResult(
                snapshot = secondArg(),
                revision = 1,
                committed = true,
            )
        }
        val coordinator = AutoSyncCoordinator(
            repository = repository,
            secretStore = secrets(),
            syncClient = syncClient,
        )

        val replacement = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.runExclusiveSnapshotReplacement {
                replacementStarted.complete(Unit)
                releaseReplacement.await()
            }
        }
        replacementStarted.await()

        val pending = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.enqueue(newer)
        }
        releaseReplacement.complete(Unit)
        replacement.await()
        pending.await()

        val observed = withTimeout(2_000) { requestStarted.await() }
        assertEquals("dark", observed.preferences.theme)
    }

    @Test
    fun autoSyncCasRejectsConcurrentSyncSettingCommit() = runBlocking {
        val repository = repository()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = true)
        val concurrent = snapshot(updatedAt = 200, theme = "dark", autoSync = false)
        repository.save(source)

        val requestStarted = CompletableDeferred<Unit>()
        val releaseResponse = CompletableDeferred<Unit>()
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } coAnswers {
            requestStarted.complete(Unit)
            releaseResponse.await()
            SyncVault(
                data = source.copy(
                    preferences = source.preferences.copy(language = "remote"),
                    updatedAt = 150,
                ),
            )
        }
        val callbacks = mutableListOf<AppSnapshot>()
        val coordinator = AutoSyncCoordinator(
            repository,
            secrets(),
            syncClient,
            onSynced = { _, commit -> callbacks += commit.snapshot },
        )

        val sync = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.enqueue(source)
        }
        requestStarted.await()
        repository.save(concurrent)
        releaseResponse.complete(Unit)
        sync.await()

        assertEquals(concurrent, repository.load())
        assertEquals(emptyList<AppSnapshot>(), callbacks)
    }

    @Test
    fun autoSyncCommitFailureIsReportedWithoutEscapingTheCoordinator() = runBlocking {
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = true)
        val failure = IllegalStateException("snapshot disk full")
        val repository = mockk<ZeroChatRepository>()
        coEvery { repository.compareAndSet(any(), any()) } throws failure
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } returns SyncVault(data = source.copy(updatedAt = 150))
        val notices = mutableListOf<Pair<String, Boolean>>()
        val notifier = object : SyncStatusNotifier {
            override fun ensureChannel() = Unit
            override fun showStatus(message: String, completed: Boolean) {
                notices += message to completed
            }
            override fun clear() = Unit
        }
        val callbacks = mutableListOf<AppSnapshot>()
        val coordinator = AutoSyncCoordinator(
            repository = repository,
            secretStore = secrets(),
            syncClient = syncClient,
            statusNotifier = notifier,
            onSynced = { _, commit -> callbacks += commit.snapshot },
        )

        val result = runCatching {
            coordinator.enqueue(source)
        }

        assertTrue(result.isSuccess)
        assertEquals(emptyList<AppSnapshot>(), callbacks)
        assertEquals(listOf("snapshot disk full" to false), notices)
    }

    @Test
    fun staleManualSyncRestoresProviderKeysWhenSnapshotAcceptanceLosesRace() = runBlocking {
        val repository = repository()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val concurrent = snapshot(updatedAt = 200, theme = "dark", autoSync = false)
        repository.save(source)

        val requestStarted = CompletableDeferred<Unit>()
        val releaseResponse = CompletableDeferred<Unit>()
        val storedKeys = mutableMapOf("openai" to "local-key")
        val secretWriteBatches = mutableListOf<Map<String, String>>()
        val syncClient = mockk<SyncClient>()
        coEvery {
            syncClient.syncGistVault(
                vault = any(),
                passphrase = any(),
                gistId = any(),
                gistFile = any(),
                token = any(),
                firstSyncStrategy = any(),
                hasCompletedSync = any(),
                hasLocalUserContent = any(),
                hasUnsyncedLocalChanges = any(),
            )
        } coAnswers {
            requestStarted.complete(Unit)
            releaseResponse.await()
            SyncVault(
                data = source.copy(updatedAt = 150),
                secrets = ProviderSecrets(mapOf("openai" to "remote-key")),
            )
        }
        val coordinator = AutoSyncCoordinator(
            repository,
            secrets(storedKeys, secretWriteBatches),
            syncClient,
            onSynced = { _, _ -> error("Stale sync must not publish a callback") },
        )

        val sync = async(start = CoroutineStart.UNDISPATCHED) {
            coordinator.syncNow(source)
        }
        requestStarted.await()
        repository.save(concurrent)
        releaseResponse.complete(Unit)

        assertNull(sync.await())
        assertEquals(concurrent, repository.load())
        assertEquals(mapOf("openai" to "local-key"), storedKeys)
        assertEquals(2, secretWriteBatches.size)
        assertEquals("remote-key", secretWriteBatches[0]["openai"])
        assertEquals("local-key", secretWriteBatches[1]["openai"])
        assertEquals("", secretWriteBatches[0]["anthropic"])
        assertEquals("", secretWriteBatches[1]["anthropic"])
    }

    @Test
    fun providerKeysRollbackWhenSnapshotCommitFails() = runBlocking {
        val stored = mutableMapOf(
            "provider-a" to "old-a",
            "provider-b" to "old-b",
        )
        val previous = stored.toMap()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val candidate = snapshot(updatedAt = 101, theme = "light", autoSync = false)
        val failure = IllegalStateException("snapshot disk full")
        val events = mutableListOf<String>()

        val thrown = runCatching {
            commitSyncedSnapshotAndProviderKeys(
                source = source,
                candidate = candidate,
                replacements = mapOf(
                    "provider-a" to "new-a",
                    "provider-b" to "new-b",
                ),
                stageProviderKeys = {
                    events += "stage"
                    stored.putAll(it)
                },
                finishProviderKeys = { events += "finish" },
                restoreProviderKeys = {
                    events += "restore"
                    stored.clear()
                    stored.putAll(previous)
                },
                compareAndSetSnapshot = { _, _ ->
                    events += "snapshot"
                    throw failure
                },
            )
        }.exceptionOrNull()

        assertEquals(failure, thrown)
        assertEquals(mapOf("provider-a" to "old-a", "provider-b" to "old-b"), stored)
        assertEquals(listOf("stage", "snapshot", "restore"), events)
    }

    @Test
    fun providerKeysRollbackWhenSnapshotCompareAndSetRejects() = runBlocking {
        val stored = mutableMapOf("provider-a" to "old-a")
        val previous = stored.toMap()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val candidate = snapshot(updatedAt = 101, theme = "light", autoSync = false)
        val current = snapshot(updatedAt = 200, theme = "dark", autoSync = false)

        val result = commitSyncedSnapshotAndProviderKeys(
            source = source,
            candidate = candidate,
            replacements = mapOf("provider-a" to "new-a"),
            stageProviderKeys = { stored.putAll(it) },
            finishProviderKeys = {},
            restoreProviderKeys = {
                stored.clear()
                stored.putAll(previous)
            },
            compareAndSetSnapshot = { _, _ ->
                SnapshotCompareAndSetResult(
                    snapshot = current,
                    revision = 2,
                    committed = false,
                )
            },
        )

        assertFalse(result.committed)
        assertEquals(mapOf("provider-a" to "old-a"), stored)
    }

    @Test
    fun providerKeyFinalizationFailureRollsSnapshotBackBeforeRestoringKeys() = runBlocking {
        val stored = mutableMapOf("provider-a" to "old-a")
        val previous = stored.toMap()
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val candidate = snapshot(updatedAt = 101, theme = "remote", autoSync = false)
        val events = mutableListOf<String>()
        var compareCalls = 0

        val thrown = runCatching {
            commitSyncedSnapshotAndProviderKeys(
                source = source,
                candidate = candidate,
                replacements = mapOf("provider-a" to "remote-a"),
                stageProviderKeys = {
                    events += "stage"
                    stored.putAll(it)
                },
                finishProviderKeys = {
                    events += "finish"
                    error("credential finalization failed")
                },
                restoreProviderKeys = {
                    events += "restore"
                    stored.clear()
                    stored.putAll(previous)
                },
                compareAndSetSnapshot = { _, replacement ->
                    compareCalls += 1
                    events += if (compareCalls == 1) "commit" else "rollback"
                    SnapshotCompareAndSetResult(
                        snapshot = replacement,
                        revision = compareCalls.toLong(),
                        committed = true,
                    )
                },
            )
        }.exceptionOrNull()

        assertEquals("credential finalization failed", thrown?.message)
        assertEquals(mapOf("provider-a" to "old-a"), stored)
        assertEquals(listOf("stage", "commit", "finish", "rollback", "restore"), events)
    }

    @Test
    fun providerKeyFinalizationRetryKeepsAlreadyCommittedCandidate() = runBlocking {
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val candidate = snapshot(updatedAt = 101, theme = "remote", autoSync = false)
        val events = mutableListOf<String>()
        var finishCalls = 0
        var compareCalls = 0

        val result = commitSyncedSnapshotAndProviderKeys(
            source = source,
            candidate = candidate,
            replacements = mapOf("provider-a" to "remote-a"),
            stageProviderKeys = { events += "stage" },
            finishProviderKeys = {
                finishCalls += 1
                events += "finish-$finishCalls"
                if (finishCalls == 1) error("first finish failed")
            },
            restoreProviderKeys = { events += "restore" },
            compareAndSetSnapshot = { _, _ ->
                compareCalls += 1
                events += if (compareCalls == 1) "commit" else "rollback-rejected"
                if (compareCalls == 1) {
                    SnapshotCompareAndSetResult(candidate, 2, committed = true)
                } else {
                    SnapshotCompareAndSetResult(candidate, 2, committed = false)
                }
            },
        )

        assertTrue(result.committed)
        assertEquals(candidate, result.snapshot)
        assertEquals(
            listOf("stage", "commit", "finish-1", "rollback-rejected", "finish-2"),
            events,
        )
    }

    @Test
    fun syncedProviderKeyIntentBindsDistinctDurableSnapshotFingerprints() {
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val candidate = snapshot(updatedAt = 101, theme = "remote", autoSync = false)

        val intent = providerKeyIntentForSyncedSnapshot(source, candidate)

        assertEquals(localResetSnapshotFingerprint(source), intent.sourceFingerprint)
        assertEquals(localResetSnapshotFingerprint(candidate), intent.replacementFingerprint)
        assertEquals(candidate.updatedAt, intent.replacementUpdatedAt)
        assertFalse(intent.sourceFingerprint == intent.replacementFingerprint)
    }

    @Test
    fun syncedProviderKeyCandidateAdvancesOnlyWhenMergedSnapshotIsIdentical() {
        val source = snapshot(updatedAt = 100, theme = "light", autoSync = false)
        val alreadyDistinct = snapshot(updatedAt = 100, theme = "remote", autoSync = false)

        assertEquals(
            source.copy(updatedAt = 101),
            ensureDistinctSyncedProviderKeyCandidate(source, source),
        )
        assertEquals(
            alreadyDistinct,
            ensureDistinctSyncedProviderKeyCandidate(source, alreadyDistinct),
        )
    }

    private fun repository(): ZeroChatRepository =
        ZeroChatRepository(tempDir.toFile(), "snapshot.v1.json")

    private fun secrets(
        storedKeys: MutableMap<String, String> = mutableMapOf(),
        writeBatches: MutableList<Map<String, String>> = mutableListOf(),
    ): SecretStore =
        mockk<SecretStore>().also { store ->
            var pendingIntent: ProviderKeyImportIntentMetadata? = null
            var pendingPrevious = emptyMap<String, String>()
            var pendingReplacements = emptyMap<String, String>()

            fun applyKeys(values: Map<String, String>) {
                values.forEach { (providerId, value) ->
                    if (value.isBlank()) {
                        storedKeys.remove(providerId)
                    } else {
                        storedKeys[providerId] = value
                    }
                }
            }

            every { store.syncPassphrase() } returns "passphrase"
            every { store.githubToken() } returns "token"
            every { store.providerKey(any()) } answers { storedKeys[firstArg()].orEmpty() }
            every { store.setProviderKey(any(), any()) } answers {
                storedKeys[firstArg()] = secondArg()
            }
            every { store.stageProviderKeyImport(any(), any()) } answers {
                val intent = firstArg<ProviderKeyImportIntentMetadata>()
                val replacements = secondArg<Map<String, String>>().mapValues { it.value.trim() }
                if (pendingIntent == null) {
                    pendingIntent = intent
                    pendingPrevious = replacements.keys.associateWith { storedKeys[it].orEmpty() }
                    pendingReplacements = replacements
                    writeBatches += replacements
                    applyKeys(replacements)
                } else {
                    check(pendingIntent == intent && pendingReplacements == replacements)
                }
            }
            every { store.finishProviderKeyImport(any()) } answers {
                check(pendingIntent == firstArg<ProviderKeyImportIntentMetadata>())
                applyKeys(pendingReplacements)
                pendingIntent = null
                pendingPrevious = emptyMap()
                pendingReplacements = emptyMap()
            }
            every { store.restoreProviderKeyImport(any()) } answers {
                check(pendingIntent == firstArg<ProviderKeyImportIntentMetadata>())
                writeBatches += pendingPrevious
                applyKeys(pendingPrevious)
                pendingIntent = null
                pendingPrevious = emptyMap()
                pendingReplacements = emptyMap()
            }
        }

    private fun snapshot(
        updatedAt: Long,
        theme: String,
        autoSync: Boolean,
    ): AppSnapshot =
        AppSnapshot(
            sync = SyncConfig(
                mode = "gist",
                autoSync = autoSync,
                gistId = "gist-id",
            ),
            preferences = Preferences(theme = theme),
            updatedAt = updatedAt,
        )
}
