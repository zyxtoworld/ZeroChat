import Foundation
import ZeroChatCore

func appleManualSyncBlockedMessage(
    snapshot: AppSnapshot,
    isChatStreaming: Bool,
    hasSyncPassphrase: Bool,
    hasCloudflareAccessKey: Bool,
    hasGitHubToken: Bool,
    i18n: NativeI18n
) -> String? {
    if isChatStreaming {
        return i18n.t("message.generating")
    }

    switch snapshot.sync.mode {
    case "gist":
        if !hasSyncPassphrase {
            return i18n.t("message.dataPasswordRequired")
        }
        if !hasGitHubToken {
            return i18n.t("error.syncGithubTokenRequired")
        }
    case "cloudflare":
        if snapshot.sync.workerEndpoint?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
            return i18n.t("message.cloudflareWorkerRequired")
        }
        if !hasSyncPassphrase || !hasCloudflareAccessKey {
            return i18n.t("message.dataPasswordRequired")
        }
    default:
        return i18n.t("sync.requirement.local")
    }

    return nil
}

func appleShouldShowCloudSyncStatus(snapshot: AppSnapshot) -> Bool {
    snapshot.sync.mode != "local"
}

func appleShouldShowFirstSyncConflict(snapshot: AppSnapshot, i18n: NativeI18n) -> Bool {
    appleShouldShowCloudSyncStatus(snapshot: snapshot) && snapshot.sync.isFirstSyncConflict(i18n)
}

func appleSyncTargetIdentity(_ sync: SyncConfig) -> String {
    switch sync.mode {
    case "gist":
        let gistId = sync.gistId?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let rawGistFile = sync.gistFile?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let gistFile = rawGistFile.isEmpty ? "zerochat-sync.json" : rawGistFile
        return "gist:\(gistId):\(gistFile)"
    case "cloudflare":
        let rawEndpoint = sync.workerEndpoint?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard var components = URLComponents(string: rawEndpoint) else {
            return "cloudflare:\(rawEndpoint)"
        }
        guard components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil else {
            return "cloudflare:invalid:\(rawEndpoint)"
        }
        components.scheme = components.scheme?.lowercased()
        components.host = components.host?.lowercased()
        if (components.scheme == "https" && components.port == 443) ||
            (components.scheme == "http" && components.port == 80) {
            components.port = nil
        }
        while components.path.count > 1 && components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        if components.path == "/" {
            components.path = ""
        }
        return "cloudflare:\(components.string ?? rawEndpoint)"
    default:
        return "local"
    }
}

func appleResetSyncCompletionWhenTargetChanges(
    previous: AppSnapshot,
    next: AppSnapshot
) -> AppSnapshot {
    guard appleSyncTargetIdentity(previous.sync) != appleSyncTargetIdentity(next.sync) else {
        return next
    }

    var reset = next
    reset.sync.lastSyncAt = nil
    reset.sync.lastSyncStatus = nil
    return reset
}

func appleHasCompletedSyncForCurrentTarget(_ snapshot: AppSnapshot) -> Bool {
    appleSyncTargetIdentity(snapshot.sync) != "local" && snapshot.sync.lastSyncAt != nil
}

func appleCloudSyncSummary(snapshot: AppSnapshot, i18n: NativeI18n) -> String {
    if snapshot.sync.mode == "local" {
        return i18n.t("sync.localSummary")
    }

    let modeLabel: String
    switch snapshot.sync.mode {
    case "gist":
        modeLabel = i18n.t("mode.gist")
    case "cloudflare":
        modeLabel = i18n.t("mode.cloudflare")
    default:
        modeLabel = i18n.t("mode.local")
    }

    let status = snapshot.sync.lastSyncStatus
        .map { i18n.syncStatusMessage($0) }
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }

    if let status {
        return "\(modeLabel) · \(status)"
    }
    if let lastSyncAt = snapshot.sync.lastSyncAt {
        let time = Date(milliseconds: lastSyncAt).formatted(date: .numeric, time: .shortened)
        return "\(modeLabel) · \(time)"
    }
    return "\(modeLabel) · \(i18n.t("button.syncNow"))"
}

func appleIsStaleAutoSyncResult(current: AppSnapshot, source: AppSnapshot) -> Bool {
    current.sync.mode != source.sync.mode ||
        current.sync.autoSync != source.sync.autoSync ||
        current.sync.gistId != source.sync.gistId ||
        current.sync.gistFile != source.sync.gistFile ||
        current.sync.workerEndpoint != source.sync.workerEndpoint ||
        (current.updatedAt > source.updatedAt &&
            appleHasMeaningfulLocalChanges(source: source, current: current))
}

func appleIsStaleSyncResult(
    current: AppSnapshot,
    source: AppSnapshot,
    currentRevision: UInt64,
    sourceRevision: UInt64
) -> Bool {
    currentRevision != sourceRevision ||
        appleIsStaleAutoSyncResult(current: current, source: source)
}

func appleHasMeaningfulLocalChanges(source: AppSnapshot, current: AppSnapshot) -> Bool {
    var alignedSource = source
    alignedSource.updatedAt = current.updatedAt
    alignedSource.sync.encryptionEnabled = current.sync.encryptionEnabled
    alignedSource.sync.lastSyncAt = current.sync.lastSyncAt
    alignedSource.sync.lastSyncStatus = current.sync.lastSyncStatus

    let encoder = JSONEncoder()
    guard let alignedData = try? encoder.encode(alignedSource),
          let currentData = try? encoder.encode(current) else {
        return true
    }

    return alignedData != currentData
}

func appleMergedSyncResult(
    current: AppSnapshot,
    source: AppSnapshot,
    synced: AppSnapshot
) -> AppSnapshot {
    guard synced.updatedAt == source.updatedAt else {
        return synced
    }

    var accepted = current
    accepted.sync.encryptionEnabled = synced.sync.encryptionEnabled
    accepted.sync.lastSyncAt = synced.sync.lastSyncAt
    accepted.sync.lastSyncStatus = synced.sync.lastSyncStatus
    return accepted
}

func appleIsCompletedSyncStatus(_ status: String) -> Bool {
    status == "Sync complete" ||
        status == "Remote data restored" ||
        status == "Remote encrypted data applied"
}

func appleHasLocalUserContent(_ snapshot: AppSnapshot) -> Bool {
    let defaultSkillSettings = SkillSettings()
    let settings = snapshot.skillSettings ?? defaultSkillSettings

    return snapshot.conversations.contains { !$0.messages.isEmpty } ||
        appleHasUserProviderContent(snapshot) ||
        !(snapshot.skills ?? []).isEmpty ||
        settings.autoMatch != defaultSkillSettings.autoMatch ||
        settings.contextBudget != defaultSkillSettings.contextBudget ||
        settings.maxAutoSkills != defaultSkillSettings.maxAutoSkills ||
        snapshot.preferences.theme != "system" ||
        snapshot.preferences.language != "system" ||
        snapshot.preferences.compactMode
}

private func appleHasUserProviderContent(_ snapshot: AppSnapshot) -> Bool {
    snapshot.providers.contains { provider in
        provider.updatedAt != provider.createdAt ||
            ((provider.custom ?? false) && provider.enabled && !provider.id.hasPrefix("custom-"))
    }
}
