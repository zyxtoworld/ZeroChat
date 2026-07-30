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
