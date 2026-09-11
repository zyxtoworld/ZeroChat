import Foundation
import Testing
@testable import ZeroChatCore

@Test func failedSnapshotSaveLeavesMostRecentPersistedSnapshotReadable() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-snapshot-store-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = SnapshotStore(
        fileURL: directory.appendingPathComponent("snapshot.v1.json"),
        maxBytes: 2_048
    )
    let persisted = AppSnapshot(
        preferences: Preferences(language: "zh-CN"),
        updatedAt: 1
    )
    try await store.save(persisted)

    let oversized = AppSnapshot(
        preferences: Preferences(language: String(repeating: "x", count: 4_096)),
        updatedAt: 2
    )
    var saveFailed = false
    do {
        try await store.save(oversized)
    } catch LocalFileReadError.tooLarge(let maxBytes) {
        saveFailed = true
        #expect(maxBytes == 2_048)
    }
    #expect(saveFailed)

    let loaded = try await store.load()
    let restored = try #require(loaded)
    #expect(restored.preferences.language == "zh-CN")
    #expect(restored.updatedAt == 1)
}

@Test func compareAndSaveRejectsStaleSnapshotAndPreservesCurrentData() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-snapshot-cas-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = SnapshotStore(fileURL: directory.appendingPathComponent("snapshot.v1.json"))
    let observed = AppSnapshot(preferences: Preferences(language: "en"), updatedAt: 1)
    let current = AppSnapshot(preferences: Preferences(language: "zh-CN"), updatedAt: 2)
    let candidate = AppSnapshot(preferences: Preferences(language: "fr"), updatedAt: 3)
    try await store.save(observed)
    try await store.save(current)

    let result = try await store.saveIfUnchanged(expected: observed, snapshot: candidate)
    guard case .changed(let changed) = result else {
        Issue.record("A stale compare-and-save must be rejected.")
        return
    }
    #expect(changed?.preferences.language == "zh-CN")
    #expect(changed?.updatedAt == 2)

    let loaded = try await store.load()
    let restored = try #require(loaded)
    #expect(restored.preferences.language == "zh-CN")
    #expect(restored.updatedAt == 2)
}

@Test func localDataTransitionJournalRoundTripsAndRejectsOverlap() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-transition-store-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = SnapshotStore(fileURL: directory.appendingPathComponent("snapshot.v1.json"))
    let target = AppSnapshot(preferences: Preferences(language: "fr"), updatedAt: 7)
    let transition = LocalDataTransition(
        kind: .reset,
        sourceSnapshotFingerprint: try snapshotFingerprint(nil),
        targetSnapshot: target
    )

    try await store.stageLocalDataTransition(transition)
    let pending = try await store.loadLocalDataTransition()
    let loaded = try #require(pending)
    #expect(loaded.id == transition.id)
    #expect(loaded.kind == .reset)
    #expect(loaded.targetSnapshot?.preferences.language == "fr")

    await #expect(throws: LocalDataTransitionError.alreadyPending) {
        try await store.stageLocalDataTransition(transition)
    }

    try await store.discardLocalDataTransition()
    #expect(try await store.loadLocalDataTransition() == nil)

    try await store.stageLocalDataTransition(transition)
    try await store.completeLocalDataTransition()
    #expect(try await store.loadLocalDataTransition() == nil)
}

@Test func localDataTransitionJournalRejectsMalformedRecordsBeforePersistence() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-transition-invalid-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = SnapshotStore(fileURL: directory.appendingPathComponent("snapshot.v1.json"))
    var transition = LocalDataTransition(
        kind: .encryptedBackupImport,
        sourceSnapshotFingerprint: try snapshotFingerprint(nil),
        targetUpdatedAt: 9,
        encryptedBackup: Data("encrypted".utf8),
        providerIds: ["b", "a"]
    )
    transition.id = "not-a-uuid"

    await #expect(throws: LocalDataTransitionError.invalidRecord) {
        try await store.stageLocalDataTransition(transition)
    }
    #expect(try await store.loadLocalDataTransition() == nil)
}

@Test func snapshotFingerprintIsCanonicalAndDistinguishesMissingData() throws {
    let first = AppSnapshot(preferences: Preferences(language: "en"), updatedAt: 11)
    var second = first
    second.updatedAt = 12

    #expect(try snapshotFingerprint(first) == snapshotFingerprint(first))
    #expect(try snapshotFingerprint(first) != snapshotFingerprint(second))
    #expect(try snapshotFingerprint(first) != snapshotFingerprint(nil))
}

@Test func snapshotStoreRejectsDuplicateRecordIdentifiersOnLoad() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-snapshot-invalid-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let fileURL = directory.appendingPathComponent("snapshot.v1.json")
    let provider = ProviderConfig(
        id: "duplicate",
        name: "Duplicate",
        kind: .openAICompatible,
        baseUrl: "https://provider.example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    let snapshot = AppSnapshot(providers: [provider, provider], updatedAt: 1)
    try JSONEncoder().encode(snapshot).write(to: fileURL, options: [.atomic])
    let store = SnapshotStore(fileURL: fileURL)

    await #expect(throws: CocoaError.self) {
        try await store.load()
    }
}

@Test func snapshotStoreRejectsDuplicateRecordIdentifiersBeforeSave() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-snapshot-save-invalid-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let provider = ProviderConfig(
        id: "duplicate",
        name: "Duplicate",
        kind: .openAICompatible,
        baseUrl: "https://provider.example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    let snapshot = AppSnapshot(providers: [provider, provider], updatedAt: 1)
    let fileURL = directory.appendingPathComponent("snapshot.v1.json")
    let store = SnapshotStore(fileURL: fileURL)

    await #expect(throws: CocoaError.self) {
        try await store.save(snapshot)
    }
    #expect(!FileManager.default.fileExists(atPath: fileURL.path))
}

@Test func syncCommitTransitionRoundTripsEncryptedVaultWithoutPlaintextSecrets() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-sync-commit-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let fileURL = directory.appendingPathComponent("snapshot.v1.json")
    let transitionURL = directory.appendingPathComponent("snapshot.v1.local-data-transition.json")
    let store = SnapshotStore(fileURL: fileURL)
    let provider = ProviderConfig(
        id: "provider-a",
        name: "Provider A",
        kind: .openAICompatible,
        baseUrl: "https://provider-a.example.test/v1",
        model: "model-a",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: 1
    )
    let target = AppSnapshot(providers: [provider], updatedAt: 1_725_000_123_456)
    let vault = SyncVault(
        data: target,
        secrets: ProviderSecrets(providerKeys: ["provider-a": "sync-commit-test-secret"])
    )
    let passphrase = "sync-commit-test-passphrase"
    let crypto = CryptoEngine()
    let envelope = try await crypto.encryptVault(vault, passphrase: passphrase)
    let encryptedVault = try JSONEncoder().encode(envelope)
    let transition = LocalDataTransition(
        kind: .syncCommit,
        sourceSnapshotFingerprint: try snapshotFingerprint(nil),
        targetUpdatedAt: target.updatedAt,
        encryptedBackup: encryptedVault,
        providerIds: [provider.id]
    )

    try await store.stageLocalDataTransition(transition)

    let journal = try Data(contentsOf: transitionURL)
    let journalText = String(decoding: journal, as: UTF8.self)
    #expect(!journalText.contains("sync-commit-test-secret"))
    #expect(!journalText.contains(provider.baseUrl))

    let pending = try await store.loadLocalDataTransition()
    let loaded = try #require(pending)
    #expect(loaded.kind == .syncCommit)
    #expect(loaded.targetUpdatedAt == target.updatedAt)
    #expect(loaded.providerIds == [provider.id])
    let loadedData = try #require(loaded.encryptedBackup)
    let loadedEnvelope = try JSONDecoder().decode(EncryptedSnapshotEnvelope.self, from: loadedData)
    let recovered = try await crypto.decryptVault(loadedEnvelope, passphrase: passphrase)
    #expect(recovered.data.updatedAt == target.updatedAt)
    #expect(recovered.data.providers.first?.baseUrl == provider.baseUrl)
    #expect(recovered.secrets.providerKeys[provider.id] == "sync-commit-test-secret")

    let stillPending = try await store.loadLocalDataTransition()
    #expect(stillPending?.id == transition.id)
    try await store.completeLocalDataTransition()
    #expect(try await store.loadLocalDataTransition() == nil)
}

@Test func syncCommitTransitionRejectsUnrecoverableMetadataBeforePersistence() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("zerochat-sync-commit-invalid-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = SnapshotStore(fileURL: directory.appendingPathComponent("snapshot.v1.json"))
    let sourceFingerprint = try snapshotFingerprint(nil)
    let target = AppSnapshot(updatedAt: 7)
    let invalidTransitions = [
        LocalDataTransition(
            kind: .syncCommit,
            sourceSnapshotFingerprint: nil,
            targetUpdatedAt: 7,
            encryptedBackup: Data("encrypted".utf8),
            providerIds: ["provider-a"]
        ),
        LocalDataTransition(
            kind: .syncCommit,
            sourceSnapshotFingerprint: sourceFingerprint,
            targetSnapshot: target,
            targetUpdatedAt: 7,
            encryptedBackup: Data("encrypted".utf8),
            providerIds: ["provider-a"]
        ),
        LocalDataTransition(
            kind: .syncCommit,
            sourceSnapshotFingerprint: sourceFingerprint,
            targetUpdatedAt: nil,
            encryptedBackup: Data("encrypted".utf8),
            providerIds: ["provider-a"]
        ),
        LocalDataTransition(
            kind: .syncCommit,
            sourceSnapshotFingerprint: sourceFingerprint,
            targetUpdatedAt: 7,
            encryptedBackup: Data("encrypted".utf8),
            providerIds: []
        ),
    ]

    for transition in invalidTransitions {
        await #expect(throws: LocalDataTransitionError.invalidRecord) {
            try await store.stageLocalDataTransition(transition)
        }
        #expect(try await store.loadLocalDataTransition() == nil)
    }
}
