package app.zerochat.sync

import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.SyncVault
import io.ktor.client.HttpClient
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.net.URI

internal data class RemoteGistState(
    val heads: List<String>,
    val legacy: Boolean,
    val managedFiles: List<String>,
    val operations: Map<String, GistOperation>,
    val tombstones: List<GistTombstone>,
    val vaultJson: kotlinx.serialization.json.JsonObject?,
    val vault: SyncVault?,
)

internal data class ReconciledGistVault(
    val remoteAccepted: Boolean,
    val shouldWrite: Boolean,
    val tombstones: List<GistTombstone>,
    val vaultJson: kotlinx.serialization.json.JsonObject,
)

internal suspend fun performGistVaultSync(
    client: HttpClient,
    json: Json,
    crypto: CryptoEngine,
    vault: SyncVault,
    passphrase: String,
    gistId: String?,
    gistFile: String,
    token: String,
    firstSyncStrategy: FirstSyncStrategy,
    hasCompletedSync: Boolean,
    hasLocalUserContent: Boolean,
    cursorStorage: GistCursorStorage = ProcessGistCursorStorage,
): SyncVault {
    val trimmedToken = token.trim()
    val fileName = normalizeGistFile(gistFile)
    val resolvedGistId = normalizeGistId(gistId)
    require(trimmedToken.isNotBlank()) { "GitHub token is required." }
    require(passphrase.isNotBlank()) { "Data encryption password is required." }

    val localOperation = createGistStateOperation(json, emptyList(), vault, emptyList())
    val localVaultJson = localOperation.vaultJson
    if (resolvedGistId == null) {
        val created = createGist(
            client = client,
            json = json,
            crypto = crypto,
            fileName = fileName,
            vaultJson = localVaultJson,
            passphrase = passphrase,
            token = trimmedToken,
        )
        val result = created.operation.vault.withGistSyncConfig(
            gistId = created.gistId,
            gistFile = fileName,
            status = "Sync complete",
        )
        storeGistCursor(
            created.gistId,
            fileName,
            listOf(created.operation.id),
            result.data.sync.lastSyncAt,
            created.operation.vaultJson,
            cursorStorage,
        )
        return result
    }

    val response = readGistResponse(client, json, resolvedGistId, trimmedToken)
        ?: error("GitHub Gist was not found.")
    val remote = decodeRemoteGist(
        client = client,
        json = json,
        crypto = crypto,
        response = response,
        fileName = fileName,
        token = trimmedToken,
        passphrase = passphrase,
    )
    val reconciled = reconcileGistVault(
        json = json,
        localVaultJson = localVaultJson,
        remote = remote,
        gistId = resolvedGistId,
        fileName = fileName,
        firstSyncStrategy = firstSyncStrategy,
        hasCompletedSync = hasCompletedSync,
        hasLocalUserContent = hasLocalUserContent,
        localSyncAt = vault.data.sync.lastSyncAt,
        cursorStorage = cursorStorage,
    )
    val migrateLegacy = remote.legacy
    val shouldWrite = reconciled.shouldWrite || migrateLegacy
    var heads = remote.heads
    if (shouldWrite) {
        val operation = publishGistStateOperation(
            client = client,
            json = json,
            crypto = crypto,
            gistId = resolvedGistId,
            token = trimmedToken,
            fileName = fileName,
            passphrase = passphrase,
            parents = remote.heads,
            vaultJson = reconciled.vaultJson,
            tombstones = reconciled.tombstones,
            deleteFiles = observedStateCompactionDeleteFiles(remote, fileName),
        )
        heads = listOf(operation.id)
    }

    val status = when {
        reconciled.remoteAccepted && shouldWrite -> "Merged local and cloud changes"
        reconciled.remoteAccepted -> "Remote data restored"
        else -> "Sync complete"
    }
    val resultOperation = createGistStateOperation(
        json,
        heads,
        reconciled.vaultJson,
        reconciled.tombstones,
    )
    val result = resultOperation.vault.withGistSyncConfig(
        gistId = resolvedGistId,
        gistFile = fileName,
        status = status,
    )
    storeGistCursor(
        resolvedGistId,
        fileName,
        heads,
        result.data.sync.lastSyncAt,
        reconciled.vaultJson,
        cursorStorage,
    )
    return result
}

internal suspend fun performGistClear(
    client: HttpClient,
    json: Json,
    crypto: CryptoEngine,
    gistId: String?,
    gistFile: String,
    token: String,
    passphrase: String,
    updatedAt: Long = System.currentTimeMillis(),
    cursorStorage: GistCursorStorage = ProcessGistCursorStorage,
) {
    val resolvedGistId = normalizeGistId(gistId)
    val trimmedToken = token.trim()
    val fileName = normalizeGistFile(gistFile)
    require(trimmedToken.isNotBlank()) { "GitHub token is required." }
    require(passphrase.isNotBlank()) { "Data encryption password is required." }
    if (resolvedGistId == null) {
        return
    }

    val response = readGistResponse(
        client = client,
        json = json,
        gistId = resolvedGistId,
        token = trimmedToken,
        allowMissing = true,
    )
    if (response == null) {
        clearGistCursor(resolvedGistId, fileName, cursorStorage)
        return
    }

    val remote = try {
        decodeRemoteGist(client, json, crypto, response, fileName, trimmedToken, passphrase)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Throwable) {
        RemoteGistState(
            heads = emptyList(),
            legacy = false,
            managedFiles = response.files.keys.filter { candidate -> isManagedGistFile(fileName, candidate) },
            operations = emptyMap(),
            tombstones = emptyList(),
            vaultJson = null,
            vault = null,
        )
    }
    val clearOperation = createGistClearOperation(remote.heads)
    val clearFile = gistOperationFileName(fileName, clearOperation.id)
    val changes = linkedMapOf<String, GistFileWrite?>()
    changes[clearFile] = GistFileWrite(
        content = serializeGistOperation(
            json = json,
            crypto = crypto,
            operation = clearOperation,
            passphrase = passphrase,
            updatedAt = updatedAt.coerceAtLeast(1),
        ),
    )
    for (candidate in remote.managedFiles) {
        if (candidate != clearFile) {
            changes[candidate] = null
        }
    }
    patchGistFiles(client, resolvedGistId, trimmedToken, changes)
    clearGistCursor(resolvedGistId, fileName, cursorStorage)
}

internal fun reconcileGistVault(
    json: Json,
    localVaultJson: kotlinx.serialization.json.JsonObject,
    remote: RemoteGistState,
    gistId: String,
    fileName: String,
    firstSyncStrategy: FirstSyncStrategy,
    hasCompletedSync: Boolean,
    hasLocalUserContent: Boolean,
    localSyncAt: Long? = null,
    cursorStorage: GistCursorStorage = ProcessGistCursorStorage,
): ReconciledGistVault {
    val remoteVaultJson = remote.vaultJson ?: return ReconciledGistVault(
        remoteAccepted = false,
        shouldWrite = true,
        tombstones = emptyList(),
        vaultJson = localVaultJson,
    )
    val cursor = loadGistCursor(gistId, fileName, localSyncAt, cursorStorage)
    if (cursor != null) {
        val localTombstones = tombstonesFromCursor(cursor, localVaultJson)
        val localOperation = createGistStateOperation(json, cursor.heads, localVaultJson, localTombstones)
        val combined = remote.operations.toMutableMap()
        combined[localOperation.id] = localOperation
        val materialized = materializeGistOperations(json, combined)
        val mergedVaultJson = materialized.vaultJson ?: localVaultJson
        return ReconciledGistVault(
            remoteAccepted = !gistVaultsEqual(mergedVaultJson, localVaultJson),
            shouldWrite = !gistVaultsEqual(mergedVaultJson, remoteVaultJson),
            tombstones = materialized.tombstones,
            vaultJson = mergedVaultJson,
        )
    }
    if (hasCompletedSync) {
        val merged = mergeGistVaults(null, remoteVaultJson, localVaultJson)
        return ReconciledGistVault(
            remoteAccepted = !gistVaultsEqual(merged, localVaultJson),
            shouldWrite = !gistVaultsEqual(merged, remoteVaultJson),
            tombstones = emptyList(),
            vaultJson = merged,
        )
    }

    return when (firstSyncStrategy) {
        FirstSyncStrategy.Merge -> {
            if (!hasLocalUserContent) {
                ReconciledGistVault(true, false, remote.tombstones, remoteVaultJson)
            } else {
                val merged = mergeFirstSyncGistVault(remoteVaultJson, localVaultJson)
                ReconciledGistVault(true, true, emptyList(), merged)
            }
        }
        FirstSyncStrategy.UseRemote -> ReconciledGistVault(true, false, remote.tombstones, remoteVaultJson)
        FirstSyncStrategy.UseLocal -> ReconciledGistVault(
            remoteAccepted = false,
            shouldWrite = true,
            tombstones = tombstonesBetweenGistVaults(remoteVaultJson, localVaultJson),
            vaultJson = localVaultJson,
        )
        FirstSyncStrategy.Ask -> {
            if (hasLocalUserContent) {
                error("Local and cloud both have data. Choose local, cloud, or merge before syncing.")
            }
            ReconciledGistVault(true, false, remote.tombstones, remoteVaultJson)
        }
    }
}

internal fun observedStateCompactionDeleteFiles(remote: RemoteGistState, fileName: String): List<String> =
    remote.managedFiles.filter { candidate ->
        gistOperationIdFromFileName(fileName, candidate) != null || (remote.legacy && candidate == fileName)
    }.distinct()

private suspend fun decodeRemoteGist(
    client: HttpClient,
    json: Json,
    crypto: CryptoEngine,
    response: GithubGistResponse,
    fileName: String,
    token: String,
    passphrase: String,
): RemoteGistState {
    val managedFiles = response.files.keys.filter { candidate ->
        isManagedGistFile(fileName, candidate)
    }
    val operations = linkedMapOf<String, GistOperation>()
    for (candidate in managedFiles.sorted()) {
        if (candidate == fileName) continue
        val expectedId = gistOperationIdFromFileName(fileName, candidate)
            ?: error("Remote Gist operation filename is invalid.")
        val content = readGistFileContent(client, response.files[candidate], token)
            ?: error("Remote Gist operation content is missing.")
        operations[expectedId] = parseGistOperation(json, crypto, content, passphrase, expectedId)
    }
    if (operations.isNotEmpty()) {
        val materialized = materializeGistOperations(json, operations)
        return RemoteGistState(
            heads = materialized.heads,
            legacy = false,
            managedFiles = managedFiles,
            operations = operations,
            tombstones = materialized.tombstones,
            vaultJson = materialized.vaultJson,
            vault = materialized.vault,
        )
    }

    val legacyContent = readGistFileContent(client, response.files[fileName], token)
        ?.takeIf { it.isNotBlank() }
        ?: return RemoteGistState(
            heads = emptyList(),
            legacy = false,
            managedFiles = managedFiles,
            operations = emptyMap(),
            tombstones = emptyList(),
            vaultJson = null,
            vault = null,
        )
    assertSyncTextSize(legacyContent, MAX_SYNC_SNAPSHOT_BYTES, "Encrypted sync snapshot")
    val envelope = json.decodeFromString(EncryptedSnapshotEnvelope.serializer(), legacyContent)
    val legacyVault = crypto.decryptVault(envelope, passphrase)
    val legacyOperation = createGistStateOperation(json, emptyList(), legacyVault, emptyList())
    return RemoteGistState(
        heads = listOf(legacyOperation.id),
        legacy = true,
        managedFiles = managedFiles,
        operations = mapOf(legacyOperation.id to legacyOperation),
        tombstones = emptyList(),
        vaultJson = legacyOperation.vaultJson,
        vault = legacyOperation.vault,
    )
}

private data class CreatedGist(
    val gistId: String,
    val operation: GistStateOperation,
)

private suspend fun createGist(
    client: HttpClient,
    json: Json,
    crypto: CryptoEngine,
    fileName: String,
    vaultJson: kotlinx.serialization.json.JsonObject,
    passphrase: String,
    token: String,
): CreatedGist {
    val operation = createGistStateOperation(json, emptyList(), vaultJson, emptyList())
    val operationFile = gistOperationFileName(fileName, operation.id)
    val response = client.post(GITHUB_GISTS_API) {
        bearerAuth(token)
        contentType(ContentType.Application.Json)
        setBody(
            GistCreateRequest(
                description = "ZeroChat encrypted sync vault",
                publicGist = false,
                files = mapOf(
                    operationFile to GistFileWrite(
                        content = serializeGistOperation(
                            json,
                            crypto,
                            operation,
                            passphrase,
                            operation.vault.data.updatedAt,
                        ),
                    ),
                ),
            ),
        )
    }
    if (response.status.value !in 200..299) {
        error(response.readBoundedError("Gist sync request failed with HTTP ${response.status.value}."))
    }
    val gistId = normalizeGistId(
        response.readBoundedJson<GithubGistResponse>(
            json,
            MAX_SYNC_GIST_RESPONSE_BYTES,
            "GitHub Gist create response",
        ).id,
    ) ?: error("GitHub did not return a Gist ID.")
    return CreatedGist(gistId, operation)
}

private suspend fun publishGistStateOperation(
    client: HttpClient,
    json: Json,
    crypto: CryptoEngine,
    gistId: String,
    token: String,
    fileName: String,
    passphrase: String,
    parents: Collection<String>,
    vaultJson: kotlinx.serialization.json.JsonObject,
    tombstones: Collection<GistTombstone>,
    deleteFiles: Collection<String>,
): GistStateOperation {
    val operation = createGistStateOperation(json, parents, vaultJson, tombstones)
    val operationFile = gistOperationFileName(fileName, operation.id)
    val changes = linkedMapOf<String, GistFileWrite?>()
    changes[operationFile] = GistFileWrite(
        content = serializeGistOperation(
            json,
            crypto,
            operation,
            passphrase,
            operation.vault.data.updatedAt,
        ),
    )
    for (candidate in deleteFiles) {
        if (candidate != operationFile && isManagedGistFile(fileName, candidate)) {
            changes[candidate] = null
        }
    }
    patchGistFiles(client, gistId, token, changes)
    return operation
}

private fun serializeGistOperation(
    json: Json,
    crypto: CryptoEngine,
    operation: GistOperation,
    passphrase: String,
    updatedAt: Long,
): String {
    val envelope = crypto.encryptObject(
        JsonElement.serializer(),
        gistOperationJson(operation),
        passphrase,
        GIST_OPERATION_OBJECT_TYPE,
        updatedAt.coerceAtLeast(1),
    )
    val serialized = json.encodeToString(EncryptedObjectEnvelope.serializer(), envelope)
    assertSyncTextSize(serialized, MAX_SYNC_INCREMENTAL_OBJECT_BYTES, "Encrypted Gist sync operation")
    return serialized
}

private fun parseGistOperation(
    json: Json,
    crypto: CryptoEngine,
    content: String,
    passphrase: String,
    expectedId: String,
): GistOperation {
    assertSyncTextSize(content, MAX_SYNC_INCREMENTAL_OBJECT_BYTES, "Encrypted Gist sync operation")
    val envelope = json.decodeFromString(EncryptedObjectEnvelope.serializer(), content)
    val operation = crypto.decryptObject(
        JsonElement.serializer(),
        envelope,
        passphrase,
        GIST_OPERATION_OBJECT_TYPE,
    )
    return parseGistOperationJson(json, operation, expectedId)
}

private suspend fun readGistResponse(
    client: HttpClient,
    json: Json,
    gistId: String,
    token: String,
    allowMissing: Boolean = false,
): GithubGistResponse? {
    val response = client.get("$GITHUB_GISTS_API/${encodeGistId(gistId)}") {
        bearerAuth(token)
    }
    if (allowMissing && response.status == HttpStatusCode.NotFound) {
        response.drainBoundedBody()
        return null
    }
    if (response.status.value !in 200..299) {
        error(response.readBoundedError("Gist sync request failed with HTTP ${response.status.value}."))
    }
    return response.readBoundedJson(
        json,
        MAX_SYNC_GIST_RESPONSE_BYTES,
        "GitHub Gist sync response",
    )
}

private suspend fun readGistFileContent(
    client: HttpClient,
    file: GithubGistFile?,
    token: String,
): String? {
    file ?: return null
    if (!file.truncated && file.content != null) {
        return file.content
    }
    val rawUrl = file.rawUrl ?: error("Remote Gist file content is missing.")
    val response = client.get(validatedGithubGistRawUrl(rawUrl)) { bearerAuth(token) }
    if (response.status.value !in 200..299) {
        error(response.readBoundedError("Gist file request failed with HTTP ${response.status.value}."))
    }
    return response.readBoundedText(MAX_SYNC_INCREMENTAL_OBJECT_BYTES, "GitHub Gist sync file")
}

private fun validatedGithubGistRawUrl(rawUrl: String): String {
    val endpoint = runCatching { URI(rawUrl) }.getOrNull()
    require(
        endpoint != null &&
            endpoint.scheme.equals("https", ignoreCase = true) &&
            endpoint.host.equals(GITHUB_GIST_RAW_HOST, ignoreCase = true) &&
            endpoint.userInfo == null &&
            endpoint.port == -1 &&
            !endpoint.path.isNullOrBlank() && endpoint.path != "/",
    ) { "Remote Gist file URL is invalid." }
    return endpoint.toString()
}

private suspend fun patchGistFiles(
    client: HttpClient,
    gistId: String,
    token: String,
    files: Map<String, GistFileWrite?>,
) {
    val response = client.patch("$GITHUB_GISTS_API/${encodeGistId(gistId)}") {
        bearerAuth(token)
        contentType(ContentType.Application.Json)
        setBody(GistPatchRequest(files))
    }
    if (response.status.value !in 200..299) {
        error(response.readBoundedError("Gist sync request failed with HTTP ${response.status.value}."))
    }
    response.drainBoundedBody()
}

internal fun normalizeGistId(value: String?): String? {
    val normalized = value?.trim()?.takeIf { it.isNotBlank() } ?: return null
    require(GIST_ID_PATTERN.matches(normalized)) { "Gist ID is invalid." }
    return normalized
}

internal fun normalizeGistFile(value: String): String {
    val normalized = value.trim().ifBlank { DEFAULT_GIST_FILE }
    require(normalized.isNotBlank() && !normalized.contains('/') && !normalized.contains('\\')) {
        "Gist file name is invalid."
    }
    return normalized
}

private fun encodeGistId(gistId: String): String = normalizeGistId(gistId)
    ?: error("Gist ID is invalid.")

@Serializable
private data class GithubGistResponse(
    val id: String? = null,
    val files: Map<String, GithubGistFile> = emptyMap(),
)

@Serializable
private data class GithubGistFile(
    val content: String? = null,
    @SerialName("raw_url")
    val rawUrl: String? = null,
    val truncated: Boolean = false,
)

@Serializable
private data class GistCreateRequest(
    val description: String,
    @SerialName("public")
    val publicGist: Boolean,
    val files: Map<String, GistFileWrite>,
)

@Serializable
private data class GistPatchRequest(
    val files: Map<String, GistFileWrite?>,
)

@Serializable
private data class GistFileWrite(
    val content: String,
)

private const val DEFAULT_GIST_FILE = "zerochat-sync.json"
private const val GITHUB_GISTS_API = "https://api.github.com/gists"
private const val GITHUB_GIST_RAW_HOST = "gist.githubusercontent.com"
private val GIST_ID_PATTERN = Regex("^[A-Za-z0-9_-]+$")
