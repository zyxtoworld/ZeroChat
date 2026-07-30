package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.ChatMessage
import app.zerochat.data.Conversation
import app.zerochat.data.MessageAttachment
import app.zerochat.data.MessageRole
import app.zerochat.data.Preferences
import app.zerochat.data.ProviderConfig
import app.zerochat.data.ProviderKind
import app.zerochat.data.ProviderSecrets
import app.zerochat.data.SkillSettings
import app.zerochat.data.SyncConfig
import app.zerochat.data.SyncVault
import app.zerochat.data.UserSkill
import app.zerochat.data.UserSkillChunk
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Paths

class SyncGistProtocolTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    @AfterEach
    fun cleanupCursor() {
        clearAllGistCursorsForTest()
    }

    @Test
    fun sharedGoldenVectorsMatchCanonicalIdsAndFileNames() {
        val vectors = readSharedVectors()
        val baseFileName = vectors.stringValue("baseFileName")
        val clearVector = vectors.objectValue("clear")
        val clearParents = clearVector.objectValue("core").arrayValue("parents").map {
            (it as JsonPrimitive).content
        }
        val clear = createGistClearOperation(
            listOf(clearParents[1], clearParents[0], clearParents[1]),
        )
        val clearCore = gistOperationJson(clear).without("id")

        assertEquals(clearVector.stringValue("canonicalJson"), canonicalGistJson(clearCore))
        assertEquals(clearVector.stringValue("operationId"), clear.id)
        assertEquals(clearVector.stringValue("fileName"), gistOperationFileName(baseFileName, clear.id))

        val stateVector = vectors.objectValue("state")
        val stateCore = stateVector.objectValue("core")
        val stateParents = stateCore.arrayValue("parents").map { (it as JsonPrimitive).content }
        val vault = json.decodeFromJsonElement<SyncVault>(stateCore.objectValue("vault"))
        val tombstones = stateCore.arrayValue("tombstones").map { item ->
            val value = item as JsonObject
            GistTombstone(
                kind = value.stringValue("kind"),
                parentId = value.string("parentId"),
                id = value.stringValue("id"),
                fingerprint = value.stringValue("fingerprint"),
            )
        }
        val state = createGistStateOperation(
            json,
            listOf(stateParents[1], stateParents[0], stateParents[1]),
            vault,
            tombstones,
        )
        val generatedCore = gistOperationJson(state).without("id")

        assertEquals(stateVector.stringValue("canonicalJson"), canonicalGistJson(generatedCore))
        assertEquals(stateVector.stringValue("operationId"), state.id)
        assertEquals(stateVector.stringValue("fileName"), gistOperationFileName(baseFileName, state.id))
    }

    @Test
    fun managedFileCheckRejectsPrefixLookalikes() {
        val fileName = "zerochat-sync.json"

        assertTrue(isManagedGistFile(fileName, fileName))
        assertTrue(isManagedGistFile(fileName, gistOperationFileName(fileName, "a".repeat(64))))
        assertFalse(isManagedGistFile(fileName, "$fileName.zerochat-op-not-an-id.json"))
    }

    @Test
    fun canonicalSortingUsesUtf16CodeUnitsForObjectKeysAndTombstones() {
        val nonBmp = "\uD800\uDC00"
        val privateUse = "\uE000"
        val objectValue = JsonObject(
            linkedMapOf(
                privateUse to JsonPrimitive(1),
                nonBmp to JsonPrimitive(2),
            ),
        )
        val operation = createGistStateOperation(
            json,
            emptyList(),
            vault(),
            listOf(
                GistTombstone("message", privateUse, "1".repeat(64), "conversation-1"),
                GistTombstone("message", nonBmp, "2".repeat(64), "conversation-1"),
            ),
        )

        assertEquals("{\"$nonBmp\":2,\"$privateUse\":1}", canonicalGistJson(objectValue))
        assertEquals(listOf(nonBmp, privateUse), operation.tombstones.map { it.id })
    }

    @Test
    fun vaultNormalizationAppliesEverySharedDefaultRule() {
        val operation = createGistStateOperation(
            json,
            emptyList(),
            vault(
                messages = listOf(message("message-1", 10)),
                skills = listOf(skill("skill-1", 10, emptyChunkContent = true)),
            ),
            emptyList(),
        )
        val data = operation.vaultJson.objectValue("data")
        val provider = data.arrayValue("providers").single() as JsonObject
        val message = (data.arrayValue("conversations").single() as JsonObject)
            .arrayValue("messages")
            .single() as JsonObject
        val chunk = (data.arrayValue("skills").single() as JsonObject)
            .arrayValue("chunks")
            .single() as JsonObject
        val preferences = data.objectValue("preferences")
        val sync = data.objectValue("sync")

        assertFalse("clientRequestMode" in provider)
        assertFalse("custom" in provider)
        assertFalse("models" in provider)
        assertFalse("capabilities" in provider)
        assertFalse("status" in message)
        assertFalse("attachments" in message)
        assertFalse("content" in chunk)
        assertFalse("chatContextMessageLimit" in preferences)
        assertFalse("dismissedDangerWarnings" in preferences)
        assertFalse("dismissedFeatureHints" in preferences)
        assertFalse("gistId" in sync)
        assertFalse("gistFile" in sync)
        assertFalse("lastSyncAt" in sync)
        assertFalse("lastSyncStatus" in sync)
        assertEquals(true, (sync["encryptionEnabled"] as JsonPrimitive).content.toBoolean())
    }

    @Test
    fun missingSkillsAndSkillSettingsNormalizeToSharedDefaults() {
        val dense = createGistStateOperation(json, emptyList(), vault(), emptyList())
        val encoded = json.encodeToJsonElement(SyncVault.serializer(), vault()) as JsonObject
        val sparseData = encoded.objectValue("data").toMutableMap().apply {
            remove("skills")
            remove("skillSettings")
        }
        val sparseVault = JsonObject(encoded.toMutableMap().apply { put("data", JsonObject(sparseData)) })
        val sparse = createGistStateOperation(json, emptyList(), sparseVault, emptyList())

        assertEquals(dense.id, sparse.id)
        assertEquals(JsonArray(emptyList()), sparse.vaultJson.objectValue("data").arrayValue("skills"))
        assertEquals(
            JsonObject(
                mapOf(
                    "autoMatch" to JsonPrimitive(true),
                    "contextBudget" to JsonPrimitive(2400),
                    "maxAutoSkills" to JsonPrimitive(3),
                ),
            ),
            sparse.vaultJson.objectValue("data").objectValue("skillSettings"),
        )
    }

    @Test
    fun parentIdsAndFingerprintsRequireLowercaseSha256Hex() {
        assertThrows(IllegalArgumentException::class.java) {
            createGistClearOperation(listOf("a"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            createGistClearOperation(listOf("A".repeat(64)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            gistOperationFileName("zerochat-sync.json", "g".repeat(64))
        }
        assertThrows(IllegalArgumentException::class.java) {
            createGistStateOperation(
                json,
                emptyList(),
                vault(),
                listOf(GistTombstone("message", "message-1", "g".repeat(64), "conversation-1")),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            createGistStateOperation(
                json,
                emptyList(),
                vault(),
                listOf(GistTombstone("message", "message-1", "1".repeat(64))),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            createGistStateOperation(
                json,
                emptyList(),
                vault(),
                listOf(
                    GistTombstone(
                        "provider",
                        "provider-1",
                        "1".repeat(64),
                        "unexpected-parent",
                    ),
                ),
            )
        }
    }

    @Test
    fun concurrentStateOperationsFromSameParentKeepBothMessages() {
        val base = createGistStateOperation(json, emptyList(), vault(), emptyList())
        val left = createGistStateOperation(
            json,
            listOf(base.id),
            vault(messages = listOf(message("left-message", 20)), updatedAt = 20),
            emptyList(),
        )
        val right = createGistStateOperation(
            json,
            listOf(base.id),
            vault(messages = listOf(message("right-message", 30)), updatedAt = 30),
            emptyList(),
        )

        val materialized = materializeGistOperations(
            json,
            mapOf(base.id to base, left.id to left, right.id to right),
        )

        assertEquals(
            listOf("left-message", "right-message"),
            materialized.vault!!.data.conversations.single().messages.map { it.id },
        )
    }

    @Test
    fun concurrentMessagesAndAttachmentsUseUtf16IdTieBreaks() {
        val nonBmp = "\uD800\uDC00"
        val privateUse = "\uE000"
        val base = createGistStateOperation(json, emptyList(), vault(updatedAt = 10), emptyList())
        val left = createGistStateOperation(
            json,
            listOf(base.id),
            vault(
                messages = listOf(
                    message(privateUse, 20),
                    message("shared", 30, listOf(attachment(privateUse, 40))),
                ),
                updatedAt = 50,
            ),
            emptyList(),
        )
        val right = createGistStateOperation(
            json,
            listOf(base.id),
            vault(
                messages = listOf(
                    message(nonBmp, 20),
                    message("shared", 30, listOf(attachment(nonBmp, 40))),
                ),
                updatedAt = 50,
            ),
            emptyList(),
        )

        val materialized = materializeGistOperations(
            json,
            mapOf(base.id to base, left.id to left, right.id to right),
        )
        val messages = materialized.vault!!.data.conversations.single().messages

        assertEquals(listOf(nonBmp, privateUse, "shared"), messages.map { it.id })
        assertEquals(listOf(nonBmp, privateUse), messages.last().attachments.map { it.id })
    }

    @Test
    fun firstSyncTiesUseUtf16IdsForConversationsAndSkills() {
        val nonBmp = "\uD800\uDC00"
        val privateUse = "\uE000"
        val remote = createGistStateOperation(
            json,
            emptyList(),
            vault(
                updatedAt = 20,
                conversationId = privateUse,
                skills = listOf(skill(privateUse, 20)),
            ),
            emptyList(),
        )
        val local = createGistStateOperation(
            json,
            emptyList(),
            vault(
                updatedAt = 20,
                conversationId = nonBmp,
                skills = listOf(skill(nonBmp, 20)),
            ),
            emptyList(),
        )

        val merged = mergeFirstSyncGistVault(remote.vaultJson, local.vaultJson, now = 20)
            .objectValue("data")

        assertEquals(
            listOf(nonBmp, privateUse),
            merged.arrayValue("conversations").map { (it as JsonObject).stringValue("id") },
        )
        assertEquals(
            listOf(nonBmp, privateUse),
            merged.arrayValue("skills").map { (it as JsonObject).stringValue("id") },
        )
    }

    @Test
    fun messageTombstoneDeletesObservedMessageAndKeepsConcurrentAppend() {
        val original = message("original-message", 10)
        val base = createGistStateOperation(
            json,
            emptyList(),
            vault(messages = listOf(original), updatedAt = 10),
            emptyList(),
        )
        val originalJson = base.vaultJson
            .objectValue("data")
            .arrayValue("conversations")
            .single()
            .let { it as JsonObject }
            .arrayValue("messages")
            .single()
        val deletion = createGistStateOperation(
            json,
            listOf(base.id),
            vault(messages = emptyList(), updatedAt = 20),
            listOf(
                GistTombstone(
                    kind = "message",
                    parentId = "conversation-1",
                    id = original.id,
                    fingerprint = gistFingerprint(originalJson),
                ),
            ),
        )
        val append = createGistStateOperation(
            json,
            listOf(base.id),
            vault(messages = listOf(original, message("new-message", 30)), updatedAt = 30),
            emptyList(),
        )

        val materialized = materializeGistOperations(
            json,
            mapOf(base.id to base, deletion.id to deletion, append.id to append),
        )

        assertEquals(
            listOf("new-message"),
            materialized.vault!!.data.conversations.single().messages.map { it.id },
        )
        assertEquals(1, materialized.tombstones.size)
    }

    @Test
    fun clearDoesNotEraseConcurrentUnobservedStateOperation() {
        val base = createGistStateOperation(json, emptyList(), vault(), emptyList())
        val clear = createGistClearOperation(listOf(base.id))
        val concurrent = createGistStateOperation(
            json,
            listOf(base.id),
            vault(messages = listOf(message("concurrent-message", 20)), updatedAt = 20),
            emptyList(),
        )

        val materialized = materializeGistOperations(
            json,
            mapOf(base.id to base, clear.id to clear, concurrent.id to concurrent),
        )

        assertEquals(
            listOf("concurrent-message"),
            materialized.vault!!.data.conversations.single().messages.map { it.id },
        )
        assertTrue(clear.id in materialized.heads)
        assertTrue(concurrent.id in materialized.heads)
    }

    @Test
    fun legacyStatePlansOneV2WriteAndDeletesOnlyMutableBaseFile() {
        val remoteOperation = createGistStateOperation(
            json,
            emptyList(),
            vault(updatedAt = 5),
            emptyList(),
        )
        val remote = RemoteGistState(
            heads = listOf(remoteOperation.id),
            legacy = true,
            managedFiles = listOf("zerochat-sync.json"),
            operations = mapOf(remoteOperation.id to remoteOperation),
            tombstones = emptyList(),
            vaultJson = remoteOperation.vaultJson,
            vault = remoteOperation.vault,
        )
        val local = createGistStateOperation(
            json,
            emptyList(),
            vault(messages = listOf(message("local-message", 10)), updatedAt = 10),
            emptyList(),
        )
        val reconciled = reconcileGistVault(
            json = json,
            localVaultJson = local.vaultJson,
            remote = remote,
            gistId = "gist-legacy",
            fileName = "zerochat-sync.json",
            firstSyncStrategy = FirstSyncStrategy.UseLocal,
            hasCompletedSync = false,
            hasLocalUserContent = true,
        )
        val migrated = createGistStateOperation(
            json,
            remote.heads,
            reconciled.vaultJson,
            reconciled.tombstones,
        )

        assertTrue(reconciled.shouldWrite)
        assertEquals(
            listOf("zerochat-sync.json"),
            observedStateCompactionDeleteFiles(remote, "zerochat-sync.json"),
        )
        assertTrue(gistOperationFileName("zerochat-sync.json", migrated.id).startsWith(gistOperationFilePrefix("zerochat-sync.json")))
        assertFalse(gistOperationFileName("zerochat-sync.json", migrated.id) == "zerochat-sync.json")
    }

    @Test
    fun sequentialStateCompactionKeepsObservedOperationCountBounded() {
        val fileName = "zerochat-sync.json"
        val prefixLookalike = "$fileName.zerochat-op-not-an-id.json"
        var current = createGistStateOperation(json, emptyList(), vault(updatedAt = 1), emptyList())
        val serverFiles = linkedSetOf(gistOperationFileName(fileName, current.id), prefixLookalike)

        repeat(6) { index ->
            val remote = RemoteGistState(
                heads = listOf(current.id),
                legacy = false,
                managedFiles = serverFiles.toList(),
                operations = mapOf(current.id to current),
                tombstones = current.tombstones,
                vaultJson = current.vaultJson,
                vault = current.vault,
            )
            val next = createGistStateOperation(
                json,
                remote.heads,
                vault(
                    messages = listOf(message("message-$index", index + 2L)),
                    updatedAt = index + 2L,
                ),
                emptyList(),
            )
            val nextFile = gistOperationFileName(fileName, next.id)
            serverFiles += nextFile
            serverFiles.removeAll(observedStateCompactionDeleteFiles(remote, fileName).toSet())

            assertEquals(1, serverFiles.count { gistOperationIdFromFileName(fileName, it) != null })
            assertTrue(prefixLookalike in serverFiles)
            current = next
        }

        val materialized = materializeGistOperations(json, mapOf(current.id to current))
        assertEquals(current.vaultJson, materialized.vaultJson)
    }

    @Test
    fun concurrentCompactingPublishesRemainIndependentMergeableHeads() {
        val fileName = "zerochat-sync.json"
        val prefixLookalike = "$fileName.zerochat-op-not-an-id.json"
        val base = createGistStateOperation(json, emptyList(), vault(updatedAt = 1), emptyList())
        val baseFile = gistOperationFileName(fileName, base.id)
        val observed = RemoteGistState(
            heads = listOf(base.id),
            legacy = false,
            managedFiles = listOf(baseFile, prefixLookalike),
            operations = mapOf(base.id to base),
            tombstones = emptyList(),
            vaultJson = base.vaultJson,
            vault = base.vault,
        )
        val left = createGistStateOperation(
            json,
            observed.heads,
            vault(messages = listOf(message("left", 10)), updatedAt = 10),
            emptyList(),
        )
        val right = createGistStateOperation(
            json,
            observed.heads,
            vault(messages = listOf(message("right", 20)), updatedAt = 20),
            emptyList(),
        )
        val serverFiles = linkedSetOf(baseFile, prefixLookalike)
        val observedDeletes = observedStateCompactionDeleteFiles(observed, fileName).toSet()

        serverFiles += gistOperationFileName(fileName, left.id)
        serverFiles.removeAll(observedDeletes)
        serverFiles += gistOperationFileName(fileName, right.id)
        serverFiles.removeAll(observedDeletes)

        assertEquals(
            setOf(left.id, right.id),
            serverFiles.mapNotNull { gistOperationIdFromFileName(fileName, it) }.toSet(),
        )
        assertTrue(prefixLookalike in serverFiles)
        val materialized = materializeGistOperations(json, mapOf(left.id to left, right.id to right))
        assertEquals(listOf("left", "right"), materialized.vault!!.data.conversations.single().messages.map { it.id })
    }

    @Test
    fun retryAfterLostPatchResponseReusesOperationIdAndSkipsSecondWrite() {
        val base = createGistStateOperation(json, emptyList(), vault(), emptyList())
        storeGistCursor(
            "gist-retry",
            "zerochat-sync.json",
            listOf(base.id),
            123,
            base.vaultJson,
        )
        val editedVault = vault(messages = listOf(message("retry-message", 20)), updatedAt = 20)
        val committed = createGistStateOperation(json, listOf(base.id), editedVault, emptyList())
        val remoteOperations = mapOf(base.id to base, committed.id to committed)
        val materialized = materializeGistOperations(json, remoteOperations)
        val remote = RemoteGistState(
            heads = materialized.heads,
            legacy = false,
            managedFiles = remoteOperations.keys.map { gistOperationFileName("zerochat-sync.json", it) },
            operations = remoteOperations,
            tombstones = materialized.tombstones,
            vaultJson = materialized.vaultJson,
            vault = materialized.vault,
        )
        val local = createGistStateOperation(json, emptyList(), editedVault, emptyList())

        val retry = reconcileGistVault(
            json = json,
            localVaultJson = local.vaultJson,
            remote = remote,
            gistId = "gist-retry",
            fileName = "zerochat-sync.json",
            firstSyncStrategy = FirstSyncStrategy.Ask,
            hasCompletedSync = true,
            hasLocalUserContent = true,
            localSyncAt = 123,
        )
        val retriedOperation = createGistStateOperation(
            json,
            listOf(base.id),
            local.vaultJson,
            emptyList(),
        )

        assertEquals(committed.id, retriedOperation.id)
        assertFalse(retry.shouldWrite)
        assertFalse(retry.remoteAccepted)
    }

    @Test
    fun persistedCursorSurvivesClientRecreationAndRejectsStaleSnapshot() {
        val values = mutableMapOf<String, String>()
        val firstStorage = MapGistCursorStorage(values)
        val secondStorage = MapGistCursorStorage(values)
        val base = createGistStateOperation(json, emptyList(), vault(), emptyList())

        storeGistCursor(
            gistId = "gist-persisted",
            fileName = "zerochat-sync.json",
            heads = listOf(base.id),
            localSyncAt = 456,
            vaultJson = base.vaultJson,
            storage = firstStorage,
        )

        assertEquals(
            listOf(base.id),
            loadGistCursor("gist-persisted", "zerochat-sync.json", 456, secondStorage)?.heads,
        )
        assertNull(loadGistCursor("gist-persisted", "zerochat-sync.json", 457, secondStorage))
    }

    @Test
    fun corruptedOrMismatchedOperationIdsAreRejected() {
        val operation = createGistClearOperation(listOf("a".repeat(64)))
        val serialized = gistOperationJson(operation)
        val wrongExpectedId = "0".repeat(64)
        val wrongEmbeddedId = JsonObject(
            serialized.toMutableMap().apply { put("id", JsonPrimitive("1".repeat(64))) },
        )
        val malformedEmbeddedId = JsonObject(
            serialized.toMutableMap().apply { put("id", JsonPrimitive("A".repeat(64))) },
        )
        val malformedParent = JsonObject(
            serialized.toMutableMap().apply {
                put("parents", JsonArray(listOf(JsonPrimitive("short-parent"))))
            },
        )
        val unknownOperationField = JsonObject(
            serialized.toMutableMap().apply { put("future", JsonPrimitive(true)) },
        )

        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, serialized, wrongExpectedId)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, wrongEmbeddedId, operation.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, malformedEmbeddedId, operation.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, malformedParent, operation.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, unknownOperationField, operation.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(
                json,
                JsonObject(serialized.filterKeys { it != "parents" }),
                operation.id,
            )
        }

        val state = createGistStateOperation(json, emptyList(), vault(), emptyList())
        val messageWithoutParent = JsonObject(
            gistOperationJson(state).toMutableMap().apply {
                put(
                    "tombstones",
                    JsonArray(
                        listOf(
                            JsonObject(
                                mapOf(
                                    "kind" to JsonPrimitive("message"),
                                    "id" to JsonPrimitive("message-1"),
                                    "fingerprint" to JsonPrimitive("1".repeat(64)),
                                ),
                            ),
                        ),
                    ),
                )
            },
        )
        val providerWithParent = JsonObject(
            gistOperationJson(state).toMutableMap().apply {
                put(
                    "tombstones",
                    JsonArray(
                        listOf(
                            JsonObject(
                                mapOf(
                                    "kind" to JsonPrimitive("provider"),
                                    "parentId" to JsonPrimitive("conversation-1"),
                                    "id" to JsonPrimitive("provider-1"),
                                    "fingerprint" to JsonPrimitive("2".repeat(64)),
                                ),
                            ),
                        ),
                    ),
                )
            },
        )
        val malformedFingerprint = JsonObject(
            gistOperationJson(state).toMutableMap().apply {
                put(
                    "tombstones",
                    JsonArray(
                        listOf(
                            JsonObject(
                                mapOf(
                                    "kind" to JsonPrimitive("message"),
                                    "parentId" to JsonPrimitive("conversation-1"),
                                    "id" to JsonPrimitive("message-1"),
                                    "fingerprint" to JsonPrimitive("g".repeat(64)),
                                ),
                            ),
                        ),
                    ),
                )
            },
        )
        val unknownTombstoneField = JsonObject(
            gistOperationJson(state).toMutableMap().apply {
                put(
                    "tombstones",
                    JsonArray(
                        listOf(
                            JsonObject(
                                mapOf(
                                    "kind" to JsonPrimitive("message"),
                                    "parentId" to JsonPrimitive("conversation-1"),
                                    "id" to JsonPrimitive("message-1"),
                                    "fingerprint" to JsonPrimitive("3".repeat(64)),
                                    "future" to JsonPrimitive(true),
                                ),
                            ),
                        ),
                    ),
                )
            },
        )
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, messageWithoutParent, state.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, providerWithParent, state.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, malformedFingerprint, state.id)
        }
        assertThrows(IllegalArgumentException::class.java) {
            parseGistOperationJson(json, unknownTombstoneField, state.id)
        }
    }

    private fun vault(
        messages: List<ChatMessage> = emptyList(),
        updatedAt: Long = 1,
        conversationId: String = "conversation-1",
        skills: List<UserSkill> = emptyList(),
    ): SyncVault = SyncVault(
        data = AppSnapshot(
            providers = listOf(
                ProviderConfig(
                    id = "provider-1",
                    name = "Provider",
                    kind = ProviderKind.OpenAICompatible,
                    baseUrl = "https://example.invalid/v1",
                    model = "model-1",
                    enabled = true,
                    needsApiKey = true,
                    createdAt = 1,
                    updatedAt = 1,
                ),
            ),
            conversations = listOf(
                Conversation(
                    id = conversationId,
                    title = "Conversation",
                    providerId = "provider-1",
                    model = "model-1",
                    messages = messages,
                    createdAt = 1,
                    updatedAt = updatedAt,
                ),
            ),
            skills = skills,
            skillSettings = SkillSettings(),
            sync = SyncConfig(mode = "gist", autoSync = true),
            preferences = Preferences(firstRunDone = true),
            updatedAt = updatedAt,
        ),
        secrets = ProviderSecrets(providerKeys = mapOf("provider-1" to "provider-key")),
    )

    private fun message(
        id: String,
        createdAt: Long,
        attachments: List<MessageAttachment> = emptyList(),
    ): ChatMessage = ChatMessage(
        id = id,
        role = MessageRole.User,
        content = id,
        createdAt = createdAt,
        attachments = attachments,
    )

    private fun attachment(id: String, createdAt: Long): MessageAttachment = MessageAttachment(
        id = id,
        kind = "image",
        mimeType = "image/png",
        dataUrl = "data:image/png;base64,AA==",
        createdAt = createdAt,
    )

    private fun skill(id: String, updatedAt: Long, emptyChunkContent: Boolean = false): UserSkill = UserSkill(
        id = id,
        name = "Skill $id",
        contentHash = "a".repeat(64),
        chunks = listOf(
            UserSkillChunk(
                id = "$id-chunk",
                heading = "Heading",
                content = if (emptyChunkContent) "" else "Content",
                contentRef = if (emptyChunkContent) "content-ref" else null,
                keywords = listOf("keyword"),
                tokenEstimate = 1,
            ),
        ),
        createdAt = 1,
        updatedAt = updatedAt,
    )

    private fun readSharedVectors(): JsonObject {
        val androidRoot = Paths.get(System.getProperty("user.dir")).toRealPath()
        val gitRoot = runCatching {
            val process = ProcessBuilder("git", "rev-parse", "--show-toplevel")
                .directory(androidRoot.toFile())
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().use { it.readText() }.trim()
            check(process.waitFor() == 0 && output.isNotEmpty())
            Paths.get(output)
        }.getOrNull()
        val candidates = listOfNotNull(
            gitRoot?.resolve("shared/examples/gist-operation-v2-vectors.json")?.normalize(),
            androidRoot.resolve("../../shared/examples/gist-operation-v2-vectors.json").normalize(),
            androidRoot.resolve("shared/examples/gist-operation-v2-vectors.json").normalize(),
        )
        val vectorFile = candidates.firstOrNull(Files::isRegularFile)
            ?: error("shared/examples/gist-operation-v2-vectors.json was not found from $androidRoot")
        return json.parseToJsonElement(
            Files.readAllBytes(vectorFile).toString(Charsets.UTF_8),
        ) as JsonObject
    }

    private fun JsonObject.without(key: String): JsonObject = JsonObject(filterKeys { it != key })

    private fun JsonObject.objectValue(key: String): JsonObject = this[key] as JsonObject

    private fun JsonObject.arrayValue(key: String): JsonArray = this[key] as JsonArray

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.stringValue(key: String): String = requireNotNull(string(key))

    private class MapGistCursorStorage(
        private val values: MutableMap<String, String>,
    ) : GistCursorStorage {
        override fun read(key: String): String? = values[key]

        override fun write(key: String, value: String) {
            values[key] = value
        }

        override fun remove(key: String) {
            values.remove(key)
        }
    }
}
