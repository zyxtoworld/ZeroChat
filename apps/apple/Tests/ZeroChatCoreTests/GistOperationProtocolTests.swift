import Foundation
import XCTest
@testable import ZeroChatCore

final class GistOperationProtocolTests: XCTestCase {
    func testSharedGoldenClearOperationIdCanonicalJSONAndFileName() throws {
        let vectors = try loadVectors()
        let firstParent = vectors.clear.core.parents[0]
        let secondParent = vectors.clear.core.parents[1]
        let operation = try createGistClearOperation(
            parents: [secondParent, firstParent, secondParent]
        )

        XCTAssertEqual(try canonicalGistOperationCoreJSON(operation), vectors.clear.canonicalJson)
        XCTAssertEqual(operation.id, vectors.clear.operationId)
        XCTAssertEqual(
            gistOperationFileName(vectors.baseFileName, id: operation.id),
            vectors.clear.fileName
        )
    }

    func testSharedGoldenStateOperationIdCanonicalJSONAndFileName() throws {
        let vectors = try loadVectors()
        let firstParent = vectors.state.core.parents[0]
        let secondParent = vectors.state.core.parents[1]
        let operation = try createGistStateOperation(
            parents: [secondParent, firstParent, secondParent],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "0", count: 64),
                    id: "message-1",
                    kind: .message,
                    parentId: "conversation-1"
                ),
            ]
        )

        XCTAssertEqual(try canonicalGistOperationCoreJSON(operation), vectors.state.canonicalJson)
        XCTAssertEqual(operation.id, vectors.state.operationId)
        XCTAssertEqual(
            gistOperationFileName(vectors.baseFileName, id: operation.id),
            vectors.state.fileName
        )
    }

    func testConcurrentStateHeadsPreserveMessagesFromBothClients() throws {
        let base = try createGistStateOperation(parents: [], vault: chatVault(messages: [], updatedAt: 10), tombstones: [])
        let left = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(messages: [message("left-message", at: 20)], updatedAt: 20),
            tombstones: []
        )
        let right = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(messages: [message("right-message", at: 30)], updatedAt: 30),
            tombstones: []
        )

        let materialized = try materializeGistOperations([
            base.id: base,
            left.id: left,
            right.id: right,
        ])

        XCTAssertEqual(
            materialized.vault?.data.conversations.first?.messages.map(\.id),
            ["left-message", "right-message"]
        )
    }

    func testPrunedParentsRemainValidAndConcurrentHeadsStillMerge() throws {
        let prunedParent = String(repeating: "a", count: 64)
        let left = try createGistStateOperation(
            parents: [prunedParent],
            vault: chatVault(messages: [message("left-message", at: 20)], updatedAt: 20),
            tombstones: []
        )
        let right = try createGistStateOperation(
            parents: [prunedParent],
            vault: chatVault(messages: [message("right-message", at: 30)], updatedAt: 30),
            tombstones: []
        )

        let materialized = try materializeGistOperations([
            left.id: left,
            right.id: right,
        ])

        XCTAssertEqual(materialized.heads, [left.id, right.id].sorted())
        XCTAssertEqual(
            materialized.vault?.data.conversations.first?.messages.map(\.id),
            ["left-message", "right-message"]
        )
    }

    func testConcurrentMergeUsesWebLastDuplicateRecordValue() throws {
        let base = try createGistStateOperation(
            parents: [],
            vault: chatVault(messages: [], updatedAt: 10),
            tombstones: []
        )
        let first = ChatMessage(id: "duplicate", role: .user, content: "first", createdAt: 20)
        let last = ChatMessage(id: "duplicate", role: .user, content: "last", createdAt: 20)
        let duplicateBranch = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(messages: [first, last], updatedAt: 20),
            tombstones: []
        )
        let concurrentBranch = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(messages: [message("concurrent", at: 30)], updatedAt: 30),
            tombstones: []
        )

        let materialized = try materializeGistOperations([
            base.id: base,
            duplicateBranch.id: duplicateBranch,
            concurrentBranch.id: concurrentBranch,
        ])

        XCTAssertEqual(
            materialized.vault?.data.conversations.first?.messages.first(where: { $0.id == "duplicate" })?.content,
            "last"
        )
    }

    func testMessageTombstoneDeletesStaleRecordAndPreservesConcurrentAddition() throws {
        let original = message("original-message", at: 10)
        let baseVault = chatVault(messages: [original], updatedAt: 10)
        let base = try createGistStateOperation(parents: [], vault: baseVault, tombstones: [])
        let deletionVault = chatVault(messages: [], updatedAt: 20)
        let deletion = try createGistStateOperation(
            parents: [base.id],
            vault: deletionVault,
            tombstones: try tombstonesBetweenGistVaults(baseVault, deletionVault)
        )
        let append = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(
                messages: [original, message("new-message", at: 30)],
                updatedAt: 30
            ),
            tombstones: []
        )

        let materialized = try materializeGistOperations([
            base.id: base,
            deletion.id: deletion,
            append.id: append,
        ])

        XCTAssertEqual(
            materialized.vault?.data.conversations.first?.messages.map(\.id),
            ["new-message"]
        )
        XCTAssertEqual(materialized.tombstones.map(\.kind), [.message])
    }

    func testClearDoesNotEraseConcurrentUnobservedStateHead() throws {
        let base = try createGistStateOperation(parents: [], vault: chatVault(messages: [], updatedAt: 10), tombstones: [])
        let clear = try createGistClearOperation(parents: [base.id])
        let concurrent = try createGistStateOperation(
            parents: [base.id],
            vault: chatVault(messages: [message("concurrent-message", at: 20)], updatedAt: 20),
            tombstones: []
        )

        let materialized = try materializeGistOperations([
            base.id: base,
            clear.id: clear,
            concurrent.id: concurrent,
        ])

        XCTAssertEqual(materialized.heads, [clear.id, concurrent.id].sorted())
        XCTAssertEqual(
            materialized.vault?.data.conversations.first?.messages.map(\.id),
            ["concurrent-message"]
        )
    }

    func testGeneratesAllCrossPlatformTombstoneKinds() throws {
        let tombstones = try tombstonesBetweenGistVaults(
            tombstoneVault(includeDeletedRecords: true),
            tombstoneVault(includeDeletedRecords: false)
        )

        XCTAssertEqual(Set(tombstones.map(\.kind)), Set(GistTombstoneKind.allCases))
        XCTAssertEqual(
            tombstones.first(where: { $0.kind == .message })?.parentId,
            "conversation-message"
        )
    }

    func testTombstonesSortByUTF16CodeUnitsWithoutLocaleCollation() throws {
        let operation = try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "1", count: 64),
                    id: "\u{E000}",
                    kind: .message,
                    parentId: "conversation-1"
                ),
                GistTombstone(
                    fingerprint: String(repeating: "2", count: 64),
                    id: "\u{10000}",
                    kind: .message,
                    parentId: "conversation-1"
                ),
            ]
        )

        XCTAssertEqual(operation.tombstones.map(\.id), ["\u{10000}", "\u{E000}"])
    }

    func testTombstoneDedupUsesExactUTF16CodeUnits() throws {
        let operation = try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "1", count: 64),
                    id: "\u{00E9}",
                    kind: .message,
                    parentId: "conversation-1"
                ),
                GistTombstone(
                    fingerprint: String(repeating: "1", count: 64),
                    id: "e\u{0301}",
                    kind: .message,
                    parentId: "conversation-1"
                ),
            ]
        )

        XCTAssertEqual(
            operation.tombstones.map { Array($0.id.utf16) },
            [Array("e\u{0301}".utf16), Array("\u{00E9}".utf16)]
        )
    }

    func testNormalizesEveryProtocolDefaultBeforeIdentityAndFingerprinting() throws {
        var explicitDefaults = chatVault(
            messages: [
                ChatMessage(
                    id: "message",
                    role: .assistant,
                    content: "content",
                    createdAt: 10,
                    status: "done",
                    attachments: []
                ),
            ],
            updatedAt: 20
        )
        explicitDefaults.data.providers[0].clientRequestMode = false
        explicitDefaults.data.providers[0].custom = false
        explicitDefaults.data.providers[0].models = []
        explicitDefaults.data.providers[0].capabilities = []
        explicitDefaults.data.skills = nil
        explicitDefaults.data.skillSettings = nil
        explicitDefaults.data.preferences.chatContextMessageLimit = 24
        explicitDefaults.data.preferences.dismissedDangerWarnings = []
        explicitDefaults.data.preferences.dismissedFeatureHints = []
        explicitDefaults.data.sync.gistId = "gist-id"
        explicitDefaults.data.sync.gistFile = "custom.json"
        explicitDefaults.data.sync.lastSyncAt = 20
        explicitDefaults.data.sync.lastSyncStatus = "done"
        explicitDefaults.data.sync.encryptionEnabled = false

        var omittedDefaults = explicitDefaults
        omittedDefaults.data.providers[0].clientRequestMode = nil
        omittedDefaults.data.providers[0].custom = nil
        omittedDefaults.data.providers[0].models = nil
        omittedDefaults.data.providers[0].capabilities = nil
        omittedDefaults.data.skills = []
        omittedDefaults.data.skillSettings = SkillSettings()
        omittedDefaults.data.conversations[0].messages[0].status = nil
        omittedDefaults.data.conversations[0].messages[0].attachments = nil
        omittedDefaults.data.preferences.chatContextMessageLimit = nil
        omittedDefaults.data.preferences.dismissedDangerWarnings = nil
        omittedDefaults.data.preferences.dismissedFeatureHints = nil
        omittedDefaults.data.sync.gistId = nil
        omittedDefaults.data.sync.gistFile = nil
        omittedDefaults.data.sync.lastSyncAt = nil
        omittedDefaults.data.sync.lastSyncStatus = nil
        omittedDefaults.data.sync.encryptionEnabled = true

        let normalized = normalizeGistVault(explicitDefaults)
        XCTAssertNil(normalized.data.providers[0].clientRequestMode)
        XCTAssertNil(normalized.data.providers[0].custom)
        XCTAssertNil(normalized.data.providers[0].models)
        XCTAssertNil(normalized.data.providers[0].capabilities)
        XCTAssertNil(normalized.data.conversations[0].messages[0].status)
        XCTAssertNil(normalized.data.conversations[0].messages[0].attachments)
        XCTAssertEqual(normalized.data.skills?.count, 0)
        XCTAssertEqual(normalized.data.skillSettings?.autoMatch, true)
        XCTAssertEqual(normalized.data.skillSettings?.contextBudget, 2400)
        XCTAssertEqual(normalized.data.skillSettings?.maxAutoSkills, 3)
        XCTAssertNil(normalized.data.preferences.chatContextMessageLimit)
        XCTAssertNil(normalized.data.preferences.dismissedDangerWarnings)
        XCTAssertNil(normalized.data.preferences.dismissedFeatureHints)
        XCTAssertNil(normalized.data.sync.gistId)
        XCTAssertNil(normalized.data.sync.gistFile)
        XCTAssertNil(normalized.data.sync.lastSyncAt)
        XCTAssertNil(normalized.data.sync.lastSyncStatus)
        XCTAssertTrue(normalized.data.sync.encryptionEnabled)

        let explicitOperation = try createGistStateOperation(
            parents: [],
            vault: explicitDefaults,
            tombstones: []
        )
        let omittedOperation = try createGistStateOperation(
            parents: [],
            vault: omittedDefaults,
            tombstones: []
        )
        XCTAssertEqual(explicitOperation.id, omittedOperation.id)
        XCTAssertTrue(try gistVaultsEqual(explicitDefaults, omittedDefaults))
    }

    func testEmptySkillChunkContentIsAbsentFromCanonicalVault() throws {
        var vault = goldenStateVault()
        vault.data.skills = [
            UserSkill(
                id: "skill",
                name: "Skill",
                chunks: [
                    UserSkillChunk(
                        id: "chunk",
                        heading: "Heading",
                        content: "",
                        tokenEstimate: 1
                    ),
                ],
                createdAt: 1,
                updatedAt: 1
            ),
        ]
        let operation = try createGistStateOperation(parents: [], vault: vault, tombstones: [])

        XCTAssertFalse(try canonicalGistOperationCoreJSON(operation).contains("\"content\":\"\""))
    }

    func testConcurrentMessagesAndAttachmentsUseUTF16IdTieBreaks() throws {
        var remote = chatVault(messages: [], updatedAt: 20)
        var local = chatVault(messages: [], updatedAt: 20)
        let remoteAttachment = MessageAttachment(
            id: "\u{E000}",
            kind: "file",
            mimeType: "text/plain",
            createdAt: 5
        )
        let localAttachment = MessageAttachment(
            id: "\u{10000}",
            kind: "file",
            mimeType: "text/plain",
            createdAt: 5
        )
        remote.data.conversations[0].messages = [
            ChatMessage(
                id: "shared",
                role: .user,
                content: "remote",
                createdAt: 5,
                attachments: [remoteAttachment]
            ),
            message("\u{E000}", at: 10),
        ]
        local.data.conversations[0].messages = [
            ChatMessage(
                id: "shared",
                role: .user,
                content: "local",
                createdAt: 5,
                attachments: [localAttachment]
            ),
            message("\u{10000}", at: 10),
        ]

        let merged = try mergeGistVaults(base: nil, remote: remote, local: local)
        let messages = try XCTUnwrap(merged.data.conversations.first?.messages)
        XCTAssertEqual(messages.map(\.id), ["shared", "\u{10000}", "\u{E000}"])
        XCTAssertEqual(
            messages.first(where: { $0.id == "shared" })?.attachments?.map(\.id),
            ["\u{10000}", "\u{E000}"]
        )
    }

    func testEncryptedObjectEnvelopeRoundTripsValidatedOperation() async throws {
        let operation = try createGistStateOperation(
            parents: [String(repeating: "a", count: 64)],
            vault: chatVault(messages: [message("message", at: 20)], updatedAt: 20),
            tombstones: []
        )
        let crypto = CryptoEngine()
        let envelope = try await crypto.encryptObject(
            operation,
            passphrase: "operation-round-trip-passphrase",
            objectType: gistOperationObjectType,
            updatedAt: 20
        )
        let decoded = try await crypto.decryptObject(
            GistOperation.self,
            envelope: envelope,
            passphrase: "operation-round-trip-passphrase",
            expectedObjectType: gistOperationObjectType
        )

        XCTAssertEqual(try validateGistOperation(decoded, expectedId: operation.id).id, operation.id)
    }

    func testRejectsEmbeddedIdFilenameIdAndMalformedClear() throws {
        let valid = try createGistStateOperation(parents: [], vault: chatVault(messages: [], updatedAt: 10), tombstones: [])
        var wrongEmbeddedId = valid
        wrongEmbeddedId.id = String(repeating: "0", count: 64)
        XCTAssertThrowsError(try validateGistOperation(wrongEmbeddedId, expectedId: wrongEmbeddedId.id))
        XCTAssertThrowsError(
            try validateGistOperation(valid, expectedId: String(repeating: "f", count: 64))
        )

        var malformedClear = try createGistClearOperation(parents: [])
        malformedClear.vault = chatVault(messages: [], updatedAt: 10)
        XCTAssertThrowsError(try validateGistOperation(malformedClear, expectedId: malformedClear.id))
        XCTAssertNil(
            gistOperationId(
                fileName: "zerochat-sync.json",
                candidate: "zerochat-sync.json.zerochat-op-not-a-valid-id.json"
            )
        )
        XCTAssertFalse(
            isManagedGistFile(
                fileName: "zerochat-sync.json",
                candidate: "zerochat-sync.json.zerochat-op-not-a-valid-id.json"
            )
        )
    }

    func testCreateAndParseShapeRejectInvalidHashesAndTombstoneParents() throws {
        XCTAssertThrowsError(try createGistClearOperation(parents: ["not-a-hash"]))
        XCTAssertThrowsError(try createGistClearOperation(
            parents: [String(repeating: "A", count: 64)]
        ))
        XCTAssertThrowsError(try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: "not-a-hash",
                    id: "message",
                    kind: .message,
                    parentId: "conversation"
                ),
            ]
        ))
        XCTAssertThrowsError(try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "0", count: 64),
                    id: "message",
                    kind: .message,
                    parentId: nil
                ),
            ]
        ))
        XCTAssertThrowsError(try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "0", count: 64),
                    id: "provider",
                    kind: .provider,
                    parentId: "unexpected-parent"
                ),
            ]
        ))

        var invalidParsed = try createGistClearOperation(parents: [])
        invalidParsed.parents = ["not-a-hash"]
        XCTAssertThrowsError(try validateGistOperation(invalidParsed, expectedId: invalidParsed.id))
        invalidParsed = try createGistClearOperation(parents: [])
        invalidParsed.id = invalidParsed.id.uppercased()
        XCTAssertThrowsError(try validateGistOperation(invalidParsed, expectedId: invalidParsed.id))

        var invalidFingerprint = try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: [
                GistTombstone(
                    fingerprint: String(repeating: "a", count: 64),
                    id: "message",
                    kind: .message,
                    parentId: "conversation"
                ),
            ]
        )
        invalidFingerprint.tombstones[0].fingerprint = String(repeating: "A", count: 64)
        XCTAssertThrowsError(
            try validateGistOperation(invalidFingerprint, expectedId: invalidFingerprint.id)
        )
        XCTAssertNil(gistOperationId(
            fileName: "zerochat-sync.json",
            candidate: "zerochat-sync.json.zerochat-op-\(String(repeating: "A", count: 64)).json"
        ))

        let decoder = JSONDecoder()
        XCTAssertThrowsError(try decoder.decode(
            GistTombstone.self,
            from: Data(#"{"fingerprint":"0000000000000000000000000000000000000000000000000000000000000000","id":"provider","kind":"provider","parentId":null}"#.utf8)
        ))
        XCTAssertThrowsError(try decoder.decode(
            GistTombstone.self,
            from: Data(#"{"fingerprint":"0000000000000000000000000000000000000000000000000000000000000000","id":"message","kind":"message"}"#.utf8)
        ))
        XCTAssertThrowsError(try decoder.decode(
            GistOperation.self,
            from: Data(#"{"id":"0000000000000000000000000000000000000000000000000000000000000000","kind":"zerochat.gistOperation","operation":"clear","parents":[],"tombstones":[],"vault":null,"version":2}"#.utf8)
        ))
        XCTAssertThrowsError(try decoder.decode(
            GistTombstone.self,
            from: Data(#"{"fingerprint":"0000000000000000000000000000000000000000000000000000000000000000","id":"provider","kind":"provider","unexpected":true}"#.utf8)
        ))
        XCTAssertThrowsError(try decoder.decode(
            GistOperation.self,
            from: Data(#"{"id":"0000000000000000000000000000000000000000000000000000000000000000","kind":"zerochat.gistOperation","operation":"clear","parents":[],"tombstones":[],"unexpected":true,"version":2}"#.utf8)
        ))

        let validState = try createGistStateOperation(
            parents: [],
            vault: goldenStateVault(),
            tombstones: []
        )
        guard var stateObject = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(validState)
        ) as? [String: Any],
        var vaultObject = stateObject["vault"] as? [String: Any],
        var dataObject = vaultObject["data"] as? [String: Any] else {
            XCTFail("Expected encoded state operation object")
            return
        }
        dataObject["unexpected"] = true
        vaultObject["data"] = dataObject
        stateObject["vault"] = vaultObject
        XCTAssertThrowsError(try decoder.decode(
            GistOperation.self,
            from: JSONSerialization.data(withJSONObject: stateObject)
        ))
    }

    private func loadVectors() throws -> GistVectors {
        let repositoryRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let url = repositoryRoot
            .appendingPathComponent("shared")
            .appendingPathComponent("examples")
            .appendingPathComponent("gist-operation-v2-vectors.json")
        return try JSONDecoder().decode(GistVectors.self, from: Data(contentsOf: url))
    }
}

private struct GistVectors: Decodable {
    struct Core: Decodable {
        var parents: [String]
    }

    struct Operation: Decodable {
        var core: Core
        var canonicalJson: String
        var operationId: String
        var fileName: String
    }

    var baseFileName: String
    var clear: Operation
    var state: Operation
}

private func goldenStateVault() -> SyncVault {
    SyncVault(
        data: AppSnapshot(
            providers: [],
            conversations: [],
            skills: [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(
                mode: "cloudflare",
                autoSync: true,
                encryptionEnabled: true,
                gistFile: nil
            ),
            preferences: Preferences(firstRunDone: true),
            updatedAt: 1_760_000_001_000
        ),
        secrets: ProviderSecrets(
            providerKeys: ["provider-openai-responses": "example-provider-key"]
        )
    )
}

private func chatVault(messages: [ChatMessage], updatedAt: Int64) -> SyncVault {
    let provider = ProviderConfig(
        id: "provider",
        name: "Provider",
        kind: .openAICompatible,
        baseUrl: "https://example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    return SyncVault(
        data: AppSnapshot(
            providers: [provider],
            conversations: [
                Conversation(
                    id: "conversation",
                    title: "Conversation",
                    providerId: provider.id,
                    model: provider.model,
                    messages: messages,
                    createdAt: 1,
                    updatedAt: updatedAt
                ),
            ],
            skills: [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(mode: "gist", autoSync: true, encryptionEnabled: true, gistFile: nil),
            preferences: Preferences(firstRunDone: true),
            updatedAt: updatedAt
        )
    )
}

private func message(_ id: String, at createdAt: Int64) -> ChatMessage {
    ChatMessage(id: id, role: .user, content: id, createdAt: createdAt)
}

private func tombstoneVault(includeDeletedRecords: Bool) -> SyncVault {
    let keepProvider = ProviderConfig(
        id: "provider-keep",
        name: "Keep",
        kind: .openAICompatible,
        baseUrl: "https://keep.example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    let deletedProvider = ProviderConfig(
        id: "provider-delete",
        name: "Delete",
        kind: .openAICompatible,
        baseUrl: "https://delete.example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    let deletedMessage = message("message-delete", at: 1)
    let messageConversation = Conversation(
        id: "conversation-message",
        title: "Message tombstone",
        providerId: keepProvider.id,
        model: keepProvider.model,
        messages: includeDeletedRecords ? [deletedMessage] : [],
        createdAt: 1,
        updatedAt: includeDeletedRecords ? 1 : 2
    )
    let deletedConversation = Conversation(
        id: "conversation-delete",
        title: "Conversation tombstone",
        providerId: keepProvider.id,
        model: keepProvider.model,
        messages: [],
        createdAt: 1,
        updatedAt: 1
    )
    let deletedSkill = UserSkill(
        id: "skill-delete",
        name: "Delete",
        contentType: "text",
        sourceSize: 4,
        contentHash: "hash",
        chunks: [
            UserSkillChunk(
                id: "chunk",
                heading: "Chunk",
                content: "body",
                tokenEstimate: 1
            ),
        ],
        createdAt: 1,
        updatedAt: 1
    )
    return SyncVault(
        data: AppSnapshot(
            providers: includeDeletedRecords ? [deletedProvider, keepProvider] : [keepProvider],
            conversations: includeDeletedRecords
                ? [deletedConversation, messageConversation]
                : [messageConversation],
            skills: includeDeletedRecords ? [deletedSkill] : [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(mode: "gist", autoSync: true, encryptionEnabled: true, gistFile: nil),
            preferences: Preferences(firstRunDone: true),
            updatedAt: includeDeletedRecords ? 1 : 2
        ),
        secrets: ProviderSecrets(
            providerKeys: includeDeletedRecords ? [deletedProvider.id: "secret"] : [:]
        )
    )
}
