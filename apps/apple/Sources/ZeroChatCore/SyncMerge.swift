import Foundation

func acceptRemoteVault(_ remote: SyncVault, local: AppSnapshot) -> SyncVault {
    var accepted = remote
    accepted.data.sync = mergeSyncConfig(remote: remote.data.sync, local: local.sync)
    return accepted
}

func mergeFirstSyncVault(remote: SyncVault, local: SyncVault) -> SyncVault {
    let conversations = mergeFirstSyncRecords(
        remote.data.conversations,
        local.data.conversations,
        updatedAt: \Conversation.updatedAt
    ).sorted(by: newestRecordFirst(\Conversation.updatedAt))
    let providers = mergeFirstSyncRecords(
        remote.data.providers,
        local.data.providers,
        updatedAt: \ProviderConfig.updatedAt,
        mergeSameId: mergeFirstSyncProvider
    )
    let skills = mergeFirstSyncRecords(
        remote.data.skills ?? [],
        local.data.skills ?? [],
        updatedAt: \UserSkill.updatedAt
    ).sorted(by: newestRecordFirst(\UserSkill.updatedAt))
    let now = syncNowMillis()
    var sync = local.data.sync
    sync.encryptionEnabled = true

    let data = AppSnapshot(
        version: 1,
        providers: providers,
        conversations: conversations,
        skills: skills,
        skillSettings: mergeFirstSyncSkillSettings(
            remote: remote.data.skillSettings,
            local: local.data.skillSettings
        ),
        sync: sync,
        preferences: mergeFirstSyncPreferences(
            remote: remote.data.preferences,
            local: local.data.preferences,
            conversations: conversations
        ),
        updatedAt: max(remote.data.updatedAt, local.data.updatedAt, now)
    )

    return SyncVault(
        data: data,
        secrets: ProviderSecrets(
            providerKeys: remote.secrets.providerKeys.merging(local.secrets.providerKeys) { _, local in local }
        )
    )
}

func syncNowMillis() -> Int64 {
    Int64(Date().timeIntervalSince1970 * 1000)
}

private func mergeSyncConfig(remote: SyncConfig, local: SyncConfig) -> SyncConfig {
    var merged = remote
    merged.mode = local.mode
    merged.autoSync = local.autoSync
    merged.encryptionEnabled = true
    merged.gistId = local.gistId ?? remote.gistId
    merged.gistFile = local.gistFile ?? remote.gistFile
    merged.workerEndpoint = local.workerEndpoint ?? remote.workerEndpoint
    merged.lastSyncAt = syncNowMillis()
    merged.lastSyncStatus = "Remote data restored"
    return merged
}

private func mergeFirstSyncSkillSettings(remote: SkillSettings?, local: SkillSettings?) -> SkillSettings {
    let defaults = SkillSettings()
    let remote = remote ?? defaults
    let local = local ?? defaults
    return SkillSettings(
        autoMatch: local.autoMatch != defaults.autoMatch ? local.autoMatch : remote.autoMatch,
        contextBudget: local.contextBudget != defaults.contextBudget ? local.contextBudget : remote.contextBudget,
        maxAutoSkills: local.maxAutoSkills != defaults.maxAutoSkills ? local.maxAutoSkills : remote.maxAutoSkills
    )
}

private func mergeFirstSyncPreferences(
    remote: Preferences,
    local: Preferences,
    conversations: [Conversation]
) -> Preferences {
    let conversationIds = Set(conversations.map(\.id))
    let activeConversationId: String?
    if let localId = local.activeConversationId, conversationIds.contains(localId) {
        activeConversationId = localId
    } else if let remoteId = remote.activeConversationId, conversationIds.contains(remoteId) {
        activeConversationId = remoteId
    } else {
        activeConversationId = nil
    }
    let messageLimit = local.chatContextMessageLimit ?? remote.chatContextMessageLimit
    let warnings = uniqueNonEmptyStrings(
        (remote.dismissedDangerWarnings ?? []) + (local.dismissedDangerWarnings ?? [])
    )
    let hints = uniqueNonEmptyStrings(
        (remote.dismissedFeatureHints ?? []) + (local.dismissedFeatureHints ?? [])
    )

    return Preferences(
        firstRunDone: remote.firstRunDone || local.firstRunDone,
        theme: local.theme != "system" ? local.theme : remote.theme,
        language: local.language != "system" ? local.language : remote.language,
        compactMode: remote.compactMode || local.compactMode,
        chatContextMessageLimit: messageLimit == 24 ? nil : messageLimit,
        activeConversationId: activeConversationId,
        dismissedDangerWarnings: warnings.isEmpty ? nil : warnings,
        dismissedFeatureHints: hints.isEmpty ? nil : hints
    )
}

private func mergeFirstSyncProvider(remote: ProviderConfig, local: ProviderConfig) -> ProviderConfig {
    let localIsNewer = local.updatedAt >= remote.updatedAt
    let base = localIsNewer ? local : remote
    let other = localIsNewer ? remote : local
    let models = uniqueNonEmptyStrings(
        (base.models ?? [])
            + (other.models ?? [])
            + [base.model, other.model]
            + [base.imageModel, other.imageModel].compactMap { $0 }
    )
    let capabilities = uniqueNonEmptyStrings(
        (base.capabilities ?? []) + (other.capabilities ?? [])
    )

    return ProviderConfig(
        id: base.id,
        name: base.name,
        kind: base.kind,
        baseUrl: base.baseUrl,
        proxyUrl: base.proxyUrl,
        clientRequestMode: base.clientRequestMode,
        model: base.model.isEmpty ? other.model : base.model,
        imageModel: nonEmpty(base.imageModel) ?? nonEmpty(other.imageModel),
        audioSpeechModel: nonEmpty(base.audioSpeechModel) ?? nonEmpty(other.audioSpeechModel),
        audioTranscriptionModel: nonEmpty(base.audioTranscriptionModel) ?? nonEmpty(other.audioTranscriptionModel),
        embeddingModel: nonEmpty(base.embeddingModel) ?? nonEmpty(other.embeddingModel),
        moderationModel: nonEmpty(base.moderationModel) ?? nonEmpty(other.moderationModel),
        realtimeModel: nonEmpty(base.realtimeModel) ?? nonEmpty(other.realtimeModel),
        models: models.isEmpty ? nil : models,
        capabilities: capabilities.isEmpty ? nil : capabilities,
        enabled: base.enabled,
        needsApiKey: base.needsApiKey,
        custom: (base.custom == true || other.custom == true) ? true : nil,
        createdAt: min(remote.createdAt, local.createdAt),
        updatedAt: max(remote.updatedAt, local.updatedAt)
    )
}

private func mergeFirstSyncRecords<T: Identifiable>(
    _ remote: [T],
    _ local: [T],
    updatedAt: KeyPath<T, Int64>,
    mergeSameId: ((T, T) -> T)? = nil
) -> [T] where T.ID == String {
    var merged: [T] = []
    var indexes: [String: Int] = [:]
    for item in remote {
        if let index = indexes[item.id] {
            merged[index] = item
        } else {
            indexes[item.id] = merged.count
            merged.append(item)
        }
    }

    for item in local {
        guard let index = indexes[item.id] else {
            indexes[item.id] = merged.count
            merged.append(item)
            continue
        }
        let existing = merged[index]
        if let mergeSameId {
            merged[index] = mergeSameId(existing, item)
        } else if item[keyPath: updatedAt] >= existing[keyPath: updatedAt] {
            merged[index] = item
        }
    }
    return merged
}

private func newestRecordFirst<T: Identifiable>(
    _ updatedAt: KeyPath<T, Int64>
) -> (T, T) -> Bool where T.ID == String {
    { left, right in
        let leftUpdatedAt = left[keyPath: updatedAt]
        let rightUpdatedAt = right[keyPath: updatedAt]
        return leftUpdatedAt != rightUpdatedAt
            ? leftUpdatedAt > rightUpdatedAt
            : gistUTF16CodeUnitLess(left.id, right.id)
    }
}

private func uniqueNonEmptyStrings(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var result: [String] = []
    for value in values {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, seen.insert(trimmed).inserted {
            result.append(trimmed)
        }
    }
    return result
}

private func nonEmpty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
}
