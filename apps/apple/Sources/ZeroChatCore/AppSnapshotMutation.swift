import Foundation

public struct AppSnapshotMutation: Sendable {
    private let before: AppSnapshot
    private let after: AppSnapshot

    public init(before: AppSnapshot, after: AppSnapshot) {
        self.before = before
        self.after = after
    }

    public func applying(to snapshot: AppSnapshot) -> AppSnapshot {
        var result = snapshot

        if before.version != after.version {
            result.version = after.version
        }
        result.providers = applyProviderChanges(before: before.providers, after: after.providers, to: result.providers)
        result.conversations = applyRecordChanges(
            before: before.conversations,
            after: after.conversations,
            to: result.conversations
        )
        result.skills = applySkillChanges(before: before.skills, after: after.skills, to: result.skills)
        applySkillSettingsChanges(before: before.skillSettings, after: after.skillSettings, to: &result.skillSettings)
        applySyncChanges(before: before.sync, after: after.sync, to: &result.sync)
        applyPreferenceChanges(before: before.preferences, after: after.preferences, to: &result.preferences)
        result.updatedAt = max(result.updatedAt, after.updatedAt)
        return result
    }
}

private func applyProviderChanges(
    before: [ProviderConfig],
    after: [ProviderConfig],
    to current: [ProviderConfig]
) -> [ProviderConfig] {
    let beforeById = Dictionary(uniqueKeysWithValues: before.map { ($0.id, $0) })
    let afterIds = Set(after.map(\.id))
    var result = current.filter { provider in
        !beforeById.keys.contains(provider.id) || afterIds.contains(provider.id)
    }

    for provider in after {
        guard let previous = beforeById[provider.id] else {
            insertRecord(provider, orderedLike: after, into: &result)
            continue
        }
        guard !encodedValuesEqual(previous, provider) else {
            continue
        }

        if let index = result.firstIndex(where: { $0.id == provider.id }) {
            applyProviderFieldChanges(before: previous, after: provider, to: &result[index])
        } else {
            insertRecord(provider, orderedLike: after, into: &result)
        }
    }

    return result
}

private func applyProviderFieldChanges(
    before: ProviderConfig,
    after: ProviderConfig,
    to provider: inout ProviderConfig
) {
    if before.name != after.name { provider.name = after.name }
    if before.kind.rawValue != after.kind.rawValue { provider.kind = after.kind }
    if before.baseUrl != after.baseUrl { provider.baseUrl = after.baseUrl }
    if before.proxyUrl != after.proxyUrl { provider.proxyUrl = after.proxyUrl }
    if before.clientRequestMode != after.clientRequestMode { provider.clientRequestMode = after.clientRequestMode }
    if before.model != after.model { provider.model = after.model }
    if before.imageModel != after.imageModel { provider.imageModel = after.imageModel }
    if before.audioSpeechModel != after.audioSpeechModel { provider.audioSpeechModel = after.audioSpeechModel }
    if before.audioTranscriptionModel != after.audioTranscriptionModel {
        provider.audioTranscriptionModel = after.audioTranscriptionModel
    }
    if before.embeddingModel != after.embeddingModel { provider.embeddingModel = after.embeddingModel }
    if before.moderationModel != after.moderationModel { provider.moderationModel = after.moderationModel }
    if before.realtimeModel != after.realtimeModel { provider.realtimeModel = after.realtimeModel }
    if before.models != after.models { provider.models = after.models }
    if before.capabilities != after.capabilities { provider.capabilities = after.capabilities }
    if before.enabled != after.enabled { provider.enabled = after.enabled }
    if before.needsApiKey != after.needsApiKey { provider.needsApiKey = after.needsApiKey }
    if before.custom != after.custom { provider.custom = after.custom }
    if before.createdAt != after.createdAt { provider.createdAt = after.createdAt }
    if before.updatedAt != after.updatedAt { provider.updatedAt = after.updatedAt }
}

private func applyRecordChanges<Record: Identifiable & Encodable>(
    before: [Record],
    after: [Record],
    to current: [Record]
) -> [Record] where Record.ID == String {
    let beforeById = Dictionary(uniqueKeysWithValues: before.map { ($0.id, $0) })
    let afterIds = Set(after.map(\.id))
    var result = current.filter { record in
        !beforeById.keys.contains(record.id) || afterIds.contains(record.id)
    }

    for record in after {
        if let previous = beforeById[record.id], encodedValuesEqual(previous, record) {
            continue
        }
        if let index = result.firstIndex(where: { $0.id == record.id }) {
            result[index] = record
        } else {
            insertRecord(record, orderedLike: after, into: &result)
        }
    }
    return result
}

private func insertRecord<Record: Identifiable>(
    _ record: Record,
    orderedLike order: [Record],
    into records: inout [Record]
) where Record.ID == String {
    guard let orderIndex = order.firstIndex(where: { $0.id == record.id }) else {
        records.append(record)
        return
    }

    for following in order.dropFirst(orderIndex + 1) {
        if let insertionIndex = records.firstIndex(where: { $0.id == following.id }) {
            records.insert(record, at: insertionIndex)
            return
        }
    }
    records.append(record)
}

private func applySkillChanges(
    before: [UserSkill]?,
    after: [UserSkill]?,
    to current: [UserSkill]?
) -> [UserSkill]? {
    if before != nil, after == nil {
        return nil
    }
    guard before != nil || after != nil else {
        return current
    }
    return applyRecordChanges(before: before ?? [], after: after ?? [], to: current ?? [])
}

private func applySkillSettingsChanges(
    before: SkillSettings?,
    after: SkillSettings?,
    to current: inout SkillSettings?
) {
    switch (before, after) {
    case (nil, nil):
        return
    case (.some(_), nil):
        current = nil
    case (nil, .some(let after)):
        current = after
    case (.some(let before), .some(let after)):
        var result = current ?? before
        if before.autoMatch != after.autoMatch { result.autoMatch = after.autoMatch }
        if before.contextBudget != after.contextBudget { result.contextBudget = after.contextBudget }
        if before.maxAutoSkills != after.maxAutoSkills { result.maxAutoSkills = after.maxAutoSkills }
        current = result
    }
}

private func applySyncChanges(before: SyncConfig, after: SyncConfig, to current: inout SyncConfig) {
    if before.mode != after.mode { current.mode = after.mode }
    if before.autoSync != after.autoSync { current.autoSync = after.autoSync }
    if before.encryptionEnabled != after.encryptionEnabled { current.encryptionEnabled = after.encryptionEnabled }
    if before.gistId != after.gistId { current.gistId = after.gistId }
    if before.gistFile != after.gistFile { current.gistFile = after.gistFile }
    if before.workerEndpoint != after.workerEndpoint { current.workerEndpoint = after.workerEndpoint }
    if before.lastSyncAt != after.lastSyncAt { current.lastSyncAt = after.lastSyncAt }
    if before.lastSyncStatus != after.lastSyncStatus { current.lastSyncStatus = after.lastSyncStatus }
}

private func applyPreferenceChanges(
    before: Preferences,
    after: Preferences,
    to current: inout Preferences
) {
    if before.firstRunDone != after.firstRunDone { current.firstRunDone = after.firstRunDone }
    if before.theme != after.theme { current.theme = after.theme }
    if before.language != after.language { current.language = after.language }
    if before.compactMode != after.compactMode { current.compactMode = after.compactMode }
    if before.chatContextMessageLimit != after.chatContextMessageLimit {
        current.chatContextMessageLimit = after.chatContextMessageLimit
    }
    if before.activeConversationId != after.activeConversationId {
        current.activeConversationId = after.activeConversationId
    }
    if before.dismissedDangerWarnings != after.dismissedDangerWarnings {
        current.dismissedDangerWarnings = after.dismissedDangerWarnings
    }
    if before.dismissedFeatureHints != after.dismissedFeatureHints {
        current.dismissedFeatureHints = after.dismissedFeatureHints
    }
}

private func encodedValuesEqual<Value: Encodable>(_ lhs: Value, _ rhs: Value) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let lhsData = try? encoder.encode(lhs),
          let rhsData = try? encoder.encode(rhs) else {
        return false
    }
    return lhsData == rhsData
}
