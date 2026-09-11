import Foundation

func decodeValidatedSyncVault(_ data: Data, decoder: JSONDecoder) throws -> SyncVault {
    let json: Any
    do {
        json = try JSONSerialization.jsonObject(with: data)
    } catch {
        throw SnapshotCryptoError.invalidVaultFormat
    }

    guard isCanonicalSyncVaultJSON(json) else {
        throw SnapshotCryptoError.invalidVaultFormat
    }

    let vault: SyncVault
    do {
        vault = try decoder.decode(SyncVault.self, from: data)
    } catch {
        throw SnapshotCryptoError.invalidVaultFormat
    }

    guard isCanonicalAppSnapshot(vault.data) else {
        throw SnapshotCryptoError.invalidVaultFormat
    }
    return vault
}

private func isCanonicalSyncVaultJSON(_ value: Any) -> Bool {
    guard !containsNull(value),
          let vault = objectWithShape(value, allowed: vaultKeys, required: vaultKeys),
          let data = objectWithShape(vault["data"], allowed: appDataKeys, required: appDataKeys),
          let secrets = objectWithShape(vault["secrets"], allowed: secretsKeys, required: secretsKeys),
          let providerKeys = secrets["providerKeys"] as? [String: Any],
          providerKeys.values.allSatisfy({ $0 is String }),
          arrayObjects(data["providers"], allowed: providerKeysAllowed, required: providerKeysRequired) != nil,
          let conversations = arrayObjects(data["conversations"], allowed: conversationKeys, required: conversationKeys),
          let skills = arrayObjects(data["skills"], allowed: skillKeys, required: skillRequiredKeys),
          objectWithShape(data["skillSettings"], allowed: skillSettingsKeys, required: skillSettingsKeys) != nil,
          objectWithShape(data["sync"], allowed: syncKeys, required: syncRequiredKeys) != nil,
          objectWithShape(data["preferences"], allowed: preferencesKeys, required: preferencesRequiredKeys) != nil
    else {
        return false
    }

    for conversation in conversations {
        guard let messages = arrayObjects(
            conversation["messages"],
            allowed: messageKeys,
            required: messageRequiredKeys
        ) else {
            return false
        }
        for message in messages {
            if let attachments = message["attachments"],
               arrayObjects(
                   attachments,
                   allowed: attachmentKeys,
                   required: attachmentRequiredKeys
               ) == nil {
                return false
            }
            if let request = message["queuedTextRequest"],
                objectWithShape(
                    request,
                    allowed: queuedTextRequestKeys,
                    required: queuedTextRequestRequiredKeys
               ) == nil {
                return false
            }
            if let claim = message["offlineReplayClaim"],
               objectWithShape(
                   claim,
                   allowed: offlineReplayClaimKeys,
                   required: offlineReplayClaimKeys
               ) == nil {
                return false
            }
        }
    }

    for skill in skills {
        if arrayObjects(
            skill["chunks"],
            allowed: skillChunkKeys,
            required: skillChunkRequiredKeys
        ) == nil {
            return false
        }
    }

    return true
}

private func containsNull(_ value: Any) -> Bool {
    if value is NSNull { return true }
    if let values = value as? [Any] { return values.contains(where: containsNull) }
    if let values = value as? [String: Any] { return values.values.contains(where: containsNull) }
    return false
}

private func objectWithShape(
    _ value: Any?,
    allowed: Set<String>,
    required: Set<String>
) -> [String: Any]? {
    guard let object = value as? [String: Any],
          object.keys.allSatisfy(allowed.contains),
          required.isSubset(of: Set(object.keys))
    else {
        return nil
    }
    return object
}

private func arrayObjects(
    _ value: Any?,
    allowed: Set<String>,
    required: Set<String>
) -> [[String: Any]]? {
    guard let values = value as? [Any] else { return nil }
    var objects: [[String: Any]] = []
    objects.reserveCapacity(values.count)
    for value in values {
        guard let object = objectWithShape(value, allowed: allowed, required: required) else {
            return nil
        }
        objects.append(object)
    }
    return objects
}

private func isCanonicalAppSnapshot(_ data: AppSnapshot) -> Bool {
    data.version == 1
        && data.updatedAt >= 0
        && hasUniqueSnapshotRecordIds(data)
        && data.providers.allSatisfy(isCanonicalProvider)
        && data.conversations.allSatisfy(isCanonicalConversation)
        && (data.skills ?? []).allSatisfy(isCanonicalSkill)
        && data.skillSettings.map(isCanonicalSkillSettings) == true
        && isCanonicalSyncConfig(data.sync)
        && isCanonicalPreferences(data.preferences)
}

func hasUniqueSnapshotRecordIds(_ data: AppSnapshot) -> Bool {
    hasUniqueIds(data.providers)
        && hasUniqueIds(data.conversations)
        && data.conversations.allSatisfy { conversation in
            hasUniqueIds(conversation.messages)
                && conversation.messages.allSatisfy { message in
                    hasUniqueIds(message.attachments ?? [])
                }
        }
        && hasUniqueIds(data.skills ?? [])
        && (data.skills ?? []).allSatisfy { skill in
            hasUniqueIds(skill.chunks)
        }
}

private func hasUniqueIds<Value: Identifiable>(_ values: [Value]) -> Bool where Value.ID: Hashable {
    Set(values.map(\.id)).count == values.count
}

private func isCanonicalProvider(_ provider: ProviderConfig) -> Bool {
    let models = provider.models ?? []
    let capabilities = provider.capabilities ?? []
    return !provider.id.isEmpty
        && !provider.name.isEmpty
        && !provider.baseUrl.isEmpty
        && models.allSatisfy { !$0.isEmpty }
        && Set(models).count == models.count
        && capabilities.allSatisfy(providerCapabilities.contains)
        && Set(capabilities).count == capabilities.count
        && provider.createdAt >= 0
        && provider.updatedAt >= 0
}

private func isCanonicalConversation(_ conversation: Conversation) -> Bool {
    !conversation.id.isEmpty
        && !conversation.providerId.isEmpty
        && conversation.createdAt >= 0
        && conversation.updatedAt >= 0
        && conversation.messages.allSatisfy(isCanonicalMessage)
}

private func isCanonicalMessage(_ message: ChatMessage) -> Bool {
    !message.id.isEmpty
        && message.createdAt >= 0
        && messageStatuses.contains(message.status ?? "done")
        && (message.attachments ?? []).allSatisfy(isCanonicalAttachment)
        && message.queuedTextRequest.map(isCanonicalQueuedTextRequest) != false
        && message.offlineReplayClaim.map(isCanonicalOfflineReplayClaim) != false
}

private func isCanonicalQueuedTextRequest(_ request: QueuedTextRequest) -> Bool {
    !request.providerId.isEmpty
        && !request.model.isEmpty
        && request.promptMessageId?.isEmpty != true
}

private func isCanonicalOfflineReplayClaim(_ claim: OfflineReplayClaim) -> Bool {
    !claim.claimId.isEmpty && !claim.owner.isEmpty
}

private func isCanonicalAttachment(_ attachment: MessageAttachment) -> Bool {
    !attachment.id.isEmpty
        && attachment.kind == "image"
        && attachmentPurposes.contains(attachment.purpose)
        && !attachment.mimeType.isEmpty
        && attachment.createdAt >= 0
}

private func isCanonicalSkill(_ skill: UserSkill) -> Bool {
    !skill.id.isEmpty
        && !skill.name.isEmpty
        && skillContentTypes.contains(skill.contentType)
        && skill.sourceSize >= 0
        && !skill.contentHash.isEmpty
        && skill.keywords.allSatisfy { !$0.isEmpty }
        && !skill.chunks.isEmpty
        && skill.chunks.allSatisfy(isCanonicalSkillChunk)
        && skill.createdAt >= 0
        && skill.updatedAt >= 0
}

private func isCanonicalSkillChunk(_ chunk: UserSkillChunk) -> Bool {
    !chunk.id.isEmpty
        && (!chunk.content.isEmpty || !(chunk.contentRef ?? "").isEmpty)
        && chunk.keywords.allSatisfy { !$0.isEmpty }
        && chunk.tokenEstimate >= 1
}

private func isCanonicalSkillSettings(_ settings: SkillSettings) -> Bool {
    (600...8_000).contains(settings.contextBudget)
        && (1...8).contains(settings.maxAutoSkills)
}

private func isCanonicalSyncConfig(_ sync: SyncConfig) -> Bool {
    syncModes.contains(sync.mode) && sync.lastSyncAt.map { $0 >= 0 } != false
}

private func isCanonicalPreferences(_ preferences: Preferences) -> Bool {
    themes.contains(preferences.theme)
        && languages.contains(preferences.language)
        && (4...200).contains(preferences.chatContextMessageLimit ?? 24)
}

private let vaultKeys: Set<String> = ["data", "secrets"]
private let secretsKeys: Set<String> = ["providerKeys"]
private let appDataKeys: Set<String> = [
    "version", "providers", "conversations", "skills", "skillSettings", "sync",
    "preferences", "updatedAt"
]
private let providerCapabilities: Set<String> = [
    "chat", "vision", "tools", "image-generation", "image-editing", "audio",
    "realtime", "embeddings", "moderation", "video", "model-list"
]
private let providerKeysAllowed: Set<String> = [
    "id", "name", "kind", "baseUrl", "proxyUrl", "clientRequestMode", "model",
    "imageModel", "audioSpeechModel", "audioTranscriptionModel", "embeddingModel",
    "moderationModel", "realtimeModel", "models", "capabilities", "enabled",
    "needsApiKey", "custom", "createdAt", "updatedAt"
]
private let providerKeysRequired: Set<String> = [
    "id", "name", "kind", "baseUrl", "model", "enabled", "needsApiKey", "createdAt",
    "updatedAt"
]
private let conversationKeys: Set<String> = [
    "id", "title", "providerId", "model", "messages", "createdAt", "updatedAt"
]
private let messageKeys: Set<String> = [
    "id", "role", "content", "createdAt", "status", "error", "attachments",
    "queuedTextRequest", "offlineReplayClaim"
]
private let messageRequiredKeys: Set<String> = ["id", "role", "content", "createdAt"]
private let queuedTextRequestKeys: Set<String> = ["providerId", "model", "promptMessageId"]
private let queuedTextRequestRequiredKeys: Set<String> = ["providerId", "model"]
private let offlineReplayClaimKeys: Set<String> = ["claimId", "owner"]
private let attachmentKeys: Set<String> = [
    "id", "kind", "purpose", "mimeType", "dataUrl", "url", "alt", "model", "createdAt"
]
private let attachmentRequiredKeys: Set<String> = ["id", "kind", "mimeType", "createdAt"]
private let skillKeys: Set<String> = [
    "id", "name", "description", "fileName", "contentType", "sourceSize", "contentHash",
    "keywords", "chunks", "fixed", "enabled", "autoMatch", "createdAt", "updatedAt"
]
private let skillRequiredKeys: Set<String> = [
    "id", "name", "description", "contentType", "sourceSize", "contentHash", "keywords",
    "chunks", "fixed", "enabled", "autoMatch", "createdAt", "updatedAt"
]
private let skillChunkKeys: Set<String> = [
    "id", "heading", "content", "contentRef", "contentPreview", "keywords", "tokenEstimate"
]
private let skillChunkRequiredKeys: Set<String> = ["id", "heading", "keywords", "tokenEstimate"]
private let skillSettingsKeys: Set<String> = ["autoMatch", "contextBudget", "maxAutoSkills"]
private let syncKeys: Set<String> = [
    "mode", "autoSync", "encryptionEnabled", "gistId", "gistFile", "workerEndpoint",
    "lastSyncAt", "lastSyncStatus"
]
private let syncRequiredKeys: Set<String> = ["mode", "autoSync", "encryptionEnabled"]
private let preferencesKeys: Set<String> = [
    "firstRunDone", "theme", "language", "compactMode", "chatContextMessageLimit",
    "activeConversationId", "dismissedDangerWarnings", "dismissedFeatureHints"
]
private let preferencesRequiredKeys: Set<String> = ["firstRunDone", "theme", "language", "compactMode"]
private let messageStatuses: Set<String> = ["queued", "streaming", "done", "error"]
private let attachmentPurposes: Set<String?> = [nil, "generated", "source", "mask"]
private let skillContentTypes: Set<String> = ["markdown", "text", "json"]
private let syncModes: Set<String> = ["local", "gist", "cloudflare"]
private let themes: Set<String> = ["system", "light", "dark"]
private let languages: Set<String> = [
    "system", "zh-CN", "en-US", "es-ES", "hi-IN", "ar-SA", "pt-BR", "ru-RU",
    "ja-JP", "ko-KR", "fr-FR"
]
