import CryptoKit
import Foundation

func runWithIncrementalRollbackOnFailure<T>(
    operation: () async throws -> T,
    rollback: () async -> Void
) async throws -> T {
    do {
        return try await operation()
    } catch let error as CancellationError {
        throw error
    } catch {
        await rollback()
        throw error
    }
}

struct AppleIncrementalSyncEngine {
    private let crypto: CryptoEngine
    private let transport: AppleCloudflareSyncTransport

    init(crypto: CryptoEngine, transport: AppleCloudflareSyncTransport) {
        self.crypto = crypto
        self.transport = transport
    }

    func readManifest(
        endpoint: URL,
        token: String,
        passphrase: String,
        head: IncrementalSyncHead
    ) async throws -> IncrementalManifest {
        let envelope = try await transport.readIncrementalObject(endpoint: endpoint, token: token, key: head.manifestKey)
        let manifest = try await crypto.decryptObject(
            IncrementalManifest.self,
            envelope: envelope,
            passphrase: passphrase,
            expectedObjectType: "manifest"
        )
        guard manifest.kind == "zerochat.incrementalManifest",
              manifest.version == 1,
              manifest.updatedAt == head.updatedAt,
              hasUniqueSnapshotRecordIds(manifest.data) else {
            throw SyncError.badIncrementalManifest
        }
        return manifest
    }

    func manifestToVault(
        endpoint: URL,
        token: String,
        passphrase: String,
        manifest: IncrementalManifest
    ) async throws -> SyncVault {
        let refsByConversation = Dictionary(grouping: manifest.chunks, by: \.conversationId)
        let refsBySkill = try uniqueIncrementalManifestDictionary(
            manifest.skillChunks ?? [],
            keyedBy: { skillRefKey($0.skillId, $0.chunkId) }
        )
        let refsByAttachment = Dictionary(grouping: manifest.attachmentChunks ?? []) {
            attachmentRefKey($0.conversationId, $0.messageId, $0.attachmentId)
        }
        var consumedAttachmentRefs = Set<String>()

        var conversations: [Conversation] = []
        for conversation in manifest.data.conversations {
            let refs = (refsByConversation[conversation.id] ?? []).sorted { $0.index < $1.index }
            var messages: [ChatMessage] = []

            for ref in refs {
                let envelope = try await transport.readIncrementalObject(endpoint: endpoint, token: token, key: ref.key)
                let chunk = try await crypto.decryptObject(
                    ConversationChunk.self,
                    envelope: envelope,
                    passphrase: passphrase,
                    expectedObjectType: ref.objectType
                )
                guard chunk.kind == "zerochat.conversationChunk",
                      chunk.version == 1,
                      chunk.conversationId == ref.conversationId,
                      chunk.index == ref.index,
                      chunk.updatedAt == ref.updatedAt,
                      chunk.fingerprint == ref.fingerprint,
                      try chunkFingerprint(
                        conversationId: ref.conversationId,
                        index: ref.index,
                        messages: chunk.messages,
                        updatedAt: chunk.updatedAt
                      ) == ref.fingerprint,
                      chunk.messages.count == ref.messageCount else {
                    throw SyncError.badMessageChunk
                }
                messages.append(contentsOf: chunk.messages)
            }

            var materializedMessages: [ChatMessage] = []
            for message in messages {
                var messageCopy = message
                var materializedAttachments: [MessageAttachment] = []
                for attachment in message.attachments ?? [] {
                    let attachmentKey = attachmentRefKey(conversation.id, message.id, attachment.id)
                    let refs = (refsByAttachment[attachmentKey] ?? []).sorted { $0.index < $1.index }
                    guard !refs.isEmpty else {
                        materializedAttachments.append(attachment)
                        continue
                    }
                    guard attachment.dataUrl == nil,
                          refs.enumerated().allSatisfy({ index, ref in
                              ref.index == index &&
                                  ref.chunkCount == refs.count &&
                                  ref.objectType == attachmentChunkObjectType(
                                    conversation.id,
                                    message.id,
                                    attachment.id,
                                    index
                                  )
                          }) else {
                        throw SyncError.badMessageChunk
                    }

                    var dataURL = ""
                    var dataURLByteCount = 0
                    for ref in refs {
                        let envelope = try await transport.readIncrementalObject(
                            endpoint: endpoint,
                            token: token,
                            key: ref.key
                        )
                        let chunk = try await crypto.decryptObject(
                            AttachmentContentChunk.self,
                            envelope: envelope,
                            passphrase: passphrase,
                            expectedObjectType: ref.objectType
                        )
                        guard chunk.kind == "zerochat.attachmentChunk",
                              chunk.version == 1,
                              chunk.conversationId == ref.conversationId,
                              chunk.messageId == ref.messageId,
                              chunk.attachmentId == ref.attachmentId,
                              chunk.index == ref.index,
                              chunk.chunkCount == ref.chunkCount,
                              chunk.updatedAt == ref.updatedAt,
                              chunk.fingerprint == ref.fingerprint,
                              !chunk.content.isEmpty,
                              try attachmentChunkFingerprint(
                                conversationId: ref.conversationId,
                                messageId: ref.messageId,
                                attachmentId: ref.attachmentId,
                                index: ref.index,
                                content: chunk.content
                              ) == ref.fingerprint else {
                            throw SyncError.badMessageChunk
                        }
                        dataURLByteCount = try nextIncrementalAttachmentDataURLByteCount(
                            currentBytes: dataURLByteCount,
                            nextContent: chunk.content
                        )
                        dataURL += chunk.content
                    }
                    guard let safeDataURL = safeImageAttachmentDataURL(dataURL)?.dataURL else {
                        throw SyncError.badMessageChunk
                    }
                    var attachmentCopy = attachment
                    attachmentCopy.dataUrl = safeDataURL
                    materializedAttachments.append(attachmentCopy)
                    consumedAttachmentRefs.insert(attachmentKey)
                }
                messageCopy.attachments = message.attachments == nil ? nil : materializedAttachments
                materializedMessages.append(messageCopy)
            }

            var copy = conversation
            copy.messages = materializedMessages
            conversations.append(copy)
        }

        guard consumedAttachmentRefs.count == refsByAttachment.count else {
            throw SyncError.badMessageChunk
        }

        var skills: [UserSkill] = []
        for skill in manifest.data.skills ?? [] {
            var next = skill
            next.chunks = try await skill.chunks.asyncMap { chunk in
                guard let ref = refsBySkill[skillRefKey(skill.id, chunk.id)] else {
                    var copy = chunk
                    copy.content = chunk.content.trimmingCharacters(in: .whitespacesAndNewlines)
                    return copy
                }

                let envelope = try await transport.readIncrementalObject(endpoint: endpoint, token: token, key: ref.key)
                let remoteChunk = try await crypto.decryptObject(
                    SkillContentChunk.self,
                    envelope: envelope,
                    passphrase: passphrase,
                    expectedObjectType: ref.objectType
                )
                guard remoteChunk.kind == "zerochat.skillChunk",
                      remoteChunk.version == 1,
                      remoteChunk.skillId == ref.skillId,
                      remoteChunk.chunkId == ref.chunkId,
                      remoteChunk.updatedAt == ref.updatedAt,
                      remoteChunk.fingerprint == ref.fingerprint,
                      skillChunkFingerprint(
                        skillId: ref.skillId,
                        chunkId: ref.chunkId,
                        content: remoteChunk.content
                      ) == ref.fingerprint else {
                    throw SyncError.badSkillChunk
                }
                var copy = chunk
                copy.content = remoteChunk.content.trimmingCharacters(in: .whitespacesAndNewlines)
                copy.contentRef = nil
                return copy
            }
            skills.append(next)
        }

        var data = manifest.data
        data.conversations = conversations
        data.skills = skills
        return SyncVault(data: data, secrets: manifest.secrets)
    }

    func uploadVault(
        vault: SyncVault,
        passphrase: String,
        endpoint: URL,
        token: String,
        previous: IncrementalRemoteState?,
        generation: SyncGeneration
    ) async throws -> SyncVault {
        let upload = try await buildUpload(vault: vault, passphrase: passphrase, remoteManifest: previous?.manifest)

        try await runWithIncrementalRollbackOnFailure(
            operation: {
                for chunk in upload.chunks {
                    try await transport.writeIncrementalObject(
                        endpoint: endpoint,
                        token: token,
                        key: chunk.key,
                        envelope: chunk.envelope,
                        generation: generation
                    )
                }
                try await transport.writeIncrementalObject(
                    endpoint: endpoint,
                    token: token,
                    key: upload.head.manifestKey,
                    envelope: upload.manifestEnvelope,
                    generation: generation
                )
            },
            rollback: {
                await rollbackUnpublishedUpload(
                    upload,
                    endpoint: endpoint,
                    token: token,
                    generation: generation
                )
            }
        )

        do {
            try await transport.writeIncrementalHead(
                endpoint: endpoint,
                token: token,
                head: upload.head,
                expectedPreviousHead: previous?.head,
                generation: generation
            )
        } catch let error as SyncError {
            if case .remoteUpdated = error {
                await rollbackUnpublishedUpload(
                    upload,
                    endpoint: endpoint,
                    token: token,
                    generation: generation
                )
                throw error
            }

            if await headWasPublished(
                upload.head,
                endpoint: endpoint,
                token: token,
                generation: generation
            ) {
                try await transport.deleteLegacySnapshot(
                    endpoint: endpoint,
                    token: token,
                    generation: generation
                )
                return vault
            }
            // Once the head request starts, the server may have committed even when its
            // response is lost. These immutable objects may also have become reachable
            // through a later writer, so an unconfirmed result must never delete them.
            throw error
        } catch let error as CancellationError {
            throw error
        } catch {
            if await headWasPublished(
                upload.head,
                endpoint: endpoint,
                token: token,
                generation: generation
            ) {
                try await transport.deleteLegacySnapshot(
                    endpoint: endpoint,
                    token: token,
                    generation: generation
                )
                return vault
            }
            throw error
        }

        // A publisher cannot infer global object reachability from its previously read head.
        try await transport.deleteLegacySnapshot(
            endpoint: endpoint,
            token: token,
            generation: generation
        )
        return vault
    }

    private func headWasPublished(
        _ expected: IncrementalSyncHead,
        endpoint: URL,
        token: String,
        generation: SyncGeneration
    ) async -> Bool {
        guard let observed = try? await transport.readIncrementalHead(endpoint: endpoint, token: token),
              case .head(let head, let observedGeneration) = observed,
              observedGeneration == generation else {
            return false
        }
        return head.kind == expected.kind &&
            head.version == expected.version &&
            head.manifestKey == expected.manifestKey &&
            head.updatedAt == expected.updatedAt
    }

    private func rollbackUnpublishedUpload(
        _ upload: BuiltIncrementalUpload,
        endpoint: URL,
        token: String,
        generation: SyncGeneration
    ) async {
        for chunk in upload.chunks {
            try? await transport.deleteIncrementalObject(
                endpoint: endpoint,
                token: token,
                key: chunk.key,
                generation: generation
            )
        }
        try? await transport.deleteIncrementalObject(
            endpoint: endpoint,
            token: token,
            key: upload.head.manifestKey,
            generation: generation
        )
    }

    func buildUpload(
        vault: SyncVault,
        passphrase: String,
        remoteManifest: IncrementalManifest?
    ) async throws -> BuiltIncrementalUpload {
        let reusableChunks = try uniqueIncrementalManifestDictionary(
            remoteManifest?.chunks ?? [],
            keyedBy: \.fingerprint
        )
        let reusableSkillChunks = try uniqueIncrementalManifestDictionary(
            remoteManifest?.skillChunks ?? [],
            keyedBy: \.fingerprint
        )
        let reusableAttachmentChunks = try uniqueIncrementalManifestDictionary(
            remoteManifest?.attachmentChunks ?? [],
            keyedBy: \.fingerprint
        )
        var chunks: [PendingChunkUpload] = []
        var refs: [IncrementalChunkRef] = []
        var skillRefs: [IncrementalSkillRef] = []
        var attachmentRefs: [IncrementalAttachmentRef] = []

        for conversation in vault.data.conversations {
            var redactedMessages: [ChatMessage] = []
            for message in conversation.messages {
                var messageCopy = message
                var attachments: [MessageAttachment] = []
                for attachment in message.attachments ?? [] {
                    guard let dataURL = attachment.dataUrl else {
                        attachments.append(attachment)
                        continue
                    }
                    guard let safeDataURL = safeImageAttachmentDataURL(dataURL)?.dataURL else {
                        throw SyncError.badMessageChunk
                    }
                    let parts = attachmentContentParts(safeDataURL)
                    for (index, content) in parts.enumerated() {
                        let fingerprint = try attachmentChunkFingerprint(
                            conversationId: conversation.id,
                            messageId: message.id,
                            attachmentId: attachment.id,
                            index: index,
                            content: content
                        )
                        let objectType = attachmentChunkObjectType(
                            conversation.id,
                            message.id,
                            attachment.id,
                            index
                        )
                        let reusable = reusableAttachmentChunks[fingerprint]
                            .flatMap { $0.chunkCount == parts.count ? $0 : nil }
                        let key = reusable?.key ?? objectKey("attachment")
                        let updatedAt = reusable?.updatedAt ?? max(1, attachment.createdAt)
                        attachmentRefs.append(IncrementalAttachmentRef(
                            conversationId: conversation.id,
                            messageId: message.id,
                            attachmentId: attachment.id,
                            index: index,
                            chunkCount: parts.count,
                            key: key,
                            objectType: objectType,
                            fingerprint: fingerprint,
                            updatedAt: updatedAt
                        ))
                        if reusable == nil {
                            let attachmentChunk = AttachmentContentChunk(
                                kind: "zerochat.attachmentChunk",
                                version: 1,
                                conversationId: conversation.id,
                                messageId: message.id,
                                attachmentId: attachment.id,
                                index: index,
                                chunkCount: parts.count,
                                content: content,
                                updatedAt: updatedAt,
                                fingerprint: fingerprint
                            )
                            chunks.append(PendingChunkUpload(
                                key: key,
                                envelope: try await crypto.encryptObject(
                                    attachmentChunk,
                                    passphrase: passphrase,
                                    objectType: objectType,
                                    updatedAt: updatedAt
                                )
                            ))
                        }
                    }
                    var attachmentCopy = attachment
                    attachmentCopy.dataUrl = nil
                    attachmentCopy.url = nil
                    attachments.append(attachmentCopy)
                }
                messageCopy.attachments = message.attachments == nil ? nil : attachments
                redactedMessages.append(messageCopy)
            }

            let grouped = redactedMessages.chunked(into: incrementalChunkSize)
            for (index, messages) in grouped.enumerated() {
                let updatedAt = max(conversation.updatedAt, messages.map(\.createdAt).max() ?? conversation.updatedAt)
                let fingerprint = try chunkFingerprint(conversationId: conversation.id, index: index, messages: messages, updatedAt: updatedAt)
                let objectType = chunkObjectType(conversation.id, index)
                let reusable = reusableChunks[fingerprint]
                let key = reusable?.key ?? objectKey("chunk")
                let ref = IncrementalChunkRef(
                    conversationId: conversation.id,
                    index: index,
                    key: key,
                    objectType: objectType,
                    fingerprint: fingerprint,
                    messageCount: messages.count,
                    updatedAt: updatedAt
                )
                refs.append(ref)

                if reusable == nil {
                    let chunk = ConversationChunk(
                        kind: "zerochat.conversationChunk",
                        version: 1,
                        conversationId: conversation.id,
                        index: index,
                        messages: messages,
                        updatedAt: updatedAt,
                        fingerprint: fingerprint
                    )
                    chunks.append(PendingChunkUpload(
                        key: key,
                        envelope: try await crypto.encryptObject(
                            chunk,
                            passphrase: passphrase,
                            objectType: objectType,
                            updatedAt: updatedAt
                        )
                    ))
                }
            }
        }

        for skill in vault.data.skills ?? [] {
            for chunk in skill.chunks {
                let content = chunk.content.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !content.isEmpty else {
                    throw SyncError.badSkillChunk
                }
                let fingerprint = skillChunkFingerprint(skillId: skill.id, chunkId: chunk.id, content: content)
                let objectType = skillChunkObjectType(skill.id, chunk.id)
                let reusable = reusableSkillChunks[fingerprint]
                let key = reusable?.key ?? objectKey("skill")
                let updatedAt = reusable?.updatedAt ?? skill.updatedAt
                let ref = IncrementalSkillRef(
                    skillId: skill.id,
                    chunkId: chunk.id,
                    key: key,
                    objectType: objectType,
                    fingerprint: fingerprint,
                    updatedAt: updatedAt
                )
                skillRefs.append(ref)

                if reusable == nil {
                    let skillChunk = SkillContentChunk(
                        kind: "zerochat.skillChunk",
                        version: 1,
                        skillId: skill.id,
                        chunkId: chunk.id,
                        content: content,
                        updatedAt: updatedAt,
                        fingerprint: fingerprint
                    )
                    chunks.append(PendingChunkUpload(
                        key: key,
                        envelope: try await crypto.encryptObject(
                            skillChunk,
                            passphrase: passphrase,
                            objectType: objectType,
                            updatedAt: updatedAt
                        )
                    ))
                }
            }
        }

        var manifestData = vault.data
        manifestData.conversations = manifestData.conversations.map {
            var copy = $0
            copy.messages = []
            return copy
        }
        manifestData.skills = (manifestData.skills ?? []).map(emptySkillContent)

        let manifest = IncrementalManifest(
            kind: "zerochat.incrementalManifest",
            version: 1,
            updatedAt: vault.data.updatedAt,
            data: manifestData,
            secrets: vault.secrets,
            chunks: refs,
            skillChunks: skillRefs,
            attachmentChunks: attachmentRefs
        )
        let manifestKey = objectKey("manifest")
        let manifestEnvelope = try await crypto.encryptObject(
            manifest,
            passphrase: passphrase,
            objectType: "manifest",
            updatedAt: manifest.updatedAt
        )

        return BuiltIncrementalUpload(
            head: IncrementalSyncHead(
                kind: "zerochat.incrementalHead",
                version: 1,
                manifestKey: manifestKey,
                updatedAt: manifest.updatedAt
            ),
            manifestEnvelope: manifestEnvelope,
            chunks: chunks
        )
    }

}

struct IncrementalRemoteState {
    var head: IncrementalSyncHead
    var manifest: IncrementalManifest
}

struct PendingChunkUpload {
    var key: String
    var envelope: EncryptedObjectEnvelope
}

struct BuiltIncrementalUpload {
    var head: IncrementalSyncHead
    var manifestEnvelope: EncryptedObjectEnvelope
    var chunks: [PendingChunkUpload]
}

private struct ConversationFingerprint: Encodable {
    var conversationId: String
    var index: Int
    var messages: [ChatMessage]
    var updatedAt: Int64
}

private struct SkillFingerprint: Encodable {
    var skillId: String
    var chunkId: String
    var content: String
}

private let incrementalChunkSize = 60
private let skillChunkPreviewCharacters = 180
private let incrementalAttachmentContentCharacters = 1_500_000

private func objectKey(_ prefix: String) -> String {
    "\(prefix)-\(UUID().uuidString).json"
}

private func chunkObjectType(_ conversationId: String, _ index: Int) -> String {
    "conversationChunk:\(conversationId):\(index)"
}

private func skillChunkObjectType(_ skillId: String, _ chunkId: String) -> String {
    "skillChunk:\(skillId):\(chunkId)"
}

private func attachmentChunkObjectType(
    _ conversationId: String,
    _ messageId: String,
    _ attachmentId: String,
    _ index: Int
) -> String {
    "attachmentChunk:\(conversationId):\(messageId):\(attachmentId):\(index)"
}

private func attachmentRefKey(
    _ conversationId: String,
    _ messageId: String,
    _ attachmentId: String
) -> String {
    "\(conversationId)\u{0}\(messageId)\u{0}\(attachmentId)"
}

func attachmentContentParts(_ dataURL: String) -> [String] {
    var parts: [String] = []
    var start = dataURL.startIndex
    while start < dataURL.endIndex {
        let end = dataURL.index(
            start,
            offsetBy: incrementalAttachmentContentCharacters,
            limitedBy: dataURL.endIndex
        ) ?? dataURL.endIndex
        parts.append(String(dataURL[start..<end]))
        start = end
    }
    return parts
}

private func skillRefKey(_ skillId: String, _ chunkId: String) -> String {
    "\(skillId)\u{0}\(chunkId)"
}

private func chunkFingerprint(
    conversationId: String,
    index: Int,
    messages: [ChatMessage],
    updatedAt: Int64
) throws -> String {
    let encoder = JSONEncoder()
    let payload = try encoder.encode(ConversationFingerprint(
        conversationId: conversationId,
        index: index,
        messages: messages,
        updatedAt: updatedAt
    ))
    return sha256Hex(payload)
}

private func skillChunkFingerprint(
    skillId: String,
    chunkId: String,
    content: String
) -> String {
    if let encoded = try? JSONEncoder().encode(SkillFingerprint(skillId: skillId, chunkId: chunkId, content: content)) {
        return sha256Hex(encoded)
    }
    return sha256Hex(Data(content.utf8))
}

func attachmentChunkFingerprint(
    conversationId: String,
    messageId: String,
    attachmentId: String,
    index: Int,
    content: String
) throws -> String {
    let values = try [conversationId, messageId, attachmentId, content].map { value -> String in
        let encoded = try JSONEncoder().encode(value)
        guard let string = String(data: encoded, encoding: .utf8) else {
            throw SyncError.badMessageChunk
        }
        return string
    }
    let payload = "{\"conversationId\":\(values[0]),\"messageId\":\(values[1]),\"attachmentId\":\(values[2]),\"index\":\(index),\"content\":\(values[3])}"
    return sha256Hex(Data(payload.utf8))
}

func uniqueIncrementalManifestDictionary<Value, Key: Hashable>(
    _ values: [Value],
    keyedBy keyForValue: (Value) -> Key
) throws -> [Key: Value] {
    var result: [Key: Value] = [:]
    result.reserveCapacity(values.count)
    for value in values {
        let key = keyForValue(value)
        guard result.index(forKey: key) == nil else {
            throw SyncError.badIncrementalManifest
        }
        result[key] = value
    }
    return result
}

func nextIncrementalAttachmentDataURLByteCount(
    currentBytes: Int,
    nextContent: String
) throws -> Int {
    guard currentBytes >= 0 else {
        throw SyncError.badMessageChunk
    }

    let (nextBytes, overflow) = currentBytes.addingReportingOverflow(nextContent.utf8.count)
    guard !overflow, nextBytes <= maxImageAttachmentDataURLBytes else {
        throw SyncError.badMessageChunk
    }
    return nextBytes
}

private func sha256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func emptySkillContent(_ skill: UserSkill) -> UserSkill {
    var copy = skill
    copy.chunks = skill.chunks.map { chunk in
        let content = chunk.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let preview = chunk.contentPreview?.trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty
            ?? String(content.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).prefix(skillChunkPreviewCharacters))
                .nilIfEmpty
        var chunkCopy = chunk
        chunkCopy.content = ""
        chunkCopy.contentRef = nil
        chunkCopy.contentPreview = preview
        return chunkCopy
    }
    return copy
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

private extension Array {
    func asyncMap<T>(_ transform: (Element) async throws -> T) async rethrows -> [T] {
        var values: [T] = []
        values.reserveCapacity(count)
        for item in self {
            values.append(try await transform(item))
        }
        return values
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
