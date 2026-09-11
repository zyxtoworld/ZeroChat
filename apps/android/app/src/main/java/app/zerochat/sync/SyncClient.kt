package app.zerochat.sync

import app.zerochat.runCatchingPreservingCancellation
import app.zerochat.ai.safeGeneratedImageDataUrl
import app.zerochat.data.AttachmentContentChunk
import app.zerochat.data.ConversationChunk
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.IncrementalManifest
import app.zerochat.data.IncrementalSyncHead
import app.zerochat.data.SkillContentChunk
import app.zerochat.data.SyncVault
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json

internal const val SYNC_REQUEST_TIMEOUT_MS = 60_000L

internal fun HttpClientConfig<*>.installSyncRequestTimeout(
    timeoutMillis: Long = SYNC_REQUEST_TIMEOUT_MS,
) {
    require(timeoutMillis > 0) { "Sync request timeout must be positive." }
    install(HttpTimeout) {
        requestTimeoutMillis = timeoutMillis
        connectTimeoutMillis = timeoutMillis
        socketTimeoutMillis = timeoutMillis
    }
}

private fun HttpClientConfig<*>.configureSyncClient(json: Json) {
    followRedirects = false
    installSyncRequestTimeout()
    install(ContentNegotiation) {
        json(json)
    }
}

internal suspend fun <T> runWithRollbackOnFailure(
    operation: suspend () -> T,
    rollback: suspend () -> Unit,
): T = try {
    operation()
} catch (error: Throwable) {
    try {
        withContext(NonCancellable) { rollback() }
    } catch (rollbackError: Throwable) {
        error.addSuppressed(rollbackError)
    }
    throw error
}

internal suspend fun publishIncrementalUpload(
    cloudflare: CloudflareSyncTransport,
    endpoint: String,
    token: String,
    upload: BuiltIncrementalUpload,
    previousManifestKey: String?,
    generation: String,
) {
    val rollbackUpload: suspend () -> Unit = {
        for (chunk in upload.chunks) {
            runCatchingPreservingCancellation {
                cloudflare.deleteIncrementalObject(endpoint, token, chunk.key, generation)
            }
        }
        runCatchingPreservingCancellation {
            cloudflare.deleteIncrementalObject(endpoint, token, upload.head.manifestKey, generation)
        }
    }

    runWithRollbackOnFailure(
        operation = {
            for (chunk in upload.chunks) {
                cloudflare.writeIncrementalObject(endpoint, token, chunk.key, chunk.envelope, generation)
            }
            cloudflare.writeIncrementalObject(
                endpoint,
                token,
                upload.head.manifestKey,
                upload.manifestEnvelope,
                generation,
            )
        },
        rollback = rollbackUpload,
    )

    try {
        cloudflare.writeIncrementalHead(
            endpoint = endpoint,
            token = token,
            head = upload.head,
            previousManifestKey = previousManifestKey,
            generation = generation,
        )
    } catch (error: CloudflareHeadConflictException) {
        rollbackUpload()
        throw error
    }
}

enum class FirstSyncStrategy {
    Ask,
    UseLocal,
    UseRemote,
    Merge,
}

class SyncClient(
    private val crypto: CryptoEngine = CryptoEngine(),
    private val providedEngine: HttpClientEngine? = null,
    private val gistCursorStorage: GistCursorStorage = ProcessGistCursorStorage,
) : AutoCloseable {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }
    private val client = providedEngine?.let { engine ->
        HttpClient(engine) {
            configureSyncClient(json)
        }
    } ?: HttpClient(Android) {
        configureSyncClient(json)
    }
    private val cloudflare = CloudflareSyncTransport(client, crypto, json)

    suspend fun syncCloudflareVault(
        vault: SyncVault,
        passphrase: String,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = FirstSyncStrategy.Ask,
        hasCompletedSync: Boolean = false,
        hasLocalUserContent: Boolean = true,
        hasUnsyncedLocalChanges: Boolean = false,
    ): SyncVault {
        val endpoint = normalizeWorkerEndpoint(workerEndpoint)
        val trimmedToken = token.trim()
        require(trimmedToken.isNotBlank()) { "Cloudflare access key is required." }
        require(passphrase.isNotBlank()) { "Data encryption password is required." }

        val head = cloudflare.readIncrementalHead(endpoint, trimmedToken)
        if (head is IncrementalHeadRead.Unsupported) {
            return syncCloudflareSnapshotVault(
                vault = vault,
                passphrase = passphrase,
                endpoint = endpoint,
                token = trimmedToken,
                firstSyncStrategy = firstSyncStrategy,
                hasCompletedSync = hasCompletedSync,
                hasLocalUserContent = hasLocalUserContent,
                hasUnsyncedLocalChanges = hasUnsyncedLocalChanges,
            )
        }
        val generation = when (head) {
            is IncrementalHeadRead.Empty -> head.generation
            is IncrementalHeadRead.Head -> head.generation
            IncrementalHeadRead.Unsupported -> error("Unsupported incremental sync state.")
        }

        val remoteState = (head as? IncrementalHeadRead.Head)?.let {
            IncrementalRemoteState(
                head = it.value,
                manifest = readIncrementalManifest(endpoint, trimmedToken, passphrase, it.value),
            )
        }
        val legacyRead = if (remoteState == null) {
            cloudflare.readSnapshotVault(endpoint, trimmedToken, passphrase)
        } else {
            null
        }
        val remoteVault = remoteState?.manifest?.let {
            manifestToVault(endpoint, trimmedToken, passphrase, it)
        } ?: when (val legacy = requireNotNull(legacyRead)) {
            is LegacySnapshotRead.Missing -> {
                requireSameSyncGeneration(generation, legacy.generation)
                null
            }
            is LegacySnapshotRead.Found -> {
                requireSameSyncGeneration(generation, legacy.generation)
                legacy.value
            }
        }

        val selectedVault = when {
            remoteVault != null && !hasCompletedSync -> {
                when (firstSyncStrategy) {
                    FirstSyncStrategy.UseRemote ->
                        return acceptObservedRemoteVault(
                            remoteVault,
                            vault.data,
                            endpoint,
                            trimmedToken,
                            head,
                            legacyRead,
                        )
                    FirstSyncStrategy.UseLocal -> vault
                    FirstSyncStrategy.Merge -> mergeFirstSyncVault(remoteVault, vault)
                    FirstSyncStrategy.Ask -> {
                        if (!hasLocalUserContent) {
                            return acceptObservedRemoteVault(
                                remoteVault,
                                vault.data,
                                endpoint,
                                trimmedToken,
                                head,
                                legacyRead,
                            )
                        }
                        error("Local and cloud both have data. Choose local, cloud, or merge before syncing.")
                    }
                }
            }
            remoteVault != null && remoteVault.data.updatedAt > vault.data.updatedAt -> {
                if (hasUnsyncedLocalChanges) {
                    mergeCompletedSyncVault(remoteVault, vault)
                } else {
                    return acceptObservedRemoteVault(
                        remoteVault,
                        vault.data,
                        endpoint,
                        trimmedToken,
                        head,
                        legacyRead,
                    )
                }
            }
            else -> vault
        }

        return uploadIncrementalVault(
            vault = selectedVault,
            passphrase = passphrase,
            endpoint = endpoint,
            token = trimmedToken,
            previous = remoteState,
            generation = generation,
        )
    }

    @Suppress("UNUSED_PARAMETER")
    suspend fun syncGistVault(
        vault: SyncVault,
        passphrase: String,
        gistId: String?,
        gistFile: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = FirstSyncStrategy.Ask,
        hasCompletedSync: Boolean = false,
        hasLocalUserContent: Boolean = true,
        hasUnsyncedLocalChanges: Boolean = false,
    ): SyncVault {
        val result = performGistVaultSync(
            client = client,
            json = json,
            crypto = crypto,
            vault = vault,
            passphrase = passphrase,
            gistId = gistId,
            gistFile = gistFile,
            token = token,
            firstSyncStrategy = firstSyncStrategy,
            hasCompletedSync = hasCompletedSync,
            hasLocalUserContent = hasLocalUserContent,
            cursorStorage = gistCursorStorage,
        )
        result.data.sync.gistId?.let { resolvedId ->
            gistPassphrases[resolvedId] = passphrase
        }
        return result
    }

    suspend fun syncCloudflare(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = FirstSyncStrategy.Ask,
        hasCompletedSync: Boolean = false,
        hasLocalUserContent: Boolean = true,
    ): EncryptedSnapshotEnvelope {
        val endpoint = normalizeWorkerEndpoint(workerEndpoint)
        require(token.isNotBlank()) { "Cloudflare access key is required." }

        val trimmedToken = token.trim()
        val head = cloudflare.readIncrementalHead(endpoint, trimmedToken)
        if (head is IncrementalHeadRead.Head) {
            error("Cloudflare has incremental sync data. Native sync must use syncCloudflareVault to keep Web, Android, iOS, macOS, Windows, and Linux data unified.")
        }

        val remoteRead = cloudflare.readSnapshotEnvelope(endpoint, trimmedToken)
        when (head) {
            is IncrementalHeadRead.Empty -> requireSameSyncGeneration(head.generation, remoteRead.generation)
            is IncrementalHeadRead.Head -> error("Incremental sync state changed unexpectedly.")
            IncrementalHeadRead.Unsupported -> Unit
        }
        val remote = (remoteRead as? LegacySnapshotRead.Found)?.value
        if (remote != null) {
            if (remote.kind == "zerochat.encryptedSnapshot") {
                if (!hasCompletedSync) {
                    when (firstSyncStrategy) {
                        FirstSyncStrategy.UseRemote -> {
                            confirmCloudflareObservation(endpoint, trimmedToken, head, remoteRead)
                            return remote
                        }
                        FirstSyncStrategy.UseLocal, FirstSyncStrategy.Merge -> Unit
                        FirstSyncStrategy.Ask -> {
                            if (!hasLocalUserContent) {
                                confirmCloudflareObservation(endpoint, trimmedToken, head, remoteRead)
                                return remote
                            }

                            error("Local and cloud both have data. Choose local, cloud, or merge before syncing.")
                        }
                    }
                }

                if (hasCompletedSync && remote.updatedAt > envelope.updatedAt) {
                    confirmCloudflareObservation(endpoint, trimmedToken, head, remoteRead)
                    return remote
                }
            }
        }

        cloudflare.writeSnapshotEnvelope(
            endpoint = endpoint,
            token = trimmedToken,
            envelope = envelope,
            previousEtag = (remoteRead as? LegacySnapshotRead.Found)?.etag,
            generation = remoteRead.generation,
        )
        return envelope
    }

    suspend fun clearCloudflare(
        workerEndpoint: String,
        token: String,
    ) {
        val endpoint = normalizeWorkerEndpoint(workerEndpoint)
        require(token.isNotBlank()) { "Cloudflare access key is required" }

        cloudflare.clearRemote(endpoint, token.trim())
    }

    suspend fun clearGist(
        gistId: String?,
        gistFile: String,
        token: String,
        passphrase: String? = null,
    ) {
        val resolvedGistId = normalizeGistId(gistId) ?: return
        val resolvedPassphrase = passphrase?.takeIf { it.isNotBlank() }
            ?: gistPassphrases[resolvedGistId]
            ?: error("Data encryption password is required. Sync once before clearing this Gist.")
        performGistClear(
            client = client,
            json = json,
            crypto = crypto,
            gistId = resolvedGistId,
            gistFile = gistFile,
            token = token,
            passphrase = resolvedPassphrase,
            cursorStorage = gistCursorStorage,
        )
        gistPassphrases.remove(resolvedGistId)
    }

    private suspend fun syncCloudflareSnapshotVault(
        vault: SyncVault,
        passphrase: String,
        endpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Boolean,
        hasLocalUserContent: Boolean,
        hasUnsyncedLocalChanges: Boolean,
    ): SyncVault {
        val remoteRead = cloudflare.readSnapshotVault(endpoint, token, passphrase)
        val remote = (remoteRead as? LegacySnapshotRead.Found)?.value
        val selected = when {
            remote != null && !hasCompletedSync -> {
                when (firstSyncStrategy) {
                    FirstSyncStrategy.UseRemote ->
                        return acceptObservedRemoteVault(
                            remote,
                            vault.data,
                            endpoint,
                            token,
                            null,
                            remoteRead,
                        )
                    FirstSyncStrategy.UseLocal -> vault
                    FirstSyncStrategy.Merge -> mergeFirstSyncVault(remote, vault)
                    FirstSyncStrategy.Ask -> {
                        if (!hasLocalUserContent) {
                            return acceptObservedRemoteVault(
                                remote,
                                vault.data,
                                endpoint,
                                token,
                                null,
                                remoteRead,
                            )
                        }
                        error("Local and cloud both have data. Choose local, cloud, or merge before syncing.")
                    }
                }
            }
            remote != null && remote.data.updatedAt > vault.data.updatedAt -> {
                if (hasUnsyncedLocalChanges) {
                    mergeCompletedSyncVault(remote, vault)
                } else {
                    return acceptObservedRemoteVault(
                        remote,
                        vault.data,
                        endpoint,
                        token,
                        null,
                        remoteRead,
                    )
                }
            }
            else -> vault
        }

        cloudflare.writeSnapshotVault(
            endpoint = endpoint,
            token = token,
            vault = selected,
            passphrase = passphrase,
            previousEtag = (remoteRead as? LegacySnapshotRead.Found)?.etag,
            generation = remoteRead.generation,
        )

        return selected
    }

    private suspend fun readIncrementalManifest(
        endpoint: String,
        token: String,
        passphrase: String,
        head: IncrementalSyncHead,
    ): IncrementalManifest {
        val envelope = cloudflare.readIncrementalObject(endpoint, token, head.manifestKey)
        val manifest = crypto.decryptObject(
            IncrementalManifest.serializer(),
            envelope,
            passphrase,
            "manifest",
        )
        require(manifest.kind == "zerochat.incrementalManifest" && manifest.version == 1) {
            "Remote incremental manifest is invalid."
        }
        require(manifest.updatedAt == head.updatedAt) {
            "Remote incremental manifest timestamp does not match the head."
        }
        return manifest
    }

    private suspend fun manifestToVault(
        endpoint: String,
        token: String,
        passphrase: String,
        manifest: IncrementalManifest,
    ): SyncVault {
        val refsByConversation = manifest.chunks
            .groupBy { it.conversationId }
            .mapValues { entry -> entry.value.sortedBy { it.index } }
        val refsBySkillChunk = manifest.skillChunks
            .associateBy { skillRefKey(it.skillId, it.chunkId) }
        val refsByAttachment = manifest.attachmentChunks.groupBy {
            attachmentRefKey(it.conversationId, it.messageId, it.attachmentId)
        }
        val consumedAttachmentRefs = mutableSetOf<String>()

        val conversations = manifest.data.conversations.map { conversation ->
            val messages = refsByConversation[conversation.id].orEmpty().flatMap { ref ->
                val envelope = cloudflare.readIncrementalObject(endpoint, token, ref.key)
                val chunk = crypto.decryptObject(
                    ConversationChunk.serializer(),
                    envelope,
                    passphrase,
                    ref.objectType,
                )
                require(chunk.kind == "zerochat.conversationChunk" && chunk.version == 1) {
                    "Remote message chunk is invalid."
                }
                require(
                    chunk.conversationId == ref.conversationId &&
                        chunk.index == ref.index &&
                        chunk.updatedAt == ref.updatedAt &&
                        chunk.fingerprint == ref.fingerprint &&
                        chunkFingerprint(
                            ref.conversationId,
                            ref.index,
                            chunk.messages,
                            chunk.updatedAt,
                            json,
                        ) == ref.fingerprint &&
                        chunk.messages.size == ref.messageCount,
                ) {
                    "Remote message chunk does not match its manifest reference."
                }
                chunk.messages
            }
            conversation.copy(
                messages = messages.map { message ->
                    message.copy(
                        attachments = message.attachments.map { attachment ->
                            val attachmentKey = attachmentRefKey(
                                conversation.id,
                                message.id,
                                attachment.id,
                            )
                            val refs = refsByAttachment[attachmentKey]
                                .orEmpty()
                                .sortedBy { it.index }
                            if (refs.isEmpty()) {
                                attachment
                            } else {
                                require(
                                    attachment.dataUrl == null &&
                                        refs.withIndex().all { (index, ref) ->
                                            ref.index == index &&
                                                ref.chunkCount == refs.size &&
                                                ref.objectType == attachmentChunkObjectType(
                                                    conversation.id,
                                                    message.id,
                                                    attachment.id,
                                                    index,
                                                )
                                        },
                                ) { "Remote message chunk does not match its manifest reference." }
                                val dataUrl = buildString {
                                    for (ref in refs) {
                                    val envelope = cloudflare.readIncrementalObject(endpoint, token, ref.key)
                                    val chunk = crypto.decryptObject(
                                        AttachmentContentChunk.serializer(),
                                        envelope,
                                        passphrase,
                                        ref.objectType,
                                    )
                                    require(
                                        chunk.kind == "zerochat.attachmentChunk" &&
                                            chunk.version == 1 &&
                                            chunk.conversationId == ref.conversationId &&
                                            chunk.messageId == ref.messageId &&
                                            chunk.attachmentId == ref.attachmentId &&
                                            chunk.index == ref.index &&
                                            chunk.chunkCount == ref.chunkCount &&
                                            chunk.updatedAt == ref.updatedAt &&
                                            chunk.fingerprint == ref.fingerprint &&
                                            chunk.content.isNotEmpty() &&
                                            attachmentChunkFingerprint(
                                                ref.conversationId,
                                                ref.messageId,
                                                ref.attachmentId,
                                                ref.index,
                                                chunk.content,
                                                json,
                                            ) == ref.fingerprint,
                                    ) { "Remote message chunk does not match its manifest reference." }
                                        append(chunk.content)
                                    }
                                }
                                val safeDataUrl = requireNotNull(safeGeneratedImageDataUrl(dataUrl)?.first) {
                                    "Remote message chunk does not match its manifest reference."
                                }
                                consumedAttachmentRefs += attachmentKey
                                attachment.copy(dataUrl = safeDataUrl)
                            }
                        },
                    )
                },
            )
        }

        require(consumedAttachmentRefs.size == refsByAttachment.size) {
            "Remote message chunk does not match its manifest reference."
        }

        val skills = manifest.data.skills.map { skill ->
            skill.copy(
                chunks = skill.chunks.map { chunk ->
                    val ref = refsBySkillChunk[skillRefKey(skill.id, chunk.id)]
                    val content = if (ref == null) {
                        chunk.content.trim()
                    } else {
                        val envelope = cloudflare.readIncrementalObject(endpoint, token, ref.key)
                        val remoteChunk = crypto.decryptObject(
                            SkillContentChunk.serializer(),
                            envelope,
                            passphrase,
                            ref.objectType,
                        )
                        require(
                            remoteChunk.kind == "zerochat.skillChunk" &&
                                remoteChunk.version == 1 &&
                                remoteChunk.skillId == ref.skillId &&
                                remoteChunk.chunkId == ref.chunkId &&
                                remoteChunk.updatedAt == ref.updatedAt &&
                                remoteChunk.fingerprint == ref.fingerprint &&
                                skillChunkFingerprint(
                                    ref.skillId,
                                    ref.chunkId,
                                    remoteChunk.content,
                                    json,
                                ) == ref.fingerprint,
                        ) {
                            "Remote Skill chunk does not match its manifest reference."
                        }
                        remoteChunk.content.trim()
                    }
                    require(content.isNotEmpty()) { "Remote Skill content is missing." }
                    chunk.copy(content = content, contentRef = null)
                },
            )
        }

        return SyncVault(
            data = manifest.data.copy(
                conversations = conversations,
                skills = skills,
            ),
            secrets = manifest.secrets,
        )
    }

    private suspend fun uploadIncrementalVault(
        vault: SyncVault,
        passphrase: String,
        endpoint: String,
        token: String,
        previous: IncrementalRemoteState?,
        generation: String,
    ): SyncVault {
        val upload = buildIncrementalUpload(vault, passphrase, previous?.manifest, crypto, json)
        publishIncrementalUpload(
            cloudflare = cloudflare,
            endpoint = endpoint,
            token = token,
            upload = upload,
            previousManifestKey = previous?.head?.manifestKey,
            generation = generation,
        )

        cleanupIncrementalObjects(endpoint, token, previous, upload.manifest, generation)
        withTimeoutOrNull(CLEANUP_REQUEST_TIMEOUT_MS) {
            runCatchingPreservingCancellation { cloudflare.deleteLegacySnapshot(endpoint, token, generation) }
        }
        return vault
    }

    private suspend fun cleanupIncrementalObjects(
        endpoint: String,
        token: String,
        previous: IncrementalRemoteState?,
        next: IncrementalManifest,
        generation: String,
    ) {
        if (previous == null) {
            return
        }

        val keep = (
            next.chunks.map { it.key } +
                next.skillChunks.map { it.key } +
                next.attachmentChunks.map { it.key }
            ).toSet()
        val stale = mutableSetOf(previous.head.manifestKey)

        for (chunk in previous.manifest.chunks) {
            if (chunk.key !in keep) {
                stale += chunk.key
            }
        }

        for (chunk in previous.manifest.skillChunks) {
            if (chunk.key !in keep) {
                stale += chunk.key
            }
        }

        for (chunk in previous.manifest.attachmentChunks) {
            if (chunk.key !in keep) {
                stale += chunk.key
            }
        }

        for (key in stale) {
            withTimeoutOrNull(CLEANUP_REQUEST_TIMEOUT_MS) {
                runCatchingPreservingCancellation {
                    cloudflare.deleteIncrementalObject(endpoint, token, key, generation)
                }
            }
        }
    }

    private suspend fun acceptObservedRemoteVault(
        remote: SyncVault,
        localData: app.zerochat.data.AppSnapshot,
        endpoint: String,
        token: String,
        head: IncrementalHeadRead?,
        snapshot: LegacySnapshotRead<*>?,
    ): SyncVault {
        val accepted = acceptRemoteVault(remote, localData)
        confirmCloudflareObservation(endpoint, token, head, snapshot)
        return accepted
    }

    private suspend fun confirmCloudflareObservation(
        endpoint: String,
        token: String,
        expectedHead: IncrementalHeadRead?,
        expectedSnapshot: LegacySnapshotRead<*>?,
    ) {
        if (expectedSnapshot != null) {
            val currentSnapshot = cloudflare.readSnapshotEnvelope(endpoint, token)
            val unchanged = when {
                expectedSnapshot is LegacySnapshotRead.Missing &&
                    currentSnapshot is LegacySnapshotRead.Missing ->
                    expectedSnapshot.generation == currentSnapshot.generation
                expectedSnapshot is LegacySnapshotRead.Found &&
                    currentSnapshot is LegacySnapshotRead.Found ->
                    expectedSnapshot.generation == currentSnapshot.generation &&
                        expectedSnapshot.etag == currentSnapshot.etag
                else -> false
            }
            if (!unchanged) {
                throw CloudflareSnapshotConflictException()
            }
        }

        if (expectedHead != null && expectedHead !is IncrementalHeadRead.Unsupported) {
            val currentHead = cloudflare.readIncrementalHead(endpoint, token)
            if (currentHead != expectedHead) {
                throw CloudflareHeadConflictException()
            }
        }
    }

    private companion object {
        val gistPassphrases = java.util.concurrent.ConcurrentHashMap<String, String>()
    }

    override fun close() {
        client.close()
    }

}

private fun requireSameSyncGeneration(expected: String, observed: String) {
    if (expected != observed) {
        throw CloudflareGenerationConflictException()
    }
}
