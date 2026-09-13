import SwiftUI
import Foundation
import AVFoundation
import ZeroChatCore

private let STREAMING_UI_FRAME_MS: Int64 = 16
private let MAX_GENERATION_AUTO_RETRIES = 3
private let MAX_CHAT_AUTO_RETRIES = MAX_GENERATION_AUTO_RETRIES
private let CHAT_AUTO_RETRY_DELAYS_NS: [UInt64] = [
    400_000_000,
    900_000_000,
    1_600_000_000
]

private func chatAutoRetryDelayNanoseconds(_ retryIndex: Int) -> UInt64 {
    if CHAT_AUTO_RETRY_DELAYS_NS.indices.contains(retryIndex) {
        return CHAT_AUTO_RETRY_DELAYS_NS[retryIndex]
    }

    return CHAT_AUTO_RETRY_DELAYS_NS[CHAT_AUTO_RETRY_DELAYS_NS.count - 1]
}

private func isRetryableChatGenerationError(_ error: Error, receivedText: String) -> Bool {
    if !receivedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || error is CancellationError {
        return false
    }

    if let aiError = error as? AiError,
       case .chatResponseEmpty = aiError {
        return true
    }

    if let aiError = error as? AiError,
       case let .httpFailed(statusCode, _) = aiError {
        return [408, 409, 425, 429, 500, 502, 503, 504].contains(statusCode)
    }

    if let urlError = error as? URLError {
        switch urlError.code {
        case .timedOut,
             .cannotFindHost,
             .cannotConnectToHost,
             .networkConnectionLost,
             .notConnectedToInternet,
             .dnsLookupFailed:
            return true
        default:
            break
        }
    }

    let nsError = error as NSError
    let message = "\(error.localizedDescription) \(nsError.localizedFailureReason ?? "")".lowercased()
    if message.contains("timeout") || message.contains("timed out") {
        return true
    }

    return [
        "network",
        "connection reset",
        "connection refused",
        "failed to connect",
        "temporarily unavailable",
        "temporary failure",
        "socket",
        "unavailable",
        "too many requests",
        "rate limit"
    ].contains(where: message.contains)
}

private func networkRetryingNotice(_ i18n: NativeI18n, attempt: Int, total: Int) -> String {
    i18n.t("notice.networkRetrying")
        .replacingOccurrences(of: "{attempt}", with: "\(attempt)")
        .replacingOccurrences(of: "{total}", with: "\(total)")
}

private enum AppleSpeechPlaybackError: LocalizedError {
    case emptyAudio
    case failedToStart

    var errorDescription: String? {
        switch self {
        case .emptyAudio:
            return "Audio response was empty."
        case .failedToStart:
            return "Audio playback could not start."
        }
    }
}

private final class AppleSpeechPlaybackDelegate: NSObject, AVAudioPlayerDelegate {
    private let onFinish: () -> Void
    private let onError: (Error?) -> Void

    init(onFinish: @escaping () -> Void, onError: @escaping (Error?) -> Void) {
        self.onFinish = onFinish
        self.onError = onError
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if flag {
            onFinish()
        } else {
            onError(nil)
        }
    }

    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        onError(error)
    }
}

enum AppleLocalSnapshotIssue: Equatable {
    case snapshotLoadFailed
    case storageUnavailable

    var noticeKey: String {
        switch self {
        case .snapshotLoadFailed:
            return "message.localSnapshotLoadFailed"
        case .storageUnavailable:
            return "message.localStorageUnavailable"
        }
    }
}

enum AppleSecretReadState: Equatable {
    case missing
    case value(String)
    case failure(String)
}

private enum AppleSnapshotLoadState: Equatable {
    case loading
    case ready
    case failed
}

private enum AppleLocalDataTransitionRecoveryError: LocalizedError {
    case missingPassphrase
    case sourceChanged

    var errorDescription: String? {
        switch self {
        case .missingPassphrase:
            return "The local data recovery password is unavailable."
        case .sourceChanged:
            return "Local data changed while a recovery operation was pending."
        }
    }
}

private enum AppleBootstrapSnapshotChange {
    case merge(AppSnapshotMutation)
    case replace(AppSnapshot)

    func apply(to snapshot: AppSnapshot) -> AppSnapshot {
        switch self {
        case .merge(let mutation):
            return mutation.applying(to: snapshot)
        case .replace(let replacement):
            return replacement
        }
    }
}

private struct ApplePendingBootstrapChange {
    var change: AppleBootstrapSnapshotChange
    var shouldAutoSync: Bool
}

private struct AppleSyncCandidate {
    var snapshot: AppSnapshot
    var providerKeys: [String: String]
}

private enum AppleSyncAcceptanceResult {
    case accepted(AppSnapshot)
    case stale
    case failed
}

private func preferredFirstSyncStrategy(
    current: FirstSyncStrategy,
    requested: FirstSyncStrategy
) -> FirstSyncStrategy {
    switch requested {
    case .ask:
        return current
    case .useLocal, .useRemote, .merge:
        return requested
    }
}

@MainActor
final class ZeroChatViewModel: ObservableObject {
    @Published var snapshot: AppSnapshot
    @Published var input = ""
    @Published var composerMode = ComposerMode.chat
    @Published var imageTaskMode = ImageTaskMode.generate
    @Published var editingMessageId: String?
    @Published var notice: AppNotice?
    @Published var settingsNotice: AppNotice?
    @Published var sourceImageName: String?
    @Published var maskImageName: String?
    @Published var isChatStreaming = false
    @Published var speakingMessageId: String?
    @Published private(set) var localSnapshotIssue: AppleLocalSnapshotIssue? = nil
    @Published private(set) var recoveringLocalSnapshot = false
    @Published private(set) var localSnapshotSaveError: String? = nil

    private let ai = AiClient()
    private let sync = SyncClient()
    private let crypto = CryptoEngine()
    private let keychain = KeychainStore()
    private var store: SnapshotStore?
    private var snapshotLoadState = AppleSnapshotLoadState.loading
    private var pendingBootstrapChanges: [ApplePendingBootstrapChange] = []
    private var pendingSnapshotSave: AppSnapshot?
    private var pendingSnapshotSaveRevision: UInt64?
    private var snapshotSaveTask: Task<Void, Never>?
    private var snapshotSaveAutoSyncRequested = false
    private var snapshotSaveAutoSyncStrategy = FirstSyncStrategy.ask
    private var lastPersistedSnapshot: AppSnapshot?
    private var sourceImage: ImageUpload?
    private var maskImage: ImageUpload?
    private var pendingAutoSync: PendingAutoSync?
    private var pendingAutoSyncRevision: UInt64?
    private var autoSyncTask: Task<Void, Never>?
    private var clearCloudDataTask: Task<Void, Never>?
    private var chatStreamingTask: Task<Void, Never>?
    private var imageGenerationTask: Task<Void, Never>?
    private var speechTask: Task<Void, Never>?
    private var speechPlayer: AVAudioPlayer?
    private var speechPlayerDelegate: AppleSpeechPlaybackDelegate?
    private var generationSerial = 0
    private var cloudClearSerial = 0
    private var speechRequestSerial = 0
    private var lastStreamingCommitAt: Int64 = 0
    private var lastSyncNotificationAt: Int64 = 0
    private var snapshotRevision: UInt64 = 0
    private var dataReplacementEpoch: UInt64 = 0
    private var activeGeneration: ActiveGeneration?

    private enum GenerationKind {
        case chat
        case image
    }

    private struct ActiveGeneration {
        let token: Int
        let kind: GenerationKind
        let conversationId: String
        let assistantId: String
        let assistant: ChatMessage
    }

    var hasSourceImageUpload: Bool {
        sourceImage != nil
    }

    var hasMaskImageUpload: Bool {
        maskImage != nil
    }

    var hasSavedSyncPassphrase: Bool {
        guard case .value(let passphrase) = keychainSecretReadState("sync-passphrase") else {
            return false
        }
        return !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var hasSavedCloudflareAccessKey: Bool {
        guard case .value(let passphrase) = keychainSecretReadState("sync-passphrase") else {
            return false
        }
        return !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var hasSavedGitHubToken: Bool {
        guard case .value(let token) = keychainSecretReadState("github-token") else {
            return false
        }
        return !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var localSnapshotNotice: AppNotice? {
        if let localSnapshotIssue {
            return AppNotice(message: i18n.t(localSnapshotIssue.noticeKey), kind: .error)
        }
        if let localSnapshotSaveError {
            return AppNotice(message: localSnapshotSaveError, kind: .error)
        }
        return nil
    }

    init() {
        let initial = Self.defaultSnapshot()
        snapshot = initial
        Task {
            await load()
        }
    }

    private func prepareImageRequest(in conversation: Conversation) -> PreparedImageRequest? {
        let provider = snapshot.providers.first { $0.id == conversation.providerId && $0.enabled }
        let preflight = applePrepareImageRequest(
            isGenerating: isChatStreaming,
            provider: provider,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            imageModel: provider.map(imageModelForProvider) ?? "",
            responsesModel: conversation.model,
            input: input,
            imageTaskMode: imageTaskMode,
            sourceImage: sourceImage,
            maskImage: maskImage,
            i18n: i18n
        )
        switch preflight {
        case .ready(let request):
            return request
        case .blocked(let blockedNotice):
            notice = blockedNotice
            return nil
        }
    }

    func load() async {
        let loadedStore: SnapshotStore
        do {
            loadedStore = try SnapshotStore()
            store = loadedStore
        } catch {
            snapshotLoadState = .failed
            pendingBootstrapChanges.removeAll()
            reportLocalSnapshotIssue(.storageUnavailable, error: error)
            return
        }

        do {
            recoveringLocalSnapshot = true
            defer { recoveringLocalSnapshot = false }
            _ = try await recoverPendingLocalDataTransition(using: loadedStore)
            let previousConversationIds = Set(snapshot.conversations.map(\.id))
            let savedSnapshot = try await loadedStore.load()
            let loaded = savedSnapshot.map { $0.providers.isEmpty ? Self.defaultSnapshot() : $0 }
                ?? Self.defaultSnapshot()
            let normalized = normalizeOfficialProviderContracts(loaded)
            var restored = normalized.snapshot
            var shouldSave = normalized.changed
            var shouldAutoSync = normalized.changed

            for pending in pendingBootstrapChanges {
                restored = pending.change.apply(to: restored)
                shouldSave = true
                shouldAutoSync = shouldAutoSync || pending.shouldAutoSync
            }

            pendingBootstrapChanges.removeAll()
            snapshotLoadState = .ready
            localSnapshotIssue = nil
            localSnapshotSaveError = nil
            notice = nil
            snapshot = restored
            snapshotRevision &+= 1
            lastPersistedSnapshot = savedSnapshot
            updateSpotlightIndex(previousIds: previousConversationIds, snapshot: restored)

            if shouldSave {
                enqueueSnapshotSave(restored, autoSync: shouldAutoSync)
            }
        } catch {
            snapshotLoadState = .failed
            pendingBootstrapChanges.removeAll()
            reportLocalSnapshotIssue(.snapshotLoadFailed, error: error)
        }
    }

    private func localDataSnapshotStore() throws -> SnapshotStore {
        if let store {
            return store
        }
        let created = try SnapshotStore()
        store = created
        return created
    }

    private func localDataTransitionSourceFingerprint(
        using store: SnapshotStore
    ) async throws -> String? {
        guard localSnapshotIssue == nil else {
            return nil
        }
        return try snapshotFingerprint(try await store.load())
    }

    private func stageLocalDataTransition(
        _ transition: LocalDataTransition,
        transitionPassphrase: String? = nil,
        using store: SnapshotStore
    ) async throws {
        if let transitionPassphrase {
            try keychain.setLocalDataTransitionPassphrase(
                transitionPassphrase,
                transitionId: transition.id
            )
        }

        do {
            try await store.stageLocalDataTransition(transition)
        } catch let operationError {
            guard transitionPassphrase != nil else {
                throw operationError
            }
            do {
                try keychain.clearLocalDataTransitionPassphrase(transitionId: transition.id)
            } catch let compensationError {
                throw AppleCompensationError(
                    operationError: operationError,
                    compensationErrors: [compensationError]
                )
            }
            throw operationError
        }
    }

    @discardableResult
    private func recoverPendingLocalDataTransition(
        using store: SnapshotStore
    ) async throws -> AppSnapshot? {
        guard let transition = try await store.loadLocalDataTransition() else {
            try keychain.clearAllLocalDataTransitionPassphrases()
            return nil
        }

        let target: AppSnapshot
        var recoveredProviderKeys: [String: String] = [:]
        switch transition.kind {
        case .reset:
            guard let targetSnapshot = transition.targetSnapshot else {
                throw LocalDataTransitionError.invalidRecord
            }
            target = targetSnapshot
        case .encryptedBackupImport:
            guard let encryptedBackup = transition.encryptedBackup,
                  let targetUpdatedAt = transition.targetUpdatedAt,
                  let passphrase = try keychain.localDataTransitionPassphrase(
                      transitionId: transition.id
                  ),
                  !passphrase.isEmpty else {
                throw AppleLocalDataTransitionRecoveryError.missingPassphrase
            }
            let imported = try await appleImportedBackup(
                data: encryptedBackup,
                passphrase: passphrase,
                crypto: crypto,
                now: targetUpdatedAt
            )
            target = imported.snapshot
            recoveredProviderKeys = imported.providerKeys
        case .syncCommit:
            guard let encryptedBackup = transition.encryptedBackup,
                  let targetUpdatedAt = transition.targetUpdatedAt,
                  let passphrase = try keychain.localDataTransitionPassphrase(
                      transitionId: transition.id
                  ),
                  !passphrase.isEmpty else {
                throw AppleLocalDataTransitionRecoveryError.missingPassphrase
            }
            let envelope = try JSONDecoder().decode(EncryptedSnapshotEnvelope.self, from: encryptedBackup)
            let targetVault = try await crypto.decryptVault(envelope, passphrase: passphrase)
            guard targetVault.data.version == 1,
                  targetVault.data.updatedAt == targetUpdatedAt else {
                throw LocalDataTransitionError.invalidRecord
            }
            target = targetVault.data
            recoveredProviderKeys = targetVault.secrets.providerKeys
            guard recoveredProviderKeys.keys.sorted() == transition.providerIds else {
                throw LocalDataTransitionError.invalidRecord
            }
        }

        let current: AppSnapshot?
        do {
            current = try await store.load()
        } catch {
            guard transition.sourceSnapshotFingerprint == nil else {
                throw error
            }
            current = nil
        }
        if let sourceFingerprint = transition.sourceSnapshotFingerprint {
            let currentFingerprint = try snapshotFingerprint(current)
            let targetFingerprint = try snapshotFingerprint(target)
            guard currentFingerprint == sourceFingerprint || currentFingerprint == targetFingerprint else {
                throw AppleLocalDataTransitionRecoveryError.sourceChanged
            }
        }

        switch transition.kind {
        case .reset:
            try clearSecrets()
        case .encryptedBackupImport, .syncCommit:
            let requiredProviderIds = Set(
                target.providers.map(\.id) + Self.defaultSnapshot().providers.map(\.id)
            )
            guard requiredProviderIds.isSubset(of: Set(transition.providerIds)) else {
                throw LocalDataTransitionError.invalidRecord
            }
            try appleApplyProviderKeyValues(
                providerIds: transition.providerIds,
                values: recoveredProviderKeys,
                providerKey: { providerId in
                    try self.keychain.get(account: "provider:\(providerId)") ?? ""
                },
                setProviderKey: { providerId, value in
                    try self.keychain.set(value, account: "provider:\(providerId)")
                }
            )
        }

        let interruptAutoSync = transition.kind != .syncCommit
        try await recoverLocalSnapshot(target, interruptAutoSync: interruptAutoSync)
        try await store.completeLocalDataTransition()
        try keychain.clearLocalDataTransitionPassphrase(transitionId: transition.id)
        return target
    }

    private func reportLocalSnapshotIssue(_ issue: AppleLocalSnapshotIssue, error: Error) {
        localSnapshotIssue = issue
        notice = AppNotice(
            message: "\(i18n.t("message.localDataLoadFailedPrefix")): \(i18n.errorMessage(error))",
            kind: .error
        )
    }

    private func recoverLocalSnapshot(
        _ recovered: AppSnapshot,
        interruptAutoSync: Bool
    ) async throws {
        let recoveryStore: SnapshotStore
        if let store {
            recoveryStore = store
        } else {
            recoveryStore = try SnapshotStore()
            self.store = recoveryStore
        }

        pendingSnapshotSave = nil
        pendingSnapshotSaveRevision = nil
        snapshotSaveAutoSyncRequested = false
        snapshotSaveAutoSyncStrategy = .ask
        if interruptAutoSync {
            pendingAutoSync = nil
            pendingAutoSyncRevision = nil
            autoSyncTask?.cancel()
        }
        do {
            try await recoveryStore.save(recovered)
        } catch {
            reportSnapshotSaveFailure(error)
            throw error
        }
        let previousConversationIds = Set(snapshot.conversations.map(\.id))
        snapshot = recovered
        snapshotRevision &+= 1
        snapshotLoadState = .ready
        pendingBootstrapChanges.removeAll()
        pendingSnapshotSave = nil
        pendingSnapshotSaveRevision = nil
        snapshotSaveAutoSyncRequested = false
        lastPersistedSnapshot = recovered
        localSnapshotIssue = nil
        localSnapshotSaveError = nil
        notice = nil
        updateSpotlightIndex(previousIds: previousConversationIds, snapshot: recovered)
    }

    private func beginLocalSnapshotRecovery(expectedEpoch: UInt64? = nil) throws {
        guard !recoveringLocalSnapshot, snapshotLoadState != .loading else {
            throw AppError.message(i18n.t("message.localDataOperationInProgress"))
        }
        if let expectedEpoch, expectedEpoch != dataReplacementEpoch {
            throw AppError.message(i18n.t("message.localDataOperationInProgress"))
        }
        dataReplacementEpoch &+= 1
        recoveringLocalSnapshot = true
    }

    private func quiesceSnapshotPersistenceForRecovery() async {
        while let saveTask = snapshotSaveTask {
            await saveTask.value
        }
        pendingSnapshotSave = nil
        pendingSnapshotSaveRevision = nil
        snapshotSaveAutoSyncRequested = false
        snapshotSaveAutoSyncStrategy = .ask
    }

    func commit(
        _ next: AppSnapshot,
        autoSync: Bool = true,
        replaceDuringLoad: Bool = false
    ) {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return
        }

        let previousConversationIds = Set(snapshot.conversations.map(\.id))
        let previous = snapshot
        var updated = appleResetSyncCompletionWhenTargetChanges(previous: previous, next: next)
        updated.updatedAt = nowMillis()
        let nextMonotonicTimestamp = previous.updatedAt == Int64.max
            ? Int64.max
            : previous.updatedAt + 1
        updated.updatedAt = max(updated.updatedAt, nextMonotonicTimestamp)
        snapshotRevision &+= 1
        snapshot = updated
        updateSpotlightIndex(previousIds: previousConversationIds, snapshot: updated)

        if snapshotLoadState == .loading {
            let change: AppleBootstrapSnapshotChange = replaceDuringLoad
                ? .replace(updated)
                : .merge(AppSnapshotMutation(before: previous, after: updated))
            pendingBootstrapChanges.append(
                ApplePendingBootstrapChange(change: change, shouldAutoSync: autoSync)
            )
            return
        }

        guard snapshotLoadState == .ready else {
            return
        }
        enqueueSnapshotSave(updated, autoSync: autoSync)
    }

    private func enqueueSnapshotSave(
        _ candidate: AppSnapshot,
        revision: UInt64? = nil,
        autoSync: Bool,
        firstSyncStrategy: FirstSyncStrategy = .ask
    ) {
        guard snapshotLoadState == .ready, localSnapshotIssue == nil, store != nil else {
            return
        }

        pendingSnapshotSave = candidate
        pendingSnapshotSaveRevision = revision ?? snapshotRevision
        if autoSync {
            snapshotSaveAutoSyncRequested = true
            snapshotSaveAutoSyncStrategy = preferredFirstSyncStrategy(
                current: snapshotSaveAutoSyncStrategy,
                requested: firstSyncStrategy
            )
        }
        guard snapshotSaveTask == nil else {
            return
        }

        snapshotSaveTask = Task { [weak self] in
            await self?.drainSnapshotSaveQueue()
        }
    }

    private func drainSnapshotSaveQueue() async {
        while let candidate = pendingSnapshotSave, !Task.isCancelled {
            let candidateRevision = pendingSnapshotSaveRevision ?? snapshotRevision
            pendingSnapshotSave = nil
            pendingSnapshotSaveRevision = nil
            do {
                guard let store else {
                    throw CocoaError(.fileNoSuchFile)
                }
                try await store.save(candidate)
                lastPersistedSnapshot = candidate
                localSnapshotSaveError = nil
            } catch {
                if pendingSnapshotSave == nil {
                    pendingSnapshotSave = candidate
                    pendingSnapshotSaveRevision = candidateRevision
                }
                reportSnapshotSaveFailure(error)
                break
            }

            if pendingSnapshotSave == nil, snapshotSaveAutoSyncRequested {
                snapshotSaveAutoSyncRequested = false
                let strategy = snapshotSaveAutoSyncStrategy
                snapshotSaveAutoSyncStrategy = .ask
                if candidateRevision == snapshotRevision {
                    scheduleAutoSync(candidate, firstSyncStrategy: strategy)
                } else {
                    scheduleAutoSync(snapshot, firstSyncStrategy: strategy)
                }
            }
        }

        snapshotSaveTask = nil
        if pendingSnapshotSave != nil, localSnapshotSaveError == nil {
            enqueueSnapshotSave(snapshot, autoSync: false)
        }
    }

    private func reportSnapshotSaveFailure(_ error: Error) {
        let message = "\(i18n.t("message.localDataSaveFailedPrefix")): \(i18n.errorMessage(error))"
        pendingAutoSync = nil
        pendingAutoSyncRevision = nil
        autoSyncTask?.cancel()
        localSnapshotSaveError = message
        notice = AppNotice(message: message, kind: .error)
        settingsNotice = AppNotice(message: message, kind: .error)
    }

    func retryLocalSnapshotSave() {
        guard let candidate = pendingSnapshotSave else {
            return
        }
        let revision = pendingSnapshotSaveRevision ?? snapshotRevision
        localSnapshotSaveError = nil
        enqueueSnapshotSave(
            candidate,
            revision: revision,
            autoSync: snapshotSaveAutoSyncRequested,
            firstSyncStrategy: snapshotSaveAutoSyncStrategy
        )
    }

    @discardableResult
    func sendCurrentInput() -> String? {
        sendCurrentInput(conversationId: nil)
    }

    @discardableResult
    func sendCurrentInput(conversationId: String?) -> String? {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return nil
        }
        guard let conversation = self.conversation(id: conversationId) ?? createConversationForSend() else {
            return nil
        }

        if composerMode == .image {
            sendImagePrompt(in: conversation)
        } else {
            sendChat(in: conversation)
        }
        return conversation.id
    }

    func stopGenerating() {
        invalidateGeneration()
    }

    private func beginGeneration() -> Int {
        generationSerial &+= 1
        isChatStreaming = true
        return generationSerial
    }

    private func invalidateGeneration() {
        chatStreamingTask?.cancel()
        imageGenerationTask?.cancel()

        if let activeGeneration {
            switch activeGeneration.kind {
            case .chat:
                let partial = streamingAssistantContent(
                    conversationId: activeGeneration.conversationId,
                    assistantId: activeGeneration.assistantId
                )
                completeAssistantIfCurrent(
                    generationToken: activeGeneration.token,
                    conversationId: activeGeneration.conversationId,
                    assistantId: activeGeneration.assistantId,
                    message: appleStoppedAssistantMessage(
                        assistant: activeGeneration.assistant,
                        partialContent: partial,
                        stoppedContent: i18n.t("message.generationStopped")
                    )
                )
            case .image:
                completeAssistantIfCurrent(
                    generationToken: activeGeneration.token,
                    conversationId: activeGeneration.conversationId,
                    assistantId: activeGeneration.assistantId,
                    message: appleStoppedImageMessage(
                        assistant: activeGeneration.assistant,
                        stoppedContent: i18n.t("message.generationStopped")
                    )
                )
            }
        }

        generationSerial &+= 1
        activeGeneration = nil
        chatStreamingTask = nil
        imageGenerationTask = nil
        isChatStreaming = false
    }

    private func generationIsCurrent(_ generationToken: Int) -> Bool {
        generationSerial == generationToken
    }

    private func finishGenerationIfCurrent(generationToken: Int, kind: GenerationKind) {
        guard generationIsCurrent(generationToken) else { return }

        switch kind {
        case .chat:
            chatStreamingTask = nil
        case .image:
            imageGenerationTask = nil
        }
        activeGeneration = nil
        isChatStreaming = false
    }

    func stopSpeaking(showNotice: Bool = true) {
        speechRequestSerial += 1
        let wasSpeaking = speakingMessageId != nil
        speechTask?.cancel()
        speechTask = nil
        speechPlayer?.stop()
        speechPlayer?.delegate = nil
        speechPlayer = nil
        speechPlayerDelegate = nil
        speakingMessageId = nil

        if showNotice && wasSpeaking {
            notice = AppNotice(message: i18n.t("notice.audioSpeechStopped"), kind: .warning)
        }
    }

    func speakMessage(_ message: ChatMessage, conversationId: String? = nil) {
        if speakingMessageId == message.id {
            stopSpeaking()
            return
        }

        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return
        }

        guard let conversation = self.conversation(id: conversationId) else {
            notice = AppNotice(message: i18n.t("message.noEnabledProvider"), kind: .warning)
            return
        }

        let provider = snapshot.providers.first { $0.id == conversation.providerId && $0.enabled }
        let model = provider.map(modelForProviderAudioSpeech) ?? ""
        let preflight = applePrepareMessageSpeechRequest(
            provider: provider,
            model: model,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            message: message,
            i18n: i18n
        )

        let request: PreparedMessageSpeechRequest
        switch preflight {
        case .ready(let readyRequest):
            request = readyRequest
        case .blocked(let blockedNotice):
            notice = blockedNotice
            return
        }

        let requestProvider = providerRequest(request.provider)
        let apiKey = providerKey(request.provider.id)
        let proxyToken = providerProxyToken(for: requestProvider)

        stopSpeaking(showNotice: false)
        speechRequestSerial += 1
        let serial = speechRequestSerial
        speakingMessageId = message.id
        notice = AppNotice(
            message: i18n.t("notice.audioSpeechPlaying").replacingOccurrences(of: "{model}", with: request.model),
            kind: .success
        )

        speechTask = Task { [weak self] in
            guard let self else { return }
            do {
                let data = try await ai.createSpeech(
                    provider: requestProvider,
                    apiKey: apiKey,
                    proxyToken: proxyToken,
                    model: request.model,
                    input: request.input,
                    responseFormat: "mp3"
                )
                try startSpeechPlayback(data: data, serial: serial)
            } catch is CancellationError {
                finishSpeechPlayback(serial: serial)
            } catch {
                failSpeechPlayback(error, serial: serial)
            }
        }
    }

    private func startSpeechPlayback(data: Data, serial: Int) throws {
        guard serial == speechRequestSerial else { return }
        guard !data.isEmpty else { throw AppleSpeechPlaybackError.emptyAudio }

        let player = try AVAudioPlayer(data: data)
        let delegate = AppleSpeechPlaybackDelegate(
            onFinish: { [weak self] in
                Task { @MainActor in
                    self?.finishSpeechPlayback(serial: serial)
                }
            },
            onError: { [weak self] error in
                Task { @MainActor in
                    self?.failSpeechPlayback(error ?? AppleSpeechPlaybackError.failedToStart, serial: serial)
                }
            }
        )
        player.delegate = delegate
        player.prepareToPlay()
        guard player.play() else {
            throw AppleSpeechPlaybackError.failedToStart
        }

        speechPlayer = player
        speechPlayerDelegate = delegate
        speechTask = nil
    }

    private func finishSpeechPlayback(serial: Int) {
        guard serial == speechRequestSerial else { return }
        speechPlayer?.delegate = nil
        speechPlayer = nil
        speechPlayerDelegate = nil
        speechTask = nil
        speakingMessageId = nil
    }

    private func failSpeechPlayback(_ error: Error, serial: Int) {
        guard serial == speechRequestSerial else { return }
        speechPlayer?.stop()
        speechPlayer?.delegate = nil
        speechPlayer = nil
        speechPlayerDelegate = nil
        speechTask = nil
        speakingMessageId = nil
        notice = AppNotice(
            message: i18n.t("notice.audioSpeechFailed")
                .replacingOccurrences(of: "{message}", with: i18n.errorMessage(error)),
            kind: .error
        )
    }

    func regenerate(from assistantId: String, conversationId: String? = nil) {
        guard let conversation = self.conversation(id: conversationId),
              let draft = appleRegenerateDraft(conversation: conversation, assistantId: assistantId) else {
            notice = AppNotice(message: i18n.t("message.noRegenerate"), kind: .warning)
            return
        }
        if speakingMessageId == assistantId {
            stopSpeaking(showNotice: false)
        }
        input = draft.input
        editingMessageId = draft.editingMessageId
        sendChat(in: conversation)
    }

    func setImageUpload(result: Result<URL, Error>, target: ImageUploadTarget) {
        do {
            let url = try result.get()
            let didAccess = url.startAccessingSecurityScopedResource()
            defer {
                if didAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let data = try readBoundedLocalFileData(
                at: url,
                maxBytes: maxImageFileBytes
            )
            let upload = ImageUpload(data: data, fileName: url.lastPathComponent, mimeType: mimeType(for: url))
            if target == .source {
                sourceImage = upload
                sourceImageName = upload.fileName
            } else {
                maskImage = upload
                maskImageName = upload.fileName
            }
        } catch {
            notice = AppNotice(
                message: "\(i18n.t("message.imageReadFailedPrefix")): \(i18n.errorMessage(error))",
                kind: .error
            )
        }
    }

    func clearSourceImage() {
        sourceImage = nil
        sourceImageName = nil
    }

    func clearMaskImage() {
        maskImage = nil
        maskImageName = nil
    }

    func providerKey(_ providerId: String) -> String {
        secret("provider:\(providerId)")
    }

    @discardableResult
    func setProviderKey(_ providerId: String, _ value: String) -> Bool {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return false
        }

        do {
            try keychain.set(value, account: "provider:\(providerId)")
            recordProviderSecretChangeForAutoSync(providerId)
            return true
        } catch {
            reportKeychainWriteFailure(error)
            return false
        }
    }

    func deleteProviderTransaction(_ providerId: String) async {
        guard localSnapshotIssue == nil,
              snapshotLoadState == .ready,
              !recoveringLocalSnapshot else {
            return
        }

        while let saveTask = snapshotSaveTask {
            await saveTask.value
        }
        guard localSnapshotSaveError == nil,
              pendingSnapshotSave == nil else {
            if let localSnapshotSaveError {
                settingsNotice = AppNotice(message: localSnapshotSaveError, kind: .error)
            }
            return
        }
        guard let store else {
            reportProviderDeletionFailure(AppError.message("Local storage is unavailable."))
            return
        }

        let source = snapshot
        let sourceRevision = snapshotRevision
        guard let candidate = appleProviderDeletionCandidate(
            snapshot: source,
            providerId: providerId,
            now: nowMillis()
        ) else {
            settingsNotice = AppNotice(message: i18n.t("notice.providerMinimum"), kind: .warning)
            return
        }

        let account = "provider:\(providerId)"
        let previousKey: String
        do {
            previousKey = try keychain.get(account: account) ?? ""
            try keychain.set("", account: account)
        } catch {
            reportKeychainWriteFailure(error)
            return
        }

        let result: SnapshotCompareAndSaveResult
        do {
            result = try await store.saveIfUnchanged(expected: source, snapshot: candidate)
        } catch {
            let transactionError = compensateProviderDeletionKey(
                providerId: providerId,
                previousKey: previousKey,
                operationError: error
            )
            if transactionError is AppleCompensationError {
                reportKeychainWriteFailure(transactionError)
            } else {
                reportProviderDeletionFailure(transactionError)
            }
            return
        }

        guard case .saved = result else {
            let transactionError = compensateProviderDeletionKey(
                providerId: providerId,
                previousKey: previousKey,
                operationError: SyncError.remoteUpdated
            )
            if transactionError is AppleCompensationError {
                reportKeychainWriteFailure(transactionError)
            } else {
                settingsNotice = AppNotice(
                    message: i18n.errorMessage(SyncError.remoteUpdated),
                    kind: .warning
                )
            }
            return
        }

        guard snapshotRevision == sourceRevision else {
            await compensateStaleProviderDeletion(
                providerId: providerId,
                previousKey: previousKey,
                operationError: SyncError.remoteUpdated,
                store: store
            )
            return
        }

        let previousConversationIds = Set(snapshot.conversations.map(\.id))
        snapshot = candidate
        snapshotRevision &+= 1
        lastPersistedSnapshot = candidate
        localSnapshotSaveError = nil
        updateSpotlightIndex(previousIds: previousConversationIds, snapshot: candidate)
        scheduleAutoSync(candidate, sourceRevision: snapshotRevision)
        settingsNotice = AppNotice(message: i18n.t("notice.providerDeleted"), kind: .warning)
    }

    private func compensateProviderDeletionKey(
        providerId: String,
        previousKey: String,
        operationError: Error
    ) -> Error {
        guard snapshot.providers.contains(where: { $0.id == providerId }) else {
            return operationError
        }

        do {
            let account = "provider:\(providerId)"
            let currentKey = try keychain.get(account: account) ?? ""
            guard currentKey.isEmpty else {
                return operationError
            }
            try keychain.set(previousKey, account: account)
            return operationError
        } catch {
            return AppleCompensationError(
                operationError: operationError,
                compensationErrors: providerDeletionCompensationErrors(from: error)
            )
        }
    }

    private func providerDeletionCompensationErrors(from error: Error) -> [Error] {
        guard let compensation = error as? AppleCompensationError else {
            return [error]
        }
        return [compensation.operationError] + compensation.compensationErrors
    }

    private func reportProviderDeletionFailure(_ error: Error) {
        let message = "\(i18n.t("message.localDataSaveFailedPrefix")): \(i18n.errorMessage(error))"
        notice = AppNotice(message: message, kind: .error)
        settingsNotice = AppNotice(message: message, kind: .error)
    }

    private func compensateStaleProviderDeletion(
        providerId: String,
        previousKey: String,
        operationError: Error,
        store: SnapshotStore
    ) async {
        let latest = snapshot
        let latestRevision = snapshotRevision
        var compensationErrors: [Error] = []
        do {
            try await store.save(latest)
            if snapshotRevision == latestRevision {
                lastPersistedSnapshot = latest
                localSnapshotSaveError = nil
            } else {
                enqueueSnapshotSave(snapshot, revision: snapshotRevision, autoSync: false)
            }
        } catch {
            compensationErrors.append(error)
        }

        let keyCompensation = compensateProviderDeletionKey(
            providerId: providerId,
            previousKey: previousKey,
            operationError: operationError
        )
        if let keyError = keyCompensation as? AppleCompensationError {
            compensationErrors.append(contentsOf: keyError.compensationErrors)
        }

        guard compensationErrors.isEmpty else {
            let transactionError = AppleCompensationError(
                operationError: operationError,
                compensationErrors: compensationErrors
            )
            reportSnapshotSaveFailure(transactionError)
            return
        }
        settingsNotice = AppNotice(
            message: i18n.errorMessage(operationError),
            kind: .warning
        )
    }

    func cloudflareAccessKey() -> String {
        do {
            return try keychain.cloudflareAccessKey()
        } catch {
            return ""
        }
    }

    func secret(_ account: String) -> String {
        switch keychainSecretReadState(account) {
        case .missing, .failure:
            return ""
        case .value(let value):
            return value
        }
    }

    func secretReadState(_ account: String) -> AppleSecretReadState {
        let state = keychainSecretReadState(account)
        if case .failure(let message) = state {
            reportKeychainReadFailure(message)
        }
        return state
    }

    @discardableResult
    func setSecret(_ account: String, _ value: String) -> Bool {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return false
        }

        do {
            try keychain.set(value, account: account)
            recordSecretChangeForAutoSync()
            return true
        } catch {
            reportKeychainWriteFailure(error)
            return false
        }
    }

    func clearSecrets() throws {
        try keychain.clearAll()
    }

    private func reportKeychainWriteFailure(_ error: Error) {
        let message = "\(i18n.t("message.keychainWriteFailedPrefix")): \(i18n.errorMessage(error))"
        notice = AppNotice(message: message, kind: .error)
        settingsNotice = AppNotice(message: message, kind: .error)
    }

    private func keychainSecretReadState(_ account: String) -> AppleSecretReadState {
        do {
            guard let value = try keychain.get(account: account) else {
                return .missing
            }
            return .value(value)
        } catch {
            let message = "\(i18n.t("message.keychainReadFailedPrefix")): \(i18n.errorMessage(error))"
            return .failure(message)
        }
    }

    private func reportKeychainReadFailure(_ message: String) {
        notice = AppNotice(message: message, kind: .error)
        settingsNotice = AppNotice(message: message, kind: .error)
    }

    func exportEncryptedBackup(passphrase: String) async throws -> Data {
        try await appleEncryptedBackupData(
            snapshot: snapshot,
            passphrase: passphrase,
            crypto: crypto,
            providerKey: { providerId in
                try keychain.get(account: "provider:\(providerId)") ?? ""
            }
        )
    }

    func importEncryptedBackup(_ data: Data, passphrase: String) async throws {
        let observedReplacementEpoch = dataReplacementEpoch
        let imported = try await appleImportedBackup(
            data: data,
            passphrase: passphrase,
            crypto: crypto,
            now: nowMillis()
        )
        try beginLocalSnapshotRecovery(expectedEpoch: observedReplacementEpoch)
        defer { recoveringLocalSnapshot = false }
        await quiesceSnapshotPersistenceForRecovery()
        let previousSnapshot = snapshot
        let localStore = try localDataSnapshotStore()
        let providerIds = Set(
            previousSnapshot.providers.map(\.id) +
                imported.snapshot.providers.map(\.id) +
                Self.defaultSnapshot().providers.map(\.id)
        ).sorted()
        let transition = LocalDataTransition(
            kind: .encryptedBackupImport,
            sourceSnapshotFingerprint: try await localDataTransitionSourceFingerprint(using: localStore),
            targetUpdatedAt: imported.snapshot.updatedAt,
            encryptedBackup: data,
            providerIds: providerIds
        )
        try await stageLocalDataTransition(
            transition,
            transitionPassphrase: passphrase,
            using: localStore
        )
        do {
            _ = try await recoverPendingLocalDataTransition(using: localStore)
        } catch {
            snapshotLoadState = .failed
            reportLocalSnapshotIssue(.snapshotLoadFailed, error: error)
            throw error
        }
        requestAutoSync()
    }

    func resetLocalData() async throws {
        try beginLocalSnapshotRecovery()
        defer { recoveringLocalSnapshot = false }
        await quiesceSnapshotPersistenceForRecovery()
        let replacement = Self.defaultSnapshot()
        let localStore = try localDataSnapshotStore()
        if localSnapshotIssue != nil {
            try await localStore.discardLocalDataTransition()
            try keychain.clearAllLocalDataTransitionPassphrases()
        }
        let transition = LocalDataTransition(
            kind: .reset,
            sourceSnapshotFingerprint: try await localDataTransitionSourceFingerprint(using: localStore),
            targetSnapshot: replacement
        )
        try await stageLocalDataTransition(transition, using: localStore)
        do {
            _ = try await recoverPendingLocalDataTransition(using: localStore)
        } catch {
            snapshotLoadState = .failed
            reportLocalSnapshotIssue(.snapshotLoadFailed, error: error)
            throw error
        }
    }

    func requestAutoSync(firstSyncStrategy: FirstSyncStrategy = .ask) {
        if let localSnapshotNotice {
            settingsNotice = localSnapshotNotice
            return
        }
        enqueueSnapshotSave(snapshot, autoSync: true, firstSyncStrategy: firstSyncStrategy)
    }

    private func runManualCloudSync(_ setNotice: (AppNotice) -> Void) async {
        if let reason = manualSyncBlockedMessage() {
            setNotice(AppNotice(message: reason, kind: .warning))
            return
        }
        let source = snapshot
        let sourceRevision = snapshotRevision
        guard await persistSyncSource(source, sourceRevision: sourceRevision) else {
            if localSnapshotSaveError == nil {
                setNotice(AppNotice(message: i18n.errorMessage(SyncError.remoteUpdated), kind: .warning))
            }
            return
        }
        guard let candidate = await syncIfConfigured(source, requiresAutoSync: false) else {
            setNotice(AppNotice(message: i18n.t("sync.requirement.local"), kind: .warning))
            return
        }

        let acceptance = await applySyncedSnapshot(
            candidate,
            source: source,
            sourceRevision: sourceRevision
        )
        let synced: AppSnapshot
        switch acceptance {
        case .accepted(let accepted):
            synced = accepted
        case .stale:
            setNotice(AppNotice(message: i18n.errorMessage(SyncError.remoteUpdated), kind: .warning))
            return
        case .failed:
            return
        }
        let status = synced.sync.lastSyncStatus ?? "Sync complete"
        let ok = status == "Sync complete" || status == "Remote data restored" || status == "Remote encrypted data applied"
        setNotice(AppNotice(message: i18n.syncStatusMessage(status), kind: ok ? .success : .warning))
        notifySyncCompleteIfNeeded(synced, force: true)
    }

    private func persistSyncSource(
        _ source: AppSnapshot,
        sourceRevision: UInt64
    ) async -> Bool {
        guard !appleIsStaleSyncResult(
            current: snapshot,
            source: source,
            currentRevision: snapshotRevision,
            sourceRevision: sourceRevision
        ) else {
            return false
        }

        do {
            guard let store else {
                throw CocoaError(.fileNoSuchFile)
            }
            try await store.save(source)
            guard !appleIsStaleSyncResult(
                current: snapshot,
                source: source,
                currentRevision: snapshotRevision,
                sourceRevision: sourceRevision
            ) else {
                enqueueSnapshotSave(snapshot, revision: snapshotRevision, autoSync: false)
                return false
            }
            lastPersistedSnapshot = source
            localSnapshotSaveError = nil
            return true
        } catch {
            reportSnapshotSaveFailure(error)
            return false
        }
    }

    func pullToRefreshSync() async {
        await runManualCloudSync { notice = $0 }
    }

    func syncNowFromSettings() async {
        await runManualCloudSync { settingsNotice = $0 }
    }

    func clearCloudData() {
        pendingAutoSync = nil
        pendingAutoSyncRevision = nil
        autoSyncTask?.cancel()
        clearCloudDataTask?.cancel()
        cloudClearSerial += 1
        let clearSerial = cloudClearSerial

        if snapshot.sync.mode == "gist" {
            let token = secret("github-token")
            guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                settingsNotice = AppNotice(message: i18n.t("error.syncGithubTokenRequired"), kind: .warning)
                return
            }

            let gistId = snapshot.sync.gistId
            let gistFile = snapshot.sync.gistFile
            let passphrase = secret("sync-passphrase")
            clearCloudDataTask = Task {
                defer {
                    if cloudClearSerial == clearSerial {
                        clearCloudDataTask = nil
                    }
                }
                do {
                    try await sync.clearGist(
                        gistId: gistId,
                        gistFile: gistFile,
                        token: token,
                        passphrase: passphrase
                    )
                    try Task.checkCancellation()
                    guard cloudClearSerial == clearSerial else { return }
                    settingsNotice = AppNotice(message: i18n.t("message.cloudSyncCleared"), kind: .success)
                } catch is CancellationError {
                    return
                } catch {
                    guard cloudClearSerial == clearSerial else { return }
                    let detail = i18n.errorMessage(error)
                    let prefix = i18n.t("message.cloudClearFailedPrefix")
                    settingsNotice = AppNotice(
                        message: detail.hasPrefix(prefix) ? detail : "\(prefix): \(detail)",
                        kind: .error
                    )
                }
            }
            return
        }

        guard snapshot.sync.mode == "cloudflare" else {
            settingsNotice = AppNotice(message: i18n.t("message.chooseCloudflareSync"), kind: .warning)
            return
        }
        guard let endpoint = snapshot.sync.workerEndpoint, !endpoint.isEmpty else {
            settingsNotice = AppNotice(message: i18n.t("message.cloudflareWorkerRequired"), kind: .warning)
            return
        }
        let token = cloudflareAccessKey()
        guard !token.isEmpty else {
            settingsNotice = AppNotice(message: i18n.t("message.dataPasswordRequired"), kind: .warning)
            return
        }

        clearCloudDataTask = Task {
            defer {
                if cloudClearSerial == clearSerial {
                    clearCloudDataTask = nil
                }
            }
            do {
                try await sync.clearCloudflare(workerEndpoint: endpoint, token: token)
                try Task.checkCancellation()
                guard cloudClearSerial == clearSerial else { return }
                settingsNotice = AppNotice(message: i18n.t("message.cloudSyncCleared"), kind: .success)
            } catch is CancellationError {
                return
            } catch {
                guard cloudClearSerial == clearSerial else { return }
                let detail = i18n.errorMessage(error)
                let prefix = i18n.t("message.cloudClearFailedPrefix")
                settingsNotice = AppNotice(
                    message: detail.hasPrefix(prefix) ? detail : "\(prefix): \(detail)",
                    kind: .error
                )
            }
        }
    }

    private func sendChat(in conversation: Conversation) {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return
        }
        let provider = snapshot.providers.first { $0.id == conversation.providerId && $0.enabled }
        let model = provider.map { chatModelForConversation(conversation, provider: $0) } ?? ""
        let preflight = applePrepareChatRequest(
            isChatStreaming: isChatStreaming,
            provider: provider,
            model: model,
            providerKeyMissing: provider.map(providerKeyMissing) ?? false,
            input: input,
            editingMessageId: editingMessageId,
            messages: conversation.messages,
            newUserMessageId: UUID().uuidString,
            now: nowMillis(),
            i18n: i18n
        )
        let request: PreparedChatRequest
        switch preflight {
        case .ready(let readyRequest):
            request = readyRequest
        case .blocked(let blockedNotice):
            notice = blockedNotice
            return
        }

        let requestProvider = providerRequest(request.provider)
        let apiKey = providerKey(request.provider.id)
        let proxyToken = providerProxyToken(for: requestProvider)
        let contextMessageLimit = snapshot.preferences.chatContextMessageLimit ?? 24

        let assistant = appleStreamingAssistantMessage(
            id: UUID().uuidString,
            content: "",
            createdAt: nowMillis()
        )
        let pendingConversation = applePendingChatConversation(
            conversation: conversation,
            request: request,
            assistant: assistant,
            title: title(from: request.baseMessages, fallbackTitle: i18n.t("title.newChat")),
            now: nowMillis()
        )
        replaceConversation(pendingConversation, autoSync: false)
        input = ""
        editingMessageId = nil
        lastStreamingCommitAt = 0
        let generationToken = beginGeneration()
        activeGeneration = ActiveGeneration(
            token: generationToken,
            kind: .chat,
            conversationId: conversation.id,
            assistantId: assistant.id,
            assistant: assistant
        )

        chatStreamingTask = Task {
            defer {
                finishGenerationIfCurrent(generationToken: generationToken, kind: .chat)
            }
            var retryIndex = 0
            do {
                while true {
                    guard generationIsCurrent(generationToken) else { return }
                    do {
                        let text = try await ai.stream(
                            provider: requestProvider,
                            apiKey: apiKey,
                            model: request.model,
                            messages: request.baseMessages,
                            contextMessageLimit: contextMessageLimit,
                            proxyToken: proxyToken
                        ) { [weak self] partial in
                            await self?.updateStreamingAssistant(
                                generationToken: generationToken,
                                conversationId: conversation.id,
                                assistantId: assistant.id,
                                content: partial
                            )
                        }
                        try Task.checkCancellation()
                        guard generationIsCurrent(generationToken) else { return }
                        var completed = assistant
                        completed.content = text
                        completed.status = "done"
                        completed.error = nil
                        completeAssistantIfCurrent(
                            generationToken: generationToken,
                            conversationId: conversation.id,
                            assistantId: assistant.id,
                            message: completed
                        )
                        return
                    } catch {
                        guard generationIsCurrent(generationToken) else { return }
                        if error is CancellationError {
                            throw error
                        }
                        let partial = streamingAssistantContent(
                            conversationId: conversation.id,
                            assistantId: assistant.id
                        )
                        if retryIndex < MAX_CHAT_AUTO_RETRIES &&
                            isRetryableChatGenerationError(error, receivedText: partial) {
                            retryIndex += 1
                            notice = AppNotice(
                                message: networkRetryingNotice(
                                    i18n,
                                    attempt: retryIndex,
                                    total: MAX_CHAT_AUTO_RETRIES
                                ),
                                kind: .warning
                            )
                            try await Task.sleep(nanoseconds: chatAutoRetryDelayNanoseconds(retryIndex - 1))
                            guard generationIsCurrent(generationToken) else { return }
                            continue
                        }
                        throw error
                    }
                }
            } catch is CancellationError {
                guard generationIsCurrent(generationToken) else { return }
                let partial = streamingAssistantContent(conversationId: conversation.id, assistantId: assistant.id)
                let stopped = appleStoppedAssistantMessage(
                    assistant: assistant,
                    partialContent: partial,
                    stoppedContent: i18n.t("message.generationStopped")
                )
                completeAssistantIfCurrent(
                    generationToken: generationToken,
                    conversationId: conversation.id,
                    assistantId: assistant.id,
                    message: stopped
                )
            } catch {
                guard generationIsCurrent(generationToken) else { return }
                var failed = assistant
                failed.content = i18n.t("message.generationFailed")
                failed.status = "error"
                failed.error = i18n.errorMessage(error)
                completeAssistantIfCurrent(
                    generationToken: generationToken,
                    conversationId: conversation.id,
                    assistantId: assistant.id,
                    message: failed
                )
            }
        }
    }

    private func sendImagePrompt(in conversation: Conversation) {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return
        }
        guard let request = prepareImageRequest(in: conversation) else {
            return
        }

        let requestProvider = providerRequest(request.provider)
        let apiKey = providerKey(request.provider.id)
        let proxyToken = providerProxyToken(for: requestProvider)

        let assistant = appleStreamingAssistantMessage(
            id: UUID().uuidString,
            content: i18n.t("message.generatingImage"),
            createdAt: nowMillis()
        )
        let pendingConversation = applePendingImageConversation(
            conversation: conversation,
            assistant: assistant,
            now: nowMillis()
        )
        replaceConversation(pendingConversation)
        input = ""
        let generationToken = beginGeneration()
        activeGeneration = ActiveGeneration(
            token: generationToken,
            kind: .image,
            conversationId: conversation.id,
            assistantId: assistant.id,
            assistant: assistant
        )

        imageGenerationTask = Task {
            defer {
                finishGenerationIfCurrent(generationToken: generationToken, kind: .image)
            }
            do {
                let image: GeneratedImage
                switch request.kind {
                case .generate:
                    image = try await ai.generateImage(
                        provider: requestProvider,
                        apiKey: apiKey,
                        proxyToken: proxyToken,
                        model: request.imageModel,
                        responsesModel: request.responsesModel,
                        prompt: request.prompt
                    )
                case .edit(let source):
                    image = try await ai.editImage(
                        provider: requestProvider,
                        apiKey: apiKey,
                        proxyToken: proxyToken,
                        model: request.imageModel,
                        responsesModel: request.responsesModel,
                        prompt: request.prompt,
                        image: source
                    )
                case .inpaint(let source, let mask):
                    image = try await ai.editImage(
                        provider: requestProvider,
                        apiKey: apiKey,
                        proxyToken: proxyToken,
                        model: request.imageModel,
                        responsesModel: request.responsesModel,
                        prompt: request.prompt,
                        image: source,
                        mask: mask
                    )
                }
                try Task.checkCancellation()
                guard generationIsCurrent(generationToken) else { return }

                let completed = appleCompletedGeneratedImageMessage(
                    assistant: assistant,
                    image: image,
                    request: request,
                    attachmentId: UUID().uuidString,
                    now: nowMillis()
                )
                completeAssistantIfCurrent(
                    generationToken: generationToken,
                    conversationId: conversation.id,
                    assistantId: assistant.id,
                    message: completed
                )
            } catch is CancellationError {
                guard generationIsCurrent(generationToken) else { return }
                let stopped = appleStoppedImageMessage(
                    assistant: assistant,
                    stoppedContent: i18n.t("message.generationStopped")
                )
                completeAssistantIfCurrent(
                    generationToken: generationToken,
                    conversationId: conversation.id,
                    assistantId: assistant.id,
                    message: stopped
                )
            } catch {
                guard generationIsCurrent(generationToken) else { return }
                let failed = appleFailedImageMessage(
                    assistant: assistant,
                    content: i18n.t("message.imageRequestFailed"),
                    error: i18n.errorMessage(error)
                )
                completeAssistantIfCurrent(
                    generationToken: generationToken,
                    conversationId: conversation.id,
                    assistantId: assistant.id,
                    message: failed
                )
            }
        }
    }

    private func updateStreamingAssistant(
        generationToken: Int,
        conversationId: String,
        assistantId: String,
        content: String,
        force: Bool = false
    ) {
        guard generationIsCurrent(generationToken) else { return }
        let now = nowMillis()
        if !force, now - lastStreamingCommitAt < STREAMING_UI_FRAME_MS {
            return
        }
        lastStreamingCommitAt = now

        guard let conversation = appleUpdatedStreamingAssistantConversation(
            snapshot: snapshot,
            conversationId: conversationId,
            assistantId: assistantId,
            content: content,
            now: now
        ) else {
            return
        }

        replaceConversation(conversation, autoSync: false)
    }

    private func streamingAssistantContent(conversationId: String, assistantId: String) -> String {
        appleStreamingAssistantContent(
            snapshot: snapshot,
            conversationId: conversationId,
            assistantId: assistantId
        )
    }

    private func completeAssistantIfCurrent(
        generationToken: Int,
        conversationId: String,
        assistantId: String,
        message: ChatMessage
    ) {
        guard generationIsCurrent(generationToken) else { return }
        guard let conversation = appleCompletedAssistantConversation(
            snapshot: snapshot,
            conversationId: conversationId,
            assistantId: assistantId,
            message: message,
            now: nowMillis()
        ) else {
            return
        }

        replaceConversation(conversation)
    }

    private func recordSecretChangeForAutoSync() {
        var updated = snapshot
        updated.updatedAt = nowMillis()
        commit(updated)
    }

    private func recordProviderSecretChangeForAutoSync(_ providerId: String) {
        var updated = snapshot
        let timestamp = nowMillis()
        updated.providers = updated.providers.map { provider in
            guard provider.id == providerId else { return provider }
            var copy = provider
            copy.updatedAt = timestamp
            return copy
        }
        updated.updatedAt = timestamp
        commit(updated)
    }

    private func scheduleAutoSync(
        _ snapshot: AppSnapshot,
        sourceRevision: UInt64? = nil,
        firstSyncStrategy: FirstSyncStrategy = .ask
    ) {
        guard localSnapshotIssue == nil, !recoveringLocalSnapshot else {
            return
        }
        guard localSnapshotSaveError == nil else {
            return
        }
        pendingAutoSync = PendingAutoSync(snapshot: snapshot, firstSyncStrategy: firstSyncStrategy)
        pendingAutoSyncRevision = sourceRevision ?? snapshotRevision
        guard autoSyncTask == nil else {
            return
        }

        autoSyncTask = Task { [weak self] in
            await self?.drainAutoSyncQueue()
        }
    }

    private func drainAutoSyncQueue() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .milliseconds(700))
            } catch {
                break
            }

            guard !Task.isCancelled else {
                break
            }

            guard let next = pendingAutoSync else {
                break
            }

            let nextRevision = pendingAutoSyncRevision ?? snapshotRevision
            pendingAutoSync = nil
            pendingAutoSyncRevision = nil
            if nextRevision != snapshotRevision ||
                appleIsStaleAutoSyncResult(current: snapshot, source: next.snapshot) {
                if pendingAutoSync == nil, snapshot.sync.autoSync {
                    pendingAutoSync = PendingAutoSync(snapshot: snapshot, firstSyncStrategy: .ask)
                    pendingAutoSyncRevision = snapshotRevision
                }
                continue
            }
            let candidate = await syncIfConfigured(
                next.snapshot,
                firstSyncStrategy: next.firstSyncStrategy
            )
            guard !Task.isCancelled else {
                break
            }
            if let candidate {
                if nextRevision != snapshotRevision ||
                    appleIsStaleAutoSyncResult(current: snapshot, source: next.snapshot) {
                    if pendingAutoSync == nil, snapshot.sync.autoSync {
                        pendingAutoSync = PendingAutoSync(snapshot: snapshot, firstSyncStrategy: .ask)
                        pendingAutoSyncRevision = snapshotRevision
                    }
                } else {
                    switch await applySyncedSnapshot(
                        candidate,
                        source: next.snapshot,
                        sourceRevision: nextRevision
                    ) {
                    case .accepted(let synced):
                        notifySyncCompleteIfNeeded(synced)
                    case .stale:
                        if pendingAutoSync == nil, snapshot.sync.autoSync {
                            pendingAutoSync = PendingAutoSync(snapshot: snapshot, firstSyncStrategy: .ask)
                            pendingAutoSyncRevision = snapshotRevision
                        }
                    case .failed:
                        break
                    }
                }
            }
        }

        autoSyncTask = nil
        if let pending = pendingAutoSync {
            let revision = pendingAutoSyncRevision ?? snapshotRevision
            scheduleAutoSync(
                pending.snapshot,
                sourceRevision: revision,
                firstSyncStrategy: pending.firstSyncStrategy
            )
        }
    }

    private func syncIfConfigured(
        _ local: AppSnapshot,
        firstSyncStrategy: FirstSyncStrategy = .ask,
        requiresAutoSync: Bool = true
    ) async -> AppleSyncCandidate? {
        guard ["gist", "cloudflare"].contains(local.sync.mode),
              !requiresAutoSync || local.sync.autoSync else {
            return nil
        }

        var providerKeys: [String: String] = [:]
        do {
            providerKeys = try appleProviderKeys(for: local) { providerId in
                try keychain.get(account: "provider:\(providerId)") ?? ""
            }
            let passphrase = try keychain.get(account: "sync-passphrase") ?? ""
            guard !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return AppleSyncCandidate(
                    snapshot: local.withSyncStatus(
                        "Cloud sync is waiting for the data encryption password.",
                        completed: false
                    ),
                    providerKeys: providerKeys
                )
            }

            let secrets = ProviderSecrets(providerKeys: providerKeys)
            let synced = local.withSyncStatus("Sync complete", completed: true)
            let vault = SyncVault(data: synced, secrets: secrets)
            let syncedVault: SyncVault
            switch local.sync.mode {
            case "gist":
                let token = try keychain.get(account: "github-token") ?? ""
                guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    return AppleSyncCandidate(
                        snapshot: missingGitHubTokenSnapshot(local),
                        providerKeys: providerKeys
                    )
                }
                syncedVault = try await sync.syncGistVault(
                    vault: vault,
                    passphrase: passphrase,
                    gistId: local.sync.gistId,
                    gistFile: local.sync.gistFile,
                    token: token,
                    firstSyncStrategy: firstSyncStrategy,
                    hasCompletedSync: appleHasCompletedSyncForCurrentTarget(local),
                    hasLocalUserContent: appleHasLocalUserContent(local)
                )
            case "cloudflare":
                guard let endpoint = local.sync.workerEndpoint?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !endpoint.isEmpty else {
                    return nil
                }
                let token = try keychain.cloudflareAccessKey()
                guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    return AppleSyncCandidate(
                        snapshot: local.withSyncStatus(
                            "Cloud sync is waiting for the data encryption password.",
                            completed: false
                        ),
                        providerKeys: providerKeys
                    )
                }
                syncedVault = try await sync.syncCloudflareVault(
                    vault: vault,
                    passphrase: passphrase,
                    workerEndpoint: endpoint,
                    token: token,
                    firstSyncStrategy: firstSyncStrategy,
                    hasCompletedSync: appleHasCompletedSyncForCurrentTarget(local),
                    hasLocalUserContent: appleHasLocalUserContent(local)
                )
            default:
                return nil
            }
            return AppleSyncCandidate(
                snapshot: syncedVault.data.withSyncStatus(
                    syncedVault.data.sync.lastSyncStatus ?? "Sync complete",
                    completed: true
                ),
                providerKeys: syncedVault.secrets.providerKeys
            )
        } catch {
            return AppleSyncCandidate(
                snapshot: local.withSyncStatus(i18n.errorMessage(error), completed: false),
                providerKeys: providerKeys
            )
        }
    }

    private func missingGitHubTokenSnapshot(_ local: AppSnapshot) -> AppSnapshot {
        return local.withSyncStatus("GitHub token is required.", completed: false)
    }

    private func applySyncedSnapshot(
        _ candidate: AppleSyncCandidate,
        source: AppSnapshot,
        sourceRevision: UInt64
    ) async -> AppleSyncAcceptanceResult {
        guard !appleIsStaleSyncResult(
            current: snapshot,
            source: source,
            currentRevision: snapshotRevision,
            sourceRevision: sourceRevision
        ) else {
            return .stale
        }

        let syncStatus = candidate.snapshot.sync.lastSyncStatus ?? ""
        if appleIsCompletedSyncStatus(syncStatus) {
            return await applyCompletedSyncedSnapshot(
                candidate,
                source: source,
                sourceRevision: sourceRevision
            )
        }

        let accepted = appleMergedSyncResult(
            current: snapshot,
            source: source,
            synced: candidate.snapshot
        )
        return await applyOrdinarySyncedSnapshot(
            accepted,
            source: source,
            sourceRevision: sourceRevision
        )
    }

    private func applyCompletedSyncedSnapshot(
        _ candidate: AppleSyncCandidate,
        source: AppSnapshot,
        sourceRevision: UInt64
    ) async -> AppleSyncAcceptanceResult {
        do {
            try beginLocalSnapshotRecovery()
        } catch {
            return .failed
        }
        defer { recoveringLocalSnapshot = false }

        await quiesceSnapshotPersistenceForRecovery()
        guard !appleIsStaleSyncResult(
            current: snapshot,
            source: source,
            currentRevision: snapshotRevision,
            sourceRevision: sourceRevision
        ) else {
            return .stale
        }

        do {
            guard let store else {
                throw CocoaError(.fileNoSuchFile)
            }
            let persisted = try await store.load()
            let persistedFingerprint = try snapshotFingerprint(persisted)
            let sourceFingerprint = try snapshotFingerprint(source)
            guard persistedFingerprint == sourceFingerprint else {
                return .stale
            }

            let accepted = appleMergedSyncResult(
                current: snapshot,
                source: source,
                synced: candidate.snapshot
            )
            let providerIds = Set(
                source.providers.map(\.id) +
                    accepted.providers.map(\.id) +
                    Self.defaultSnapshot().providers.map(\.id)
            ).sorted()
            var targetProviderKeys: [String: String] = [:]
            for providerId in providerIds {
                targetProviderKeys[providerId] = candidate.providerKeys[providerId] ?? ""
            }
            let targetVault = SyncVault(
                data: accepted,
                secrets: ProviderSecrets(providerKeys: targetProviderKeys)
            )
            let transitionPassphrase = try await crypto.makeRandomPassphrase()
            let encryptedTargetEnvelope = try await crypto.encryptVault(
                targetVault,
                passphrase: transitionPassphrase
            )
            let transitionEncoder = JSONEncoder()
            transitionEncoder.outputFormatting = [.sortedKeys]
            let encryptedTargetVault = try transitionEncoder.encode(encryptedTargetEnvelope)
            let transition = LocalDataTransition(
                kind: .syncCommit,
                sourceSnapshotFingerprint: persistedFingerprint,
                targetUpdatedAt: accepted.updatedAt,
                encryptedBackup: encryptedTargetVault,
                providerIds: providerIds
            )
            try await stageLocalDataTransition(
                transition,
                transitionPassphrase: transitionPassphrase,
                using: store
            )
            guard let recovered = try await recoverPendingLocalDataTransition(using: store) else {
                throw LocalDataTransitionError.invalidRecord
            }
            let recoveredFingerprint = try snapshotFingerprint(recovered)
            let acceptedFingerprint = try snapshotFingerprint(accepted)
            guard recoveredFingerprint == acceptedFingerprint else {
                throw LocalDataTransitionError.invalidRecord
            }
            return .accepted(recovered)
        } catch {
            snapshotLoadState = .failed
            reportLocalSnapshotIssue(.snapshotLoadFailed, error: error)
            return .failed
        }
    }

    private func applyOrdinarySyncedSnapshot(
        _ accepted: AppSnapshot,
        source: AppSnapshot,
        sourceRevision: UInt64
    ) async -> AppleSyncAcceptanceResult {
        let previousConversationIds = Set(snapshot.conversations.map(\.id))
        do {
            guard let store else {
                throw CocoaError(.fileNoSuchFile)
            }
            try await store.save(accepted)
        } catch {
            reportSnapshotSaveFailure(error)
            return .failed
        }

        guard !appleIsStaleSyncResult(
            current: snapshot,
            source: source,
            currentRevision: snapshotRevision,
            sourceRevision: sourceRevision
        ) else {
            do {
                guard let store else {
                    throw CocoaError(.fileNoSuchFile)
                }
                let latest = snapshot
                let latestRevision = snapshotRevision
                try await store.save(latest)
                if snapshotRevision == latestRevision {
                    lastPersistedSnapshot = latest
                    localSnapshotSaveError = nil
                } else {
                    enqueueSnapshotSave(snapshot, revision: snapshotRevision, autoSync: false)
                }
            } catch {
                reportSnapshotSaveFailure(error)
            }
            return .stale
        }

        snapshot = accepted
        snapshotRevision &+= 1
        lastPersistedSnapshot = accepted
        localSnapshotSaveError = nil
        updateSpotlightIndex(previousIds: previousConversationIds, snapshot: accepted)
        return .accepted(accepted)
    }

    private func notifySyncCompleteIfNeeded(_ synced: AppSnapshot, force: Bool = false) {
        let status = synced.sync.lastSyncStatus?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard appleIsCompletedSyncStatus(status) else {
            return
        }

        let now = nowMillis()
        guard force || now - lastSyncNotificationAt >= 30_000 else {
            return
        }

        lastSyncNotificationAt = now
#if canImport(UserNotifications)
        AppleSyncNotificationCenter.notifySyncComplete(
            title: i18n.t("sync.status.complete"),
            body: i18n.syncStatusMessage(status)
        )
#endif
    }

}

