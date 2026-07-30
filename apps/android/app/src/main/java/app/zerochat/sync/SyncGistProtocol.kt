package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SyncVault
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import java.security.MessageDigest

internal const val GIST_OPERATION_KIND = "zerochat.gistOperation"
internal const val GIST_OPERATION_OBJECT_TYPE = "gist-operation-v2"
internal const val GIST_OPERATION_VERSION = 2

internal data class GistTombstone(
    val kind: String,
    val id: String,
    val fingerprint: String,
    val parentId: String? = null,
)

internal sealed interface GistOperation {
    val id: String
    val parents: List<String>
    val tombstones: List<GistTombstone>
}

internal data class GistStateOperation(
    override val id: String,
    override val parents: List<String>,
    override val tombstones: List<GistTombstone>,
    val vaultJson: JsonObject,
    val vault: SyncVault,
) : GistOperation

internal data class GistClearOperation(
    override val id: String,
    override val parents: List<String>,
    override val tombstones: List<GistTombstone> = emptyList(),
) : GistOperation

internal data class MaterializedGistOperations(
    val heads: List<String>,
    val tombstones: List<GistTombstone>,
    val vaultJson: JsonObject?,
    val vault: SyncVault?,
)

@Serializable
internal data class GistBaselineConversation(
    val fingerprint: String,
    val messages: Map<String, String>,
)

@Serializable
internal data class GistBaseline(
    val providers: Map<String, String>,
    val conversations: Map<String, GistBaselineConversation>,
    val skills: Map<String, String>,
    val providerSecrets: Map<String, String>,
)

@Serializable
internal data class GistCursor(
    val heads: List<String>,
    val baseline: GistBaseline,
    val localSyncAt: Long = 0,
    val version: Int = GIST_CURSOR_VERSION,
)

internal fun gistOperationFilePrefix(fileName: String): String =
    "$fileName.zerochat-op-"

internal fun gistOperationFileName(fileName: String, id: String): String =
    "${gistOperationFilePrefix(fileName)}${requireOperationId(id)}.json"

internal fun gistOperationIdFromFileName(fileName: String, candidate: String): String? {
    val prefix = gistOperationFilePrefix(fileName)
    if (!candidate.startsWith(prefix) || !candidate.endsWith(".json")) {
        return null
    }

    return candidate
        .removePrefix(prefix)
        .removeSuffix(".json")
        .takeIf { GIST_OPERATION_ID_PATTERN.matches(it) }
}

internal fun isManagedGistFile(fileName: String, candidate: String): Boolean =
    candidate == fileName || gistOperationIdFromFileName(fileName, candidate) != null

internal fun canonicalGistJson(value: JsonElement): String =
    PROTOCOL_JSON.encodeToString(JsonElement.serializer(), stableJsonValue(value))

internal fun gistFingerprint(value: JsonElement): String = sha256(canonicalGistJson(value))

internal fun createGistStateOperation(
    json: Json,
    parents: Collection<String>,
    vault: SyncVault,
    tombstones: Collection<GistTombstone>,
): GistStateOperation {
    val vaultJson = normalizeGistVaultJson(vaultJsonFromModel(json, vault))
    return createGistStateOperation(json, parents, vaultJson, tombstones)
}

internal fun createGistStateOperation(
    json: Json,
    parents: Collection<String>,
    vaultJson: JsonObject,
    tombstones: Collection<GistTombstone>,
): GistStateOperation {
    val normalizedParents = normalizeParents(parents)
    val normalizedTombstones = normalizeTombstones(tombstones)
    val normalizedVault = normalizeGistVaultJson(vaultJson)
    val core = stateOperationCore(normalizedParents, normalizedTombstones, normalizedVault)
    val id = sha256(canonicalGistJson(core))

    return GistStateOperation(
        id = id,
        parents = normalizedParents,
        tombstones = normalizedTombstones,
        vaultJson = normalizedVault,
        vault = decodeGistVault(json, normalizedVault),
    )
}

internal fun createGistClearOperation(parents: Collection<String>): GistClearOperation {
    val normalizedParents = normalizeParents(parents)
    val core = clearOperationCore(normalizedParents)
    return GistClearOperation(
        id = sha256(canonicalGistJson(core)),
        parents = normalizedParents,
    )
}

internal fun gistOperationJson(operation: GistOperation): JsonObject = when (operation) {
    is GistClearOperation -> clearOperationCore(operation.parents).withProperty("id", JsonPrimitive(operation.id))
    is GistStateOperation -> stateOperationCore(
        operation.parents,
        operation.tombstones,
        operation.vaultJson,
    ).withProperty("id", JsonPrimitive(operation.id))
}

internal fun parseGistOperationJson(
    json: Json,
    value: JsonElement,
    expectedId: String,
): GistOperation {
    require(GIST_OPERATION_ID_PATTERN.matches(expectedId)) { "Remote Gist operation ID is invalid." }
    val objectValue = value as? JsonObject
        ?: throw IllegalArgumentException("Remote Gist operation has invalid format.")
    val operationType = objectValue.string("operation")
    val expectedKeys = when (operationType) {
        "state" -> GIST_STATE_OPERATION_KEYS
        "clear" -> GIST_CLEAR_OPERATION_KEYS
        else -> emptySet()
    }
    require(expectedKeys.isNotEmpty() && objectValue.keys == expectedKeys) {
        "Remote Gist operation has invalid format."
    }
    require(objectValue.string("kind") == GIST_OPERATION_KIND) {
        "Remote Gist operation has invalid format."
    }
    require(objectValue.int("version") == GIST_OPERATION_VERSION) {
        "Remote Gist operation has invalid format."
    }
    val embeddedId = objectValue.string("id")
    require(embeddedId != null && GIST_OPERATION_ID_PATTERN.matches(embeddedId)) {
        "Remote Gist operation has invalid format."
    }
    val parents = parseParents(objectValue["parents"])
    val tombstones = parseTombstones(objectValue["tombstones"])
    val operation = when (operationType) {
        "clear" -> {
            require(tombstones.isEmpty() && "vault" !in objectValue) {
                "Remote Gist operation has invalid format."
            }
            createGistClearOperation(parents)
        }
        "state" -> {
            val rawVault = objectValue["vault"] as? JsonObject
                ?: throw IllegalArgumentException("Remote Gist operation has invalid format.")
            createGistStateOperation(json, parents, normalizeGistVaultJson(rawVault), tombstones)
        }
        else -> throw IllegalArgumentException("Remote Gist operation has invalid format.")
    }

    require(embeddedId == operation.id && expectedId == operation.id) {
        "Remote Gist operation ID does not match its content or filename."
    }
    return operation
}

internal fun materializeGistOperations(
    json: Json,
    operations: Map<String, GistOperation>,
): MaterializedGistOperations {
    if (operations.isEmpty()) {
        return MaterializedGistOperations(emptyList(), emptyList(), null, null)
    }

    val ancestorMemo = mutableMapOf<String, Set<String>>()
    val heads = activeOperationIds(operations.keys, operations, ancestorMemo)
    val materializedMemo = mutableMapOf<String, JsonObject?>()
    val materializedMemoKeys = mutableSetOf<String>()
    val groupMemo = mutableMapOf<String, JsonObject?>()
    val groupMemoKeys = mutableSetOf<String>()

    fun materializeGroup(ids: Collection<String>): JsonObject? {
        val active = activeOperationIds(ids, operations, ancestorMemo)
        val key = active.joinToString(",")
        if (key in groupMemoKeys) {
            return groupMemo[key]
        }
        if (active.isEmpty()) {
            groupMemoKeys += key
            groupMemo[key] = null
            return null
        }
        if (active.size == 1) {
            val id = active.first()
            if (id in materializedMemoKeys) {
                return materializedMemo[id]
            }
            val value = (operations.getValue(id) as? GistStateOperation)?.vaultJson
            materializedMemoKeys += id
            materializedMemo[id] = value
            groupMemoKeys += key
            groupMemo[key] = value
            return value
        }

        var merged: JsonObject? = null
        val mergedIds = mutableListOf<String>()
        for (id in active) {
            val current = (operations.getValue(id) as? GistStateOperation)?.vaultJson ?: continue
            if (merged == null) {
                merged = current
                mergedIds += id
                continue
            }

            val common = commonAncestorIds(mergedIds + id, operations, ancestorMemo)
            val base = if (common.isEmpty()) null else materializeGroup(common)
            merged = mergeGistVaults(base, merged, current)
            mergedIds += id
        }

        groupMemoKeys += key
        groupMemo[key] = merged
        return merged
    }

    val stateHeads = heads.filter { operations[it] is GistStateOperation }
    var vaultJson = materializeGroup(stateHeads)
    val tombstones = normalizeTombstones(
        stateHeads.flatMap { (operations[it] as GistStateOperation).tombstones },
    )
    if (vaultJson != null) {
        vaultJson = removeTombstonedRecords(vaultJson, tombstones)
    }
    val activeTombstones = if (vaultJson == null) {
        emptyList()
    } else {
        tombstones.filter { tombstoneStillActive(vaultJson, it) }
    }

    return MaterializedGistOperations(
        heads = heads,
        tombstones = activeTombstones,
        vaultJson = vaultJson,
        vault = vaultJson?.let { decodeGistVault(json, it) },
    )
}

internal fun gistVaultsEqual(left: JsonObject, right: JsonObject): Boolean =
    canonicalGistJson(normalizeGistVaultJson(left)) == canonicalGistJson(normalizeGistVaultJson(right))

internal fun mergeGistVaults(
    base: JsonObject?,
    left: JsonObject,
    right: JsonObject,
): JsonObject {
    val leftData = left.objectValue("data")
    val rightData = right.objectValue("data")
    val mergedData = mergeConcurrentAppData(
        base = base?.objectValue("data"),
        remote = leftData,
        local = rightData,
        mergedAt = maxOf(leftData.longValue("updatedAt"), rightData.longValue("updatedAt")),
    )
    val secrets = mergeProviderSecrets(
        base = base?.objectValue("secrets"),
        left = left.objectValue("secrets"),
        right = right.objectValue("secrets"),
    )
    return normalizeGistVaultJson(
        buildJsonObject {
            put("data", mergedData)
            put("secrets", secrets)
        },
    )
}

internal fun mergeFirstSyncGistVault(
    remote: JsonObject,
    local: JsonObject,
    now: Long = System.currentTimeMillis(),
): JsonObject {
    val remoteData = remote.objectValue("data")
    val localData = local.objectValue("data")
    val conversations = mergeNewestRecords(
        remoteData.arrayObjects("conversations"),
        localData.arrayObjects("conversations"),
    ).sortedWith(UPDATED_AT_DESCENDING_THEN_UTF16_ID)
    val providers = mergeFirstSyncProviders(
        remoteData.arrayObjects("providers"),
        localData.arrayObjects("providers"),
    )
    val skills = mergeNewestRecords(
        remoteData.arrayObjects("skills"),
        localData.arrayObjects("skills"),
    ).sortedWith(UPDATED_AT_DESCENDING_THEN_UTF16_ID)
    val preferences = mergeFirstSyncPreferences(
        remoteData.objectValue("preferences"),
        localData.objectValue("preferences"),
        conversations,
    )
    val localSync = localData.objectValue("sync").toMutableMap()
    localSync["encryptionEnabled"] = JsonPrimitive(true)
    val data = buildJsonObject {
        put("version", JsonPrimitive(1))
        put("providers", JsonArray(providers))
        put("conversations", JsonArray(conversations))
        put("skills", JsonArray(skills))
        put(
            "skillSettings",
            mergeFirstSyncSkillSettings(
                remoteData.objectValue("skillSettings"),
                localData.objectValue("skillSettings"),
            ),
        )
        put("sync", JsonObject(localSync))
        put("preferences", preferences)
        put(
            "updatedAt",
            JsonPrimitive(maxOf(remoteData.longValue("updatedAt"), localData.longValue("updatedAt"), now)),
        )
    }
    val providerKeys = remote.objectValue("secrets").objectValue("providerKeys").toMutableMap()
    providerKeys.putAll(local.objectValue("secrets").objectValue("providerKeys"))
    return normalizeGistVaultJson(
        buildJsonObject {
            put("data", data)
            put("secrets", buildJsonObject { put("providerKeys", JsonObject(providerKeys)) })
        },
    )
}

internal fun loadGistCursor(
    gistId: String,
    fileName: String,
    localSyncAt: Long?,
    storage: GistCursorStorage = ProcessGistCursorStorage,
): GistCursor? {
    val expectedSyncAt = localSyncAt ?: return null
    val raw = storage.read(gistCursorKey(gistId, fileName)) ?: return null
    val cursor = runCatching { PROTOCOL_JSON.decodeFromString<GistCursor>(raw) }.getOrNull()
        ?: return null

    return cursor.takeIf {
        it.version == GIST_CURSOR_VERSION &&
            it.localSyncAt == expectedSyncAt &&
            isValidGistCursor(it)
    }
}

internal fun storeGistCursor(
    gistId: String,
    fileName: String,
    heads: Collection<String>,
    localSyncAt: Long?,
    vaultJson: JsonObject,
    storage: GistCursorStorage = ProcessGistCursorStorage,
) {
    val syncAt = localSyncAt ?: return
    val cursor = GistCursor(
        heads = normalizeParents(heads),
        baseline = createGistBaseline(vaultJson),
        localSyncAt = syncAt,
    )
    storage.write(gistCursorKey(gistId, fileName), PROTOCOL_JSON.encodeToString(cursor))
}

internal fun clearGistCursor(
    gistId: String,
    fileName: String,
    storage: GistCursorStorage = ProcessGistCursorStorage,
) {
    storage.remove(gistCursorKey(gistId, fileName))
}

internal fun clearAllGistCursorsForTest() {
    ProcessGistCursorStorage.clear()
}

internal fun tombstonesFromCursor(cursor: GistCursor, vaultJson: JsonObject): List<GistTombstone> {
    val data = vaultJson.objectValue("data")
    val providers = data.arrayObjects("providers").mapTo(mutableSetOf()) { it.stringValue("id") }
    val conversations = data.arrayObjects("conversations").mapTo(mutableSetOf()) { it.stringValue("id") }
    val skills = data.arrayObjects("skills").mapTo(mutableSetOf()) { it.stringValue("id") }
    val providerSecrets = vaultJson
        .objectValue("secrets")
        .objectValue("providerKeys")
        .keys
    val tombstones = mutableListOf<GistTombstone>()

    tombstones += missingTombstones("provider", cursor.baseline.providers, providers)
    tombstones += missingTombstones(
        "conversation",
        cursor.baseline.conversations.mapValues { it.value.fingerprint },
        conversations,
    )
    tombstones += missingTombstones("skill", cursor.baseline.skills, skills)
    tombstones += missingTombstones("provider-secret", cursor.baseline.providerSecrets, providerSecrets)

    for (conversation in data.arrayObjects("conversations")) {
        val conversationId = conversation.stringValue("id")
        val baseline = cursor.baseline.conversations[conversationId] ?: continue
        val messageIds = conversation.arrayObjects("messages").mapTo(mutableSetOf()) { it.stringValue("id") }
        for ((id, fingerprint) in baseline.messages) {
            if (id !in messageIds) {
                tombstones += GistTombstone(
                    kind = "message",
                    parentId = conversationId,
                    id = id,
                    fingerprint = fingerprint,
                )
            }
        }
    }

    return normalizeTombstones(tombstones)
}

internal fun tombstonesBetweenGistVaults(
    baseline: JsonObject,
    current: JsonObject,
): List<GistTombstone> = tombstonesFromCursor(
    GistCursor(emptyList(), createGistBaseline(baseline)),
    current,
)

private fun stateOperationCore(
    parents: Collection<String>,
    tombstones: Collection<GistTombstone>,
    vaultJson: JsonObject,
): JsonObject = buildJsonObject {
    put("kind", JsonPrimitive(GIST_OPERATION_KIND))
    put("version", JsonPrimitive(GIST_OPERATION_VERSION))
    put("operation", JsonPrimitive("state"))
    put("parents", JsonArray(normalizeParents(parents).map(::JsonPrimitive)))
    put("tombstones", JsonArray(normalizeTombstones(tombstones).map(::tombstoneJson)))
    put("vault", vaultJson)
}

private fun clearOperationCore(parents: Collection<String>): JsonObject = buildJsonObject {
    put("kind", JsonPrimitive(GIST_OPERATION_KIND))
    put("version", JsonPrimitive(GIST_OPERATION_VERSION))
    put("operation", JsonPrimitive("clear"))
    put("parents", JsonArray(normalizeParents(parents).map(::JsonPrimitive)))
    put("tombstones", buildJsonArray {})
}

private fun tombstoneJson(tombstone: GistTombstone): JsonObject = buildJsonObject {
    put("kind", JsonPrimitive(tombstone.kind))
    tombstone.parentId?.let { put("parentId", JsonPrimitive(it)) }
    put("id", JsonPrimitive(tombstone.id))
    put("fingerprint", JsonPrimitive(tombstone.fingerprint))
}

private fun parseParents(value: JsonElement?): List<String> {
    val parents = (value as? JsonArray)?.map { item ->
        (item as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw IllegalArgumentException("Remote Gist operation has invalid parents.")
    } ?: throw IllegalArgumentException("Remote Gist operation has invalid parents.")
    require(parents.distinct().size == parents.size) { "Remote Gist operation has duplicate parents." }
    return normalizeParents(parents)
}

private fun parseTombstones(value: JsonElement?): List<GistTombstone> {
    val items = value as? JsonArray
        ?: throw IllegalArgumentException("Remote Gist operation has invalid tombstones.")
    return normalizeTombstones(items.map { item ->
        val valueObject = item as? JsonObject
            ?: throw IllegalArgumentException("Remote Gist operation has invalid tombstones.")
        val kind = valueObject.string("kind")
        val expectedKeys = if (kind == "message") GIST_MESSAGE_TOMBSTONE_KEYS else GIST_TOMBSTONE_KEYS
        require(kind in GIST_TOMBSTONE_KINDS && valueObject.keys == expectedKeys) {
            "Remote Gist operation has invalid tombstones."
        }
        val id = valueObject.string("id")
        val fingerprint = valueObject.string("fingerprint")
        val parentId = valueObject.string("parentId")
        require(kind in GIST_TOMBSTONE_KINDS && !id.isNullOrEmpty()) {
            "Remote Gist operation has invalid tombstones."
        }
        require(fingerprint != null && GIST_OPERATION_ID_PATTERN.matches(fingerprint)) {
            "Remote Gist operation has invalid tombstones."
        }
        require(parentId == null || parentId.isNotEmpty()) {
            "Remote Gist operation has invalid tombstones."
        }
        GistTombstone(
            kind = requireNotNull(kind),
            id = requireNotNull(id),
            fingerprint = requireNotNull(fingerprint),
            parentId = parentId,
        )
    })
}

private fun normalizeParents(parents: Collection<String>): List<String> {
    parents.forEach(::requireOperationId)
    return parents.distinct().sortedWith(UTF16_STRING_COMPARATOR)
}

private fun normalizeTombstones(tombstones: Collection<GistTombstone>): List<GistTombstone> =
    tombstones
        .onEach { tombstone ->
            require(tombstone.kind in GIST_TOMBSTONE_KINDS && tombstone.id.isNotEmpty()) {
                "Gist tombstone is invalid."
            }
            requireOperationId(tombstone.fingerprint)
            require(
                if (tombstone.kind == "message") {
                    !tombstone.parentId.isNullOrEmpty()
                } else {
                    tombstone.parentId == null
                },
            ) {
                "Message tombstones require parentId; all other tombstones must omit it."
            }
        }
        .associateBy(::tombstoneKey)
        .toSortedMap(UTF16_STRING_COMPARATOR)
        .values
        .toList()

private fun tombstoneKey(tombstone: GistTombstone): String =
    listOf(tombstone.kind, tombstone.parentId.orEmpty(), tombstone.id, tombstone.fingerprint)
        .joinToString("\u0000")

private fun stableJsonValue(value: JsonElement): JsonElement = when (value) {
    is JsonArray -> JsonArray(value.map(::stableJsonValue))
    is JsonObject -> JsonObject(
        value.entries
            .sortedWith { left, right -> compareUtf16CodeUnits(left.key, right.key) }
            .associateTo(linkedMapOf()) { it.key to stableJsonValue(it.value) },
    )
    else -> value
}

private fun sha256(value: String): String = MessageDigest
    .getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

private fun requireOperationId(value: String): String {
    require(GIST_OPERATION_ID_PATTERN.matches(value)) {
        "Gist operation IDs and fingerprints must be 64 lowercase hexadecimal characters."
    }
    return value
}

private fun vaultJsonFromModel(json: Json, vault: SyncVault): JsonObject =
    json.encodeToJsonElement(SyncVault.serializer(), vault) as JsonObject

private fun stripProviderDefaults(provider: JsonObject): JsonObject = provider.withoutProperties(
    buildSet {
        if (provider.booleanValueOrNull("clientRequestMode") == false) add("clientRequestMode")
        if (provider.booleanValueOrNull("custom") == false) add("custom")
        if (provider.arrayOrNull("models")?.isEmpty() == true) add("models")
        if (provider.arrayOrNull("capabilities")?.isEmpty() == true) add("capabilities")
    },
)

private fun stripConversationDefaults(conversation: JsonObject): JsonObject {
    val messages = conversation["messages"] as? JsonArray ?: return conversation
    return conversation.withProperty(
        "messages",
        JsonArray(messages.map { message ->
            (message as? JsonObject)?.let(::stripMessageDefaults) ?: message
        }),
    )
}

private fun stripMessageDefaults(message: JsonObject): JsonObject = message.withoutProperties(
    buildSet {
        if (message.string("status") == "done") add("status")
        if (message.arrayOrNull("attachments")?.isEmpty() == true) add("attachments")
    },
)

private fun stripSkillDefaults(skill: JsonObject): JsonObject {
    val chunks = skill["chunks"] as? JsonArray ?: return skill
    return skill.withProperty(
        "chunks",
        JsonArray(chunks.map { item ->
            val chunk = item as? JsonObject ?: return@map item
            if (chunk.string("content")?.isEmpty() == true) {
                chunk.withoutProperties(setOf("content"))
            } else {
                chunk
            }
        }),
    )
}

private fun stripPreferenceDefaults(preferences: JsonObject): JsonObject = preferences.withoutProperties(
    buildSet {
        if (preferences.int("chatContextMessageLimit") == 24) add("chatContextMessageLimit")
        if (preferences.arrayOrNull("dismissedDangerWarnings")?.isEmpty() == true) add("dismissedDangerWarnings")
        if (preferences.arrayOrNull("dismissedFeatureHints")?.isEmpty() == true) add("dismissedFeatureHints")
    },
)

private fun normalizeGistVaultJson(vault: JsonObject): JsonObject {
    val dataValue = vault["data"] as? JsonObject ?: return vault
    val data = dataValue.toMutableMap()

    (data["providers"] as? JsonArray)?.let { providers ->
        data["providers"] = JsonArray(providers.map { provider ->
            (provider as? JsonObject)?.let(::stripProviderDefaults) ?: provider
        })
    }
    (data["conversations"] as? JsonArray)?.let { conversations ->
        data["conversations"] = JsonArray(conversations.map { conversation ->
            (conversation as? JsonObject)?.let(::stripConversationDefaults) ?: conversation
        })
    }
    when (val skills = data["skills"]) {
        null -> data["skills"] = JsonArray(emptyList())
        is JsonArray -> data["skills"] = JsonArray(skills.map { skill ->
            (skill as? JsonObject)?.let(::stripSkillDefaults) ?: skill
        })
        else -> Unit
    }
    if ("skillSettings" !in data) {
        data["skillSettings"] = DEFAULT_GIST_SKILL_SETTINGS
    }

    (data["sync"] as? JsonObject)?.let { syncValue ->
        val sync = syncValue.toMutableMap()
        sync.remove("gistId")
        sync.remove("gistFile")
        sync.remove("lastSyncAt")
        sync.remove("lastSyncStatus")
        sync["encryptionEnabled"] = JsonPrimitive(true)
        data["sync"] = JsonObject(sync)
    }
    (data["preferences"] as? JsonObject)?.let { preferences ->
        data["preferences"] = stripPreferenceDefaults(preferences)
    }

    return JsonObject(vault.toMutableMap().apply { put("data", JsonObject(data)) })
}

private fun decodeGistVault(json: Json, vault: JsonObject): SyncVault =
    decodeValidatedSyncVault(json, PROTOCOL_JSON.encodeToString(JsonElement.serializer(), vault))

private fun operationAncestors(
    id: String,
    operations: Map<String, GistOperation>,
    memo: MutableMap<String, Set<String>>,
    visiting: MutableSet<String> = mutableSetOf(),
): Set<String> {
    memo[id]?.let { return it }
    require(visiting.add(id)) { "Remote Gist operation graph contains a cycle." }
    val ancestors = linkedSetOf(id)
    for (parent in operations[id]?.parents.orEmpty()) {
        if (parent in operations) {
            ancestors += operationAncestors(parent, operations, memo, visiting)
        }
    }
    visiting.remove(id)
    memo[id] = ancestors
    return ancestors
}

private fun activeOperationIds(
    ids: Collection<String>,
    operations: Map<String, GistOperation>,
    ancestorMemo: MutableMap<String, Set<String>>,
): List<String> {
    val existing = ids.distinct().filter { it in operations }.sortedWith(UTF16_STRING_COMPARATOR)
    return existing.filter { candidate ->
        existing.none { other ->
            other != candidate && candidate in operationAncestors(other, operations, ancestorMemo)
        }
    }
}

private fun commonAncestorIds(
    ids: Collection<String>,
    operations: Map<String, GistOperation>,
    ancestorMemo: MutableMap<String, Set<String>>,
): List<String> {
    val ancestorSets = ids.map { operationAncestors(it, operations, ancestorMemo) }
    if (ancestorSets.isEmpty()) {
        return emptyList()
    }
    val common = ancestorSets.first().filter { candidate ->
        ancestorSets.drop(1).all { candidate in it }
    }
    return activeOperationIds(common, operations, ancestorMemo)
}

private fun mergeProviderSecrets(
    base: JsonObject?,
    left: JsonObject,
    right: JsonObject,
): JsonObject {
    val baseKeys = base?.objectValue("providerKeys") ?: JsonObject(emptyMap())
    val leftKeys = left.objectValue("providerKeys")
    val rightKeys = right.objectValue("providerKeys")
    val ids = linkedSetOf<String>().apply {
        addAll(baseKeys.keys)
        addAll(leftKeys.keys)
        addAll(rightKeys.keys)
    }
    val merged = linkedMapOf<String, JsonElement>()
    for (id in ids) {
        val baseValue = baseKeys[id]
        val leftValue = leftKeys[id]
        val rightValue = rightKeys[id]
        val value = when {
            rightValue == baseValue -> leftValue
            leftValue == baseValue || leftValue == rightValue -> rightValue
            else -> rightValue
        }
        if (value != null) {
            merged[id] = value
        }
    }
    return buildJsonObject { put("providerKeys", JsonObject(merged)) }
}

private fun mergeConcurrentAppData(
    base: JsonObject?,
    remote: JsonObject,
    local: JsonObject,
    mergedAt: Long,
): JsonObject {
    val preferLocal = local.longValue("updatedAt") >= remote.longValue("updatedAt")
    var providers = mergeRecordList(
        baseItems = base?.arrayObjects("providers").orEmpty(),
        remoteItems = remote.arrayObjects("providers"),
        localItems = local.arrayObjects("providers"),
        remoteBranchUpdatedAt = remote.longValue("updatedAt"),
        localBranchUpdatedAt = local.longValue("updatedAt"),
        itemUpdatedAt = { item, _ -> item.longValue("updatedAt") },
        mergeSameId = ::mergeProvider,
    )
    var conversations = mergeRecordList(
        baseItems = base?.arrayObjects("conversations").orEmpty(),
        remoteItems = remote.arrayObjects("conversations"),
        localItems = local.arrayObjects("conversations"),
        remoteBranchUpdatedAt = remote.longValue("updatedAt"),
        localBranchUpdatedAt = local.longValue("updatedAt"),
        itemUpdatedAt = { item, _ -> item.longValue("updatedAt") },
        mergeSameId = ::mergeConversation,
    )
    val skills = mergeRecordList(
        baseItems = base?.arrayObjects("skills").orEmpty(),
        remoteItems = remote.arrayObjects("skills"),
        localItems = local.arrayObjects("skills"),
        remoteBranchUpdatedAt = remote.longValue("updatedAt"),
        localBranchUpdatedAt = local.longValue("updatedAt"),
        itemUpdatedAt = { item, _ -> item.longValue("updatedAt") },
        mergeSameId = ::mergeSkill,
    )

    if (providers.isEmpty()) {
        providers = (if (preferLocal) local else remote).arrayObjects("providers").take(1)
    }
    if (conversations.isEmpty()) {
        conversations = (if (preferLocal) local else remote).arrayObjects("conversations").take(1)
    }

    val providerById = providers.associateBy { it.stringValue("id") }
    conversations = conversations.map { conversation ->
        if (conversation.stringValue("providerId") in providerById) {
            conversation
        } else {
            providerById.values.firstOrNull()?.let { fallback ->
                conversation
                    .withProperty("providerId", JsonPrimitive(fallback.stringValue("id")))
                    .withProperty("model", JsonPrimitive(fallback.stringValue("model")))
                    .withProperty(
                        "updatedAt",
                        JsonPrimitive(maxOf(conversation.longValue("updatedAt"), mergedAt)),
                    )
            } ?: conversation
        }
    }

    val conversationIds = conversations.mapTo(mutableSetOf()) { it.stringValue("id") }
    val preferences = mergePreferences(
        base?.objectValue("preferences"),
        remote.objectValue("preferences"),
        local.objectValue("preferences"),
        preferLocal,
    ).toMutableMap()
    val activeConversationId = listOfNotNull(
        preferences["activeConversationId"].stringOrNull(),
        local.objectValue("preferences")["activeConversationId"].stringOrNull(),
        remote.objectValue("preferences")["activeConversationId"].stringOrNull(),
        conversations.firstOrNull()?.stringValue("id"),
    ).firstOrNull { it in conversationIds }
    if (activeConversationId == null) {
        preferences.remove("activeConversationId")
    } else {
        preferences["activeConversationId"] = JsonPrimitive(activeConversationId)
    }

    return buildJsonObject {
        put("version", JsonPrimitive(1))
        put("providers", JsonArray(providers))
        put("conversations", JsonArray(conversations))
        put("skills", JsonArray(skills))
        put(
            "skillSettings",
            mergeObjectFields(
                base?.objectValue("skillSettings"),
                remote.objectValue("skillSettings"),
                local.objectValue("skillSettings"),
                preferLocal,
            ),
        )
        put(
            "sync",
            mergeObjectFields(
                base?.objectValue("sync"),
                remote.objectValue("sync"),
                local.objectValue("sync"),
                preferLocal,
            ),
        )
        put("preferences", JsonObject(preferences))
        put(
            "updatedAt",
            JsonPrimitive(maxOf(remote.longValue("updatedAt"), local.longValue("updatedAt"), mergedAt)),
        )
    }
}

private fun mergeProvider(base: JsonObject?, remote: JsonObject, local: JsonObject): JsonObject {
    val preferLocal = local.longValue("updatedAt") >= remote.longValue("updatedAt")
    val merged = mergeObjectFields(base, remote, local, preferLocal).toMutableMap()
    val models = mergeStringSet(
        base?.stringArray("models"),
        remote.stringArray("models"),
        local.stringArray("models"),
        preferLocal,
    )
    val capabilities = mergeStringSet(
        base?.stringArray("capabilities"),
        remote.stringArray("capabilities"),
        local.stringArray("capabilities"),
        preferLocal,
    )
    merged["id"] = JsonPrimitive(local.stringValue("id"))
    if (models.isEmpty()) merged.remove("models") else merged["models"] = JsonArray(models.map(::JsonPrimitive))
    if (capabilities.isEmpty()) {
        merged.remove("capabilities")
    } else {
        merged["capabilities"] = JsonArray(capabilities.map(::JsonPrimitive))
    }
    merged["createdAt"] = JsonPrimitive(minOf(remote.longValue("createdAt"), local.longValue("createdAt")))
    merged["updatedAt"] = JsonPrimitive(maxOf(remote.longValue("updatedAt"), local.longValue("updatedAt")))
    return JsonObject(merged)
}

private fun mergeConversation(base: JsonObject?, remote: JsonObject, local: JsonObject): JsonObject {
    val preferLocal = local.longValue("updatedAt") >= remote.longValue("updatedAt")
    val merged = mergeObjectFields(base, remote, local, preferLocal).toMutableMap()
    val messages = mergeRecordList(
        baseItems = base?.arrayObjects("messages").orEmpty(),
        remoteItems = remote.arrayObjects("messages"),
        localItems = local.arrayObjects("messages"),
        remoteBranchUpdatedAt = remote.longValue("updatedAt"),
        localBranchUpdatedAt = local.longValue("updatedAt"),
        itemUpdatedAt = { _, branchUpdatedAt -> branchUpdatedAt },
        mergeSameId = { baseMessage, remoteMessage, localMessage ->
            mergeMessage(
                baseMessage,
                remoteMessage,
                localMessage,
                remote.longValue("updatedAt"),
                local.longValue("updatedAt"),
            )
        },
    ).sortedWith(CREATED_AT_THEN_UTF16_ID)
    merged["id"] = JsonPrimitive(local.stringValue("id"))
    merged["messages"] = JsonArray(messages)
    merged["createdAt"] = JsonPrimitive(minOf(remote.longValue("createdAt"), local.longValue("createdAt")))
    merged["updatedAt"] = JsonPrimitive(maxOf(remote.longValue("updatedAt"), local.longValue("updatedAt")))
    return JsonObject(merged)
}

private fun mergeMessage(
    base: JsonObject?,
    remote: JsonObject,
    local: JsonObject,
    remoteUpdatedAt: Long,
    localUpdatedAt: Long,
): JsonObject {
    val preferLocal = localUpdatedAt >= remoteUpdatedAt
    val merged = mergeObjectFields(base, remote, local, preferLocal).toMutableMap()
    val attachments = mergeRecordList(
        baseItems = base?.arrayObjects("attachments").orEmpty(),
        remoteItems = remote.arrayObjects("attachments"),
        localItems = local.arrayObjects("attachments"),
        remoteBranchUpdatedAt = remoteUpdatedAt,
        localBranchUpdatedAt = localUpdatedAt,
        itemUpdatedAt = { item, _ -> item.longValue("createdAt") },
        mergeSameId = { baseAttachment, remoteAttachment, localAttachment ->
            mergeObjectFields(baseAttachment, remoteAttachment, localAttachment, preferLocal)
        },
    ).sortedWith(CREATED_AT_THEN_UTF16_ID)
    merged["id"] = JsonPrimitive(local.stringValue("id"))
    merged["createdAt"] = JsonPrimitive(minOf(remote.longValue("createdAt"), local.longValue("createdAt")))
    if (attachments.isEmpty()) merged.remove("attachments") else merged["attachments"] = JsonArray(attachments)
    return JsonObject(merged)
}

private fun mergeSkill(base: JsonObject?, remote: JsonObject, local: JsonObject): JsonObject {
    val preferLocal = local.longValue("updatedAt") >= remote.longValue("updatedAt")
    val merged = mergeObjectFields(base, remote, local, preferLocal).toMutableMap()
    val chunks = mergeRecordList(
        baseItems = base?.arrayObjects("chunks").orEmpty(),
        remoteItems = remote.arrayObjects("chunks"),
        localItems = local.arrayObjects("chunks"),
        remoteBranchUpdatedAt = remote.longValue("updatedAt"),
        localBranchUpdatedAt = local.longValue("updatedAt"),
        itemUpdatedAt = { _, branchUpdatedAt -> branchUpdatedAt },
        mergeSameId = { baseChunk, remoteChunk, localChunk ->
            val chunk = mergeObjectFields(baseChunk, remoteChunk, localChunk, preferLocal).toMutableMap()
            chunk["id"] = JsonPrimitive(localChunk.stringValue("id"))
            chunk["keywords"] = JsonArray(
                mergeStringSet(
                    baseChunk?.stringArray("keywords"),
                    remoteChunk.stringArray("keywords"),
                    localChunk.stringArray("keywords"),
                    preferLocal,
                ).map(::JsonPrimitive),
            )
            JsonObject(chunk)
        },
    )
    merged["id"] = JsonPrimitive(local.stringValue("id"))
    merged["keywords"] = JsonArray(
        mergeStringSet(
            base?.stringArray("keywords"),
            remote.stringArray("keywords"),
            local.stringArray("keywords"),
            preferLocal,
        ).map(::JsonPrimitive),
    )
    merged["chunks"] = JsonArray(chunks)
    merged["createdAt"] = JsonPrimitive(minOf(remote.longValue("createdAt"), local.longValue("createdAt")))
    merged["updatedAt"] = JsonPrimitive(maxOf(remote.longValue("updatedAt"), local.longValue("updatedAt")))
    return JsonObject(merged)
}

private fun mergePreferences(
    base: JsonObject?,
    remote: JsonObject,
    local: JsonObject,
    preferLocal: Boolean,
): JsonObject {
    val merged = mergeObjectFields(base, remote, local, preferLocal).toMutableMap()
    merged["dismissedDangerWarnings"] = JsonArray(
        mergeStringSet(
            base?.stringArray("dismissedDangerWarnings"),
            remote.stringArray("dismissedDangerWarnings"),
            local.stringArray("dismissedDangerWarnings"),
            preferLocal,
        ).map(::JsonPrimitive),
    )
    merged["dismissedFeatureHints"] = JsonArray(
        mergeStringSet(
            base?.stringArray("dismissedFeatureHints"),
            remote.stringArray("dismissedFeatureHints"),
            local.stringArray("dismissedFeatureHints"),
            preferLocal,
        ).map(::JsonPrimitive),
    )
    return JsonObject(merged)
}

private fun mergeObjectFields(
    base: JsonObject?,
    remote: JsonObject,
    local: JsonObject,
    preferLocal: Boolean,
): JsonObject {
    val keys = linkedSetOf<String>().apply {
        addAll(base?.keys.orEmpty())
        addAll(remote.keys)
        addAll(local.keys)
    }
    val merged = linkedMapOf<String, JsonElement>()
    for (key in keys) {
        val value = resolveValue(base?.get(key), remote[key], local[key], preferLocal)
        if (value != null) {
            merged[key] = value
        }
    }
    return JsonObject(merged)
}

private fun resolveValue(
    base: JsonElement?,
    remote: JsonElement?,
    local: JsonElement?,
    preferLocal: Boolean,
): JsonElement? = when {
    local == base -> remote
    remote == base || local == remote -> local
    preferLocal -> local
    else -> remote
}

private fun mergeStringSet(
    base: List<String>?,
    remote: List<String>?,
    local: List<String>?,
    preferLocal: Boolean,
): List<String> {
    val baseSet = base.orEmpty().toSet()
    val remoteSet = remote.orEmpty().toSet()
    val localSet = local.orEmpty().toSet()
    val result = mutableListOf<String>()
    for (value in (local.orEmpty() + remote.orEmpty() + base.orEmpty()).distinct()) {
        val keep = resolveBoolean(
            value in baseSet,
            value in remoteSet,
            value in localSet,
            preferLocal,
        )
        if (keep) result += value
    }
    return result
}

private fun resolveBoolean(base: Boolean, remote: Boolean, local: Boolean, preferLocal: Boolean): Boolean = when {
    local == base -> remote
    remote == base || local == remote -> local
    preferLocal -> local
    else -> remote
}

private fun mergeRecordList(
    baseItems: List<JsonObject>,
    remoteItems: List<JsonObject>,
    localItems: List<JsonObject>,
    remoteBranchUpdatedAt: Long,
    localBranchUpdatedAt: Long,
    itemUpdatedAt: (JsonObject, Long) -> Long,
    mergeSameId: (JsonObject?, JsonObject, JsonObject) -> JsonObject,
): List<JsonObject> {
    val baseById = baseItems.associateBy { it.stringValue("id") }
    val remoteById = remoteItems.associateBy { it.stringValue("id") }
    val localById = localItems.associateBy { it.stringValue("id") }
    val ids = (localItems + remoteItems + baseItems).map { it.stringValue("id") }.distinct()
    val merged = mutableListOf<JsonObject>()
    for (id in ids) {
        val base = baseById[id]
        val remote = remoteById[id]
        val local = localById[id]
        if (base == null) {
            when {
                remote != null && local != null -> merged += mergeSameId(null, remote, local)
                local != null -> merged += local
                remote != null -> merged += remote
            }
            continue
        }
        if (remote == null && local == null) continue
        if (remote == null && local != null) {
            if (local != base && itemUpdatedAt(local, localBranchUpdatedAt) > remoteBranchUpdatedAt) {
                merged += local
            }
            continue
        }
        if (remote != null && local == null) {
            if (remote != base && itemUpdatedAt(remote, remoteBranchUpdatedAt) > localBranchUpdatedAt) {
                merged += remote
            }
            continue
        }
        merged += mergeSameId(base, requireNotNull(remote), requireNotNull(local))
    }
    return merged
}

private fun removeTombstonedRecords(
    vault: JsonObject,
    tombstones: List<GistTombstone>,
): JsonObject {
    val grouped = tombstones.groupBy { tombstone ->
        tombstone.kind to if (tombstone.parentId == null) {
            tombstone.id
        } else {
            "${tombstone.parentId}\u0000${tombstone.id}"
        }
    }
    fun matches(value: JsonElement, kind: String, key: String): Boolean =
        grouped[kind to key].orEmpty().any { it.fingerprint == gistFingerprint(value) }

    val data = vault.objectValue("data").toMutableMap()
    data["providers"] = JsonArray(
        vault.objectValue("data").arrayObjects("providers").filterNot {
            matches(it, "provider", it.stringValue("id"))
        },
    )
    data["conversations"] = JsonArray(
        vault.objectValue("data").arrayObjects("conversations").mapNotNull { conversation ->
            val conversationId = conversation.stringValue("id")
            if (matches(conversation, "conversation", conversationId)) {
                null
            } else {
                conversation.withProperty(
                    "messages",
                    JsonArray(
                        conversation.arrayObjects("messages").filterNot { message ->
                            matches(message, "message", "$conversationId\u0000${message.stringValue("id")}")
                        },
                    ),
                )
            }
        },
    )
    data["skills"] = JsonArray(
        vault.objectValue("data").arrayObjects("skills").filterNot {
            matches(it, "skill", it.stringValue("id"))
        },
    )
    val providerKeys = vault.objectValue("secrets").objectValue("providerKeys").filterNot { (id, value) ->
        matches(value, "provider-secret", id)
    }
    return normalizeGistVaultJson(
        buildJsonObject {
            put("data", JsonObject(data))
            put("secrets", buildJsonObject { put("providerKeys", JsonObject(providerKeys)) })
        },
    )
}

private fun tombstoneStillActive(vault: JsonObject, tombstone: GistTombstone): Boolean {
    val data = vault.objectValue("data")
    return when (tombstone.kind) {
        "provider" -> data.arrayObjects("providers").none { it.stringValue("id") == tombstone.id }
        "conversation" -> data.arrayObjects("conversations").none { it.stringValue("id") == tombstone.id }
        "skill" -> data.arrayObjects("skills").none { it.stringValue("id") == tombstone.id }
        "provider-secret" -> tombstone.id !in vault.objectValue("secrets").objectValue("providerKeys")
        else -> data.arrayObjects("conversations")
            .firstOrNull { it.stringValue("id") == tombstone.parentId }
            ?.arrayObjects("messages")
            ?.none { it.stringValue("id") == tombstone.id }
            ?: true
    }
}

private fun createGistBaseline(vault: JsonObject): GistBaseline {
    val data = vault.objectValue("data")
    return GistBaseline(
        providers = fingerprintsById(data.arrayObjects("providers")),
        conversations = data.arrayObjects("conversations").associate { conversation ->
            conversation.stringValue("id") to GistBaselineConversation(
                fingerprint = gistFingerprint(conversation),
                messages = fingerprintsById(conversation.arrayObjects("messages")),
            )
        },
        skills = fingerprintsById(data.arrayObjects("skills")),
        providerSecrets = vault.objectValue("secrets").objectValue("providerKeys").mapValues {
            gistFingerprint(it.value)
        },
    )
}

private fun fingerprintsById(values: List<JsonObject>): Map<String, String> =
    values.associate { it.stringValue("id") to gistFingerprint(it) }

private fun missingTombstones(
    kind: String,
    baseline: Map<String, String>,
    currentIds: Set<String>,
): List<GistTombstone> = baseline.entries
    .filter { it.key !in currentIds }
    .map { GistTombstone(kind, it.key, it.value) }

private fun mergeNewestRecords(remote: List<JsonObject>, local: List<JsonObject>): List<JsonObject> {
    val merged = linkedMapOf<String, JsonObject>()
    remote.forEach { merged[it.stringValue("id")] = it }
    local.forEach { item ->
        val id = item.stringValue("id")
        val existing = merged[id]
        merged[id] = if (existing == null || item.longValue("updatedAt") >= existing.longValue("updatedAt")) {
            item
        } else {
            existing
        }
    }
    return merged.values.toList()
}

private fun mergeFirstSyncProviders(remote: List<JsonObject>, local: List<JsonObject>): List<JsonObject> {
    val merged = linkedMapOf<String, JsonObject>()
    remote.forEach { merged[it.stringValue("id")] = it }
    local.forEach { item ->
        val id = item.stringValue("id")
        val existing = merged[id]
        merged[id] = if (existing == null) item else mergeFirstSyncProvider(existing, item)
    }
    return merged.values.toList()
}

private fun mergeFirstSyncProvider(remote: JsonObject, local: JsonObject): JsonObject {
    val localIsNewer = local.longValue("updatedAt") >= remote.longValue("updatedAt")
    val base = if (localIsNewer) local else remote
    val other = if (localIsNewer) remote else local
    val result = base.toMutableMap()
    val models = uniqueTrimmedStrings(
        base.stringArray("models") +
            other.stringArray("models") +
            listOfNotNull(
                base.string("model"),
                other.string("model"),
                base.string("imageModel"),
                other.string("imageModel"),
            ),
    )
    val capabilities = uniqueTrimmedStrings(base.stringArray("capabilities") + other.stringArray("capabilities"))
    result["model"] = JsonPrimitive(base.string("model").orEmpty().ifEmpty { other.string("model").orEmpty() })
    result["models"] = JsonArray(models.map(::JsonPrimitive))
    result["capabilities"] = JsonArray(capabilities.map(::JsonPrimitive))
    if (base.booleanValueOrNull("custom") == true || other.booleanValueOrNull("custom") == true) {
        result["custom"] = JsonPrimitive(true)
    } else {
        result.remove("custom")
    }
    result["createdAt"] = JsonPrimitive(minOf(base.longValue("createdAt"), other.longValue("createdAt")))
    result["updatedAt"] = JsonPrimitive(maxOf(base.longValue("updatedAt"), other.longValue("updatedAt")))
    return JsonObject(result)
}

private fun mergeFirstSyncSkillSettings(remote: JsonObject, local: JsonObject): JsonObject = buildJsonObject {
    put(
        "autoMatch",
        local["autoMatch"].takeIf { it != JsonPrimitive(true) } ?: remote.getValue("autoMatch"),
    )
    put(
        "contextBudget",
        local["contextBudget"].takeIf { it != JsonPrimitive(2400) } ?: remote.getValue("contextBudget"),
    )
    put(
        "maxAutoSkills",
        local["maxAutoSkills"].takeIf { it != JsonPrimitive(3) } ?: remote.getValue("maxAutoSkills"),
    )
}

private fun mergeFirstSyncPreferences(
    remote: JsonObject,
    local: JsonObject,
    conversations: List<JsonObject>,
): JsonObject {
    val conversationIds = conversations.mapTo(mutableSetOf()) { it.stringValue("id") }
    val active = local.string("activeConversationId")?.takeIf { it in conversationIds }
        ?: remote.string("activeConversationId")?.takeIf { it in conversationIds }
    return buildJsonObject {
        put("firstRunDone", JsonPrimitive(local.booleanValue("firstRunDone") || remote.booleanValue("firstRunDone")))
        put("theme", JsonPrimitive(local.stringValue("theme").takeIf { it != "system" } ?: remote.stringValue("theme")))
        put(
            "language",
            JsonPrimitive(local.stringValue("language").takeIf { it != "system" } ?: remote.stringValue("language")),
        )
        put("compactMode", JsonPrimitive(local.booleanValue("compactMode") || remote.booleanValue("compactMode")))
        put(
            "chatContextMessageLimit",
            JsonPrimitive((local.int("chatContextMessageLimit") ?: remote.int("chatContextMessageLimit") ?: 24).coerceIn(4, 200)),
        )
        active?.let { put("activeConversationId", JsonPrimitive(it)) }
        put(
            "dismissedDangerWarnings",
            JsonArray(uniqueTrimmedStrings(remote.stringArray("dismissedDangerWarnings") + local.stringArray("dismissedDangerWarnings")).map(::JsonPrimitive)),
        )
        put(
            "dismissedFeatureHints",
            JsonArray(uniqueTrimmedStrings(remote.stringArray("dismissedFeatureHints") + local.stringArray("dismissedFeatureHints")).map(::JsonPrimitive)),
        )
    }
}

private fun uniqueTrimmedStrings(values: List<String>): List<String> = buildList {
    val seen = mutableSetOf<String>()
    for (value in values) {
        val trimmed = value.trim()
        if (trimmed.isNotEmpty() && seen.add(trimmed)) add(trimmed)
    }
}

private fun isValidGistCursor(cursor: GistCursor): Boolean {
    fun validFingerprints(values: Map<String, String>): Boolean =
        values.all { (id, fingerprint) ->
            id.isNotBlank() && GIST_OPERATION_ID_PATTERN.matches(fingerprint)
        }

    return cursor.localSyncAt > 0 &&
        cursor.heads.all(GIST_OPERATION_ID_PATTERN::matches) &&
        cursor.heads == normalizeParents(cursor.heads) &&
        validFingerprints(cursor.baseline.providers) &&
        validFingerprints(cursor.baseline.skills) &&
        validFingerprints(cursor.baseline.providerSecrets) &&
        cursor.baseline.conversations.all { (id, conversation) ->
            id.isNotBlank() &&
                GIST_OPERATION_ID_PATTERN.matches(conversation.fingerprint) &&
                validFingerprints(conversation.messages)
        }
}

private fun gistCursorKey(gistId: String, fileName: String): String =
    "zerochat:gist-sync-cursor:v2:${sha256("$gistId\u0000$fileName")}"

private fun JsonObject.withProperty(key: String, value: JsonElement): JsonObject =
    JsonObject(toMutableMap().apply { put(key, value) })

private fun JsonObject.withoutProperties(keys: Set<String>): JsonObject =
    JsonObject(filterKeys { it !in keys })

private fun JsonObject.string(key: String): String? = this[key].stringOrNull()

private fun JsonElement?.stringOrNull(): String? =
    (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.stringValue(key: String): String =
    string(key) ?: error("Gist sync JSON field '$key' is missing.")

private fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)?.content?.toIntOrNull()

private fun JsonObject.longValue(key: String): Long =
    (this[key] as? JsonPrimitive)?.content?.toLongOrNull()
        ?: error("Gist sync JSON field '$key' is invalid.")

private fun JsonObject.booleanValue(key: String): Boolean =
    booleanValueOrNull(key) ?: error("Gist sync JSON field '$key' is invalid.")

private fun JsonObject.booleanValueOrNull(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.content?.toBooleanStrictOrNull()

private fun JsonObject.objectValue(key: String): JsonObject =
    this[key] as? JsonObject ?: error("Gist sync JSON field '$key' is invalid.")

private fun JsonObject.arrayObjects(key: String): List<JsonObject> =
    arrayOrNull(key)?.map { it as? JsonObject ?: error("Gist sync JSON array '$key' is invalid.") }.orEmpty()

private fun JsonObject.arrayOrNull(key: String): JsonArray? = this[key] as? JsonArray

private fun JsonObject.stringArray(key: String): List<String> =
    arrayOrNull(key)?.map { item ->
        (item as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: error("Gist sync JSON array '$key' is invalid.")
    }.orEmpty()

private fun JsonElement.asObject(): JsonObject = this as? JsonObject
    ?: error("Gist sync JSON object is invalid.")

private fun JsonElement?.asArrayOrNull(): JsonArray? = this as? JsonArray

private val PROTOCOL_JSON = Json {
    ignoreUnknownKeys = false
    explicitNulls = false
    encodeDefaults = true
}

private const val GIST_CURSOR_VERSION = 1
private val GIST_STATE_OPERATION_KEYS = setOf(
    "kind",
    "version",
    "operation",
    "parents",
    "tombstones",
    "vault",
    "id",
)
private val GIST_CLEAR_OPERATION_KEYS = setOf(
    "kind",
    "version",
    "operation",
    "parents",
    "tombstones",
    "id",
)
private val GIST_TOMBSTONE_KEYS = setOf("kind", "id", "fingerprint")
private val GIST_MESSAGE_TOMBSTONE_KEYS = setOf("kind", "parentId", "id", "fingerprint")
private val DEFAULT_GIST_SKILL_SETTINGS = buildJsonObject {
    put("autoMatch", JsonPrimitive(true))
    put("contextBudget", JsonPrimitive(2400))
    put("maxAutoSkills", JsonPrimitive(3))
}
private fun compareUtf16CodeUnits(left: String, right: String): Int = left.compareTo(right)
private val UTF16_STRING_COMPARATOR = Comparator<String>(::compareUtf16CodeUnits)
private val CREATED_AT_THEN_UTF16_ID = Comparator<JsonObject> { left, right ->
    left.longValue("createdAt").compareTo(right.longValue("createdAt"))
        .takeIf { it != 0 }
        ?: compareUtf16CodeUnits(left.stringValue("id"), right.stringValue("id"))
}
private val UPDATED_AT_DESCENDING_THEN_UTF16_ID = Comparator<JsonObject> { left, right ->
    right.longValue("updatedAt").compareTo(left.longValue("updatedAt"))
        .takeIf { it != 0 }
        ?: compareUtf16CodeUnits(left.stringValue("id"), right.stringValue("id"))
}
private val GIST_OPERATION_ID_PATTERN = Regex("^[a-f0-9]{64}$")
private val GIST_TOMBSTONE_KINDS = setOf(
    "conversation",
    "message",
    "provider",
    "provider-secret",
    "skill",
)
