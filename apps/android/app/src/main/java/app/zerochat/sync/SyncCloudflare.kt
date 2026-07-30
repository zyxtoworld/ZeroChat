package app.zerochat.sync

import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.IncrementalManifest
import app.zerochat.data.IncrementalSyncHead
import app.zerochat.data.SyncVault
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import java.net.URI

internal class CloudflareSyncTransport(
    private val client: HttpClient,
    private val crypto: CryptoEngine,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    },
) {
    suspend fun readSnapshotEnvelope(
        endpoint: String,
        token: String,
    ): LegacySnapshotRead<EncryptedSnapshotEnvelope> {
        val response = client.get("$endpoint/snapshot") {
            bearerAuth(token)
        }

        if (response.status == HttpStatusCode.NotFound) {
            val generation = response.readSyncGenerationOrFail()
            response.drainBoundedBody()
            return LegacySnapshotRead.Missing(generation)
        }

        if (response.status != HttpStatusCode.OK) {
            error(response.readBoundedError("Cloud sync request failed with HTTP ${response.status.value}."))
        }

        val etag = response.headers.getAll(HttpHeaders.ETag)?.singleOrNull()
            ?.takeIf(::isStrongLegacySnapshotEtag)
        if (etag == null) {
            response.drainBoundedBody()
            error("Remote snapshot has invalid strong ETag.")
        }
        val generation = response.readSyncGenerationOrFail()

        val envelope = response.readBoundedJson<EncryptedSnapshotEnvelope>(
            json,
            MAX_SYNC_SNAPSHOT_BYTES,
            "Cloud sync snapshot response",
        )
        return LegacySnapshotRead.Found(envelope, etag, generation)
    }

    suspend fun writeSnapshotEnvelope(
        endpoint: String,
        token: String,
        envelope: EncryptedSnapshotEnvelope,
        previousEtag: String?,
        generation: String,
    ) {
        require(previousEtag == null || isStrongLegacySnapshotEtag(previousEtag)) {
            "Previous snapshot ETag is invalid."
        }
        requireSyncGeneration(generation)
        val serialized = json.encodeToString(EncryptedSnapshotEnvelope.serializer(), envelope)
        assertSyncTextSize(serialized, MAX_SYNC_SNAPSHOT_BYTES, "Encrypted sync snapshot")
        val response = client.put("$endpoint/snapshot") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            header(SYNC_GENERATION_HEADER, generation)
            if (previousEtag == null) {
                header(HttpHeaders.IfNoneMatch, "*")
            } else {
                header(HttpHeaders.IfMatch, previousEtag)
            }
            setBody(serialized)
        }

        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareSnapshotConflictException()
        }

        if (response.status.value !in 200..299) {
            error(response.readBoundedError("Cloud sync request failed with HTTP ${response.status.value}."))
        }
        response.drainBoundedBody()
    }

    suspend fun readSnapshotVault(
        endpoint: String,
        token: String,
        passphrase: String,
    ): LegacySnapshotRead<SyncVault> = when (val read = readSnapshotEnvelope(endpoint, token)) {
        is LegacySnapshotRead.Missing -> LegacySnapshotRead.Missing(read.generation)
        is LegacySnapshotRead.Found -> {
            if (read.value.kind != "zerochat.encryptedSnapshot") {
                error("Remote data is not a supported ZeroChat encrypted snapshot.")
            }
            LegacySnapshotRead.Found(
                value = crypto.decryptVault(read.value, passphrase),
                etag = read.etag,
                generation = read.generation,
            )
        }
    }

    suspend fun writeSnapshotVault(
        endpoint: String,
        token: String,
        vault: SyncVault,
        passphrase: String,
        previousEtag: String?,
        generation: String,
    ) {
        writeSnapshotEnvelope(
            endpoint = endpoint,
            token = token,
            envelope = crypto.encryptVault(vault, passphrase),
            previousEtag = previousEtag,
            generation = generation,
        )
    }

    suspend fun readIncrementalHead(
        endpoint: String,
        token: String,
    ): IncrementalHeadRead {
        val response = client.get("$endpoint/sync/head") {
            bearerAuth(token)
        }

        if (response.status == HttpStatusCode.NotImplemented) {
            response.drainBoundedBody()
            return IncrementalHeadRead.Unsupported
        }

        if (response.status == HttpStatusCode.NotFound) {
            val generation = response.readSyncGenerationOrFail()
            response.readBoundedText(
                MAX_SYNC_ERROR_BODY_BYTES,
                "Cloud incremental head not-found response",
            )
            return IncrementalHeadRead.Empty(generation)
        }

        if (response.status.value !in 200..299) {
            error(response.readBoundedError("Cloud incremental sync check failed: ${response.status.value}"))
        }
        val generation = response.readSyncGenerationOrFail()

        val head = response.readBoundedJson<IncrementalSyncHead>(
            json,
            MAX_SYNC_INCREMENTAL_HEAD_BYTES,
            "Cloud incremental head response",
        )
        require(head.kind == "zerochat.incrementalHead" && head.version == 1) {
            "Remote incremental sync head is invalid."
        }
        require(isSafeObjectKey(head.manifestKey) && head.manifestKey.startsWith("manifest-")) {
            "Remote incremental manifest key is invalid."
        }
        require(head.updatedAt > 0) {
            "Remote incremental sync timestamp is invalid."
        }
        return IncrementalHeadRead.Head(head, generation)
    }

    suspend fun readIncrementalObject(
        endpoint: String,
        token: String,
        key: String,
    ): EncryptedObjectEnvelope {
        val response = client.get("$endpoint/sync/object/${encodeKey(key)}") {
            bearerAuth(token)
        }

        if (response.status.value !in 200..299) {
            error(response.readBoundedError("Cloud incremental object request failed: ${response.status.value}"))
        }

        val envelope = response.readBoundedJson<EncryptedObjectEnvelope>(
            json,
            MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
            "Cloud incremental object response",
        )
        require(envelope.kind == "zerochat.encryptedObject" && envelope.version == 1) {
            "Remote incremental sync object is invalid."
        }
        return envelope
    }

    suspend fun writeIncrementalObject(
        endpoint: String,
        token: String,
        key: String,
        envelope: EncryptedObjectEnvelope,
        generation: String,
    ) {
        requireSyncGeneration(generation)
        val serialized = json.encodeToString(EncryptedObjectEnvelope.serializer(), envelope)
        assertSyncTextSize(
            serialized,
            MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
            "Encrypted incremental sync object",
        )
        val response = client.put("$endpoint/sync/object/${encodeKey(key)}") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            header(SYNC_GENERATION_HEADER, generation)
            setBody(serialized)
        }

        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareGenerationConflictException()
        }
        if (response.status.value !in 200..299) {
            error(response.readBoundedError("Cloud incremental object write failed: ${response.status.value}"))
        }
        response.drainBoundedBody()
    }

    suspend fun deleteIncrementalObject(
        endpoint: String,
        token: String,
        key: String,
        generation: String,
    ) {
        requireSyncGeneration(generation)
        val response = client.delete("$endpoint/sync/object/${encodeKey(key)}") {
            bearerAuth(token)
            header(SYNC_GENERATION_HEADER, generation)
        }

        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareGenerationConflictException()
        }
        if (response.status.value in 200..299 || response.status == HttpStatusCode.NotFound) {
            response.drainBoundedBody()
            return
        }

        error(response.readBoundedError("Cloud incremental object delete failed: ${response.status.value}"))
    }

    suspend fun writeIncrementalHead(
        endpoint: String,
        token: String,
        head: IncrementalSyncHead,
        previousManifestKey: String?,
        generation: String,
    ) {
        require(
            previousManifestKey == null ||
                (isSafeObjectKey(previousManifestKey) && previousManifestKey.startsWith("manifest-")),
        ) {
            "Previous incremental manifest key is invalid."
        }
        requireSyncGeneration(generation)
        val serialized = json.encodeToString(IncrementalSyncHead.serializer(), head)
        assertSyncTextSize(serialized, MAX_SYNC_INCREMENTAL_HEAD_BYTES, "Incremental sync head")
        val response = client.put("$endpoint/sync/head") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            header(SYNC_GENERATION_HEADER, generation)
            if (previousManifestKey == null) {
                header(HttpHeaders.IfNoneMatch, "*")
            } else {
                header(HttpHeaders.IfMatch, "\"$previousManifestKey\"")
            }
            setBody(serialized)
        }

        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareHeadConflictException()
        }

        if (response.status.value !in 200..299) {
            error(response.readBoundedError("Cloud incremental head write failed: ${response.status.value}"))
        }
        response.drainBoundedBody()
    }

    suspend fun deleteLegacySnapshot(endpoint: String, token: String, generation: String) {
        requireSyncGeneration(generation)
        val response = client.delete("$endpoint/snapshot") {
            bearerAuth(token)
            header(SYNC_GENERATION_HEADER, generation)
        }

        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareSnapshotConflictException()
        }
        if (
            response.status.value in 200..299 ||
            response.status == HttpStatusCode.NotFound ||
            response.status == HttpStatusCode.MethodNotAllowed
        ) {
            response.drainBoundedBody()
            return
        }

        error(response.readBoundedError("Cloud legacy snapshot cleanup failed: ${response.status.value}"))
    }

    suspend fun clearRemote(endpoint: String, token: String) {
        val bulk = client.delete("$endpoint/sync/clear") {
            bearerAuth(token)
        }

        if (bulk.status.value in 200..299) {
            bulk.readSyncGenerationOrFail()
            bulk.drainBoundedBody()
            return
        }

        if (bulk.status.value !in listOf(404, 405, 501)) {
            error(bulk.readBoundedError("Cloud clear failed: ${bulk.status.value}"))
        }
        bulk.drainBoundedBody()

        val head = readIncrementalHead(endpoint, token)
        val generation = when (head) {
            is IncrementalHeadRead.Empty -> head.generation
            is IncrementalHeadRead.Head -> head.generation
            IncrementalHeadRead.Unsupported -> when (val snapshot = readSnapshotEnvelope(endpoint, token)) {
                is LegacySnapshotRead.Missing -> snapshot.generation
                is LegacySnapshotRead.Found -> snapshot.generation
            }
        }
        deleteIncrementalHead(endpoint, token, generation)
        deleteLegacySnapshot(endpoint, token, generation)
    }

    private suspend fun deleteIncrementalHead(endpoint: String, token: String, generation: String) {
        requireSyncGeneration(generation)
        val response = client.delete("$endpoint/sync/head") {
            bearerAuth(token)
            header(SYNC_GENERATION_HEADER, generation)
        }
        if (response.status.isSyncConflict()) {
            response.drainBoundedBody()
            throw CloudflareHeadConflictException()
        }
        if (response.status.value in 200..299 || response.status == HttpStatusCode.NotFound) {
            response.drainBoundedBody()
            return
        }
        error(response.readBoundedError("Cloud clear failed: ${response.status.value}"))
    }
}

internal fun normalizeWorkerEndpoint(value: String): String {
    val endpoint = value.trim().trimEnd('/')
    require(endpoint.isNotBlank()) { "Cloudflare Worker endpoint is required." }

    val uri = URI(endpoint)
    val host = uri.host.orEmpty()
    val isLoopback = host == "localhost" ||
        host == "127.0.0.1" ||
        host == "10.0.2.2" ||
        host == "::1" ||
        host == "[::1]"
    val isSafeScheme = uri.scheme == "https" || (uri.scheme == "http" && isLoopback)

    require(uri.userInfo == null) { "Cloudflare Worker endpoint cannot include username or password." }
    require(uri.query == null && uri.fragment == null) {
        "Cloudflare Worker endpoint cannot include query parameters or # fragments."
    }
    require(isSafeScheme) { "Cloudflare Worker endpoint must use HTTPS unless it is a loopback address." }

    return endpoint
}

internal sealed class IncrementalHeadRead {
    object Unsupported : IncrementalHeadRead()
    data class Empty(val generation: String) : IncrementalHeadRead()
    data class Head(val value: IncrementalSyncHead, val generation: String) : IncrementalHeadRead()
}

internal sealed class LegacySnapshotRead<out T> {
    abstract val generation: String

    data class Missing(override val generation: String) : LegacySnapshotRead<Nothing>()
    data class Found<T>(
        val value: T,
        val etag: String,
        override val generation: String,
    ) : LegacySnapshotRead<T>()
}

internal data class IncrementalRemoteState(
    val head: IncrementalSyncHead,
    val manifest: IncrementalManifest,
)

internal class CloudflareHeadConflictException :
    IllegalStateException("Cloud data changed. Pull again before uploading.")

internal class CloudflareSnapshotConflictException :
    IllegalStateException("Cloud data changed. Pull again before uploading.")

internal class CloudflareGenerationConflictException :
    IllegalStateException("Cloud data changed. Pull again before uploading.")

internal const val CLEANUP_REQUEST_TIMEOUT_MS = 3_000L

private fun encodeKey(key: String): String =
    java.net.URLEncoder.encode(key, Charsets.UTF_8.name()).replace("+", "%20")

private val LEGACY_SNAPSHOT_ETAG = Regex("^\\\"snapshot-sha256-[0-9a-fA-F]{64}\\\"$")
private val SYNC_GENERATION = Regex(
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
)
private const val SYNC_GENERATION_HEADER = "x-zerochat-sync-generation"

private fun isStrongLegacySnapshotEtag(value: String?): Boolean =
    value != null && LEGACY_SNAPSHOT_ETAG.matches(value)

private fun isSyncGeneration(value: String?): Boolean =
    value != null && SYNC_GENERATION.matches(value)

private fun requireSyncGeneration(value: String) {
    require(isSyncGeneration(value)) { "Sync generation is invalid." }
}

private suspend fun HttpResponse.readSyncGenerationOrFail(): String {
    val generation = headers.getAll(SYNC_GENERATION_HEADER)?.singleOrNull()
    if (!isSyncGeneration(generation)) {
        drainBoundedBody()
        error("Remote sync generation is invalid.")
    }
    return generation ?: error("Remote sync generation is invalid.")
}

private fun HttpStatusCode.isSyncConflict(): Boolean =
    this == HttpStatusCode.Conflict || this == HttpStatusCode.PreconditionFailed || value == 428
