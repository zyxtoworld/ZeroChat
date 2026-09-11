import CryptoKit
import Foundation

private let localDataTransitionVersion = 1
private let maxLocalDataTransitionFileBytes = maxEncryptedBackupFileBytes * 4 / 3 + 1_000_000

public enum LocalDataTransitionKind: String, Codable, Equatable, Sendable {
    case reset
    case encryptedBackupImport
    case syncCommit
}

public struct LocalDataTransition: Codable, Sendable {
    public var version: Int
    public var id: String
    public var kind: LocalDataTransitionKind
    public var sourceSnapshotFingerprint: String?
    public var targetSnapshot: AppSnapshot?
    public var targetUpdatedAt: Int64?
    public var encryptedBackup: Data?
    public var providerIds: [String]

    public init(
        id: String = UUID().uuidString.lowercased(),
        kind: LocalDataTransitionKind,
        sourceSnapshotFingerprint: String?,
        targetSnapshot: AppSnapshot? = nil,
        targetUpdatedAt: Int64? = nil,
        encryptedBackup: Data? = nil,
        providerIds: [String] = []
    ) {
        version = localDataTransitionVersion
        self.id = id
        self.kind = kind
        self.sourceSnapshotFingerprint = sourceSnapshotFingerprint
        self.targetSnapshot = targetSnapshot
        self.targetUpdatedAt = targetUpdatedAt
        self.encryptedBackup = encryptedBackup
        self.providerIds = providerIds
    }
}

public enum LocalDataTransitionError: Error, Equatable, LocalizedError, Sendable {
    case alreadyPending
    case invalidRecord

    public var errorDescription: String? {
        switch self {
        case .alreadyPending:
            return "A local data recovery operation is already pending."
        case .invalidRecord:
            return "The pending local data recovery record is invalid."
        }
    }
}

public func snapshotFingerprint(_ snapshot: AppSnapshot?) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(snapshot)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

public enum SnapshotCompareAndSaveResult: Sendable {
    case saved
    case changed(AppSnapshot?)
}

public actor SnapshotStore {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let fileURL: URL
    private let localDataTransitionURL: URL
    private let maxBytes: Int

    public init(appGroupIdentifier: String? = nil) throws {
        let baseURL: URL
        if let appGroupIdentifier,
           let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
            baseURL = container
        } else {
            baseURL = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
        }

        fileURL = baseURL.appending(path: "snapshot.v1.json")
        localDataTransitionURL = baseURL.appending(path: "snapshot.v1.local-data-transition.json")
        maxBytes = maxLocalSnapshotFileBytes
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public init(fileURL: URL, maxBytes: Int = maxLocalSnapshotFileBytes) {
        self.fileURL = fileURL
        localDataTransitionURL = fileURL
            .deletingPathExtension()
            .appendingPathExtension("local-data-transition.json")
        self.maxBytes = maxBytes
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public func load() throws -> AppSnapshot? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }

        let data = try readBoundedLocalFileData(
            at: fileURL,
            maxBytes: maxBytes
        )
        let snapshot = try decoder.decode(AppSnapshot.self, from: data)
        guard hasUniqueSnapshotRecordIds(snapshot) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return snapshot
    }

    public func save(_ snapshot: AppSnapshot) throws {
        guard hasUniqueSnapshotRecordIds(snapshot) else {
            throw CocoaError(.fileWriteInvalidFile)
        }
        let data = try encoder.encode(snapshot)
        try assertLocalFileByteCount(data.count, maxBytes: maxBytes)
        try data.write(to: fileURL, options: [.atomic])
    }

    public func saveIfUnchanged(
        expected: AppSnapshot?,
        snapshot: AppSnapshot
    ) throws -> SnapshotCompareAndSaveResult {
        let current = try load()
        guard try snapshotsMatch(current, expected) else {
            return .changed(current)
        }

        try save(snapshot)
        return .saved
    }

    public func clear() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return
        }

        try FileManager.default.removeItem(at: fileURL)
    }

    public func stageLocalDataTransition(_ transition: LocalDataTransition) throws {
        guard !FileManager.default.fileExists(atPath: localDataTransitionURL.path) else {
            throw LocalDataTransitionError.alreadyPending
        }
        try validateLocalDataTransition(transition)
        let data = try encoder.encode(transition)
        try assertLocalFileByteCount(data.count, maxBytes: maxLocalDataTransitionFileBytes)
        try data.write(to: localDataTransitionURL, options: [.atomic])
    }

    public func loadLocalDataTransition() throws -> LocalDataTransition? {
        guard FileManager.default.fileExists(atPath: localDataTransitionURL.path) else {
            return nil
        }
        let data = try readBoundedLocalFileData(
            at: localDataTransitionURL,
            maxBytes: maxLocalDataTransitionFileBytes
        )
        let transition = try decoder.decode(LocalDataTransition.self, from: data)
        try validateLocalDataTransition(transition)
        return transition
    }

    public func completeLocalDataTransition() throws {
        try removeLocalDataTransition()
    }

    public func discardLocalDataTransition() throws {
        try removeLocalDataTransition()
    }

    private func removeLocalDataTransition() throws {
        guard FileManager.default.fileExists(atPath: localDataTransitionURL.path) else {
            return
        }
        try FileManager.default.removeItem(at: localDataTransitionURL)
    }

    private func validateLocalDataTransition(_ transition: LocalDataTransition) throws {
        guard transition.version == localDataTransitionVersion,
              UUID(uuidString: transition.id) != nil,
              transition.providerIds == Array(Set(transition.providerIds)).sorted(),
              transition.providerIds.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              transition.sourceSnapshotFingerprint.map(isSHA256Fingerprint) ?? true else {
            throw LocalDataTransitionError.invalidRecord
        }

        switch transition.kind {
        case .reset:
            guard let targetSnapshot = transition.targetSnapshot,
                  hasUniqueSnapshotRecordIds(targetSnapshot),
                  transition.targetUpdatedAt == nil,
                  transition.encryptedBackup == nil else {
                throw LocalDataTransitionError.invalidRecord
            }
        case .encryptedBackupImport:
            guard transition.targetSnapshot == nil,
                  let targetUpdatedAt = transition.targetUpdatedAt,
                  targetUpdatedAt > 0,
                  let encryptedBackup = transition.encryptedBackup,
                  !encryptedBackup.isEmpty,
                  encryptedBackup.count <= maxEncryptedBackupFileBytes else {
                throw LocalDataTransitionError.invalidRecord
            }
        case .syncCommit:
            guard transition.sourceSnapshotFingerprint != nil,
                  transition.targetSnapshot == nil,
                  let targetUpdatedAt = transition.targetUpdatedAt,
                  targetUpdatedAt > 0,
                  let encryptedBackup = transition.encryptedBackup,
                  !encryptedBackup.isEmpty,
                  encryptedBackup.count <= maxEncryptedBackupFileBytes,
                  !transition.providerIds.isEmpty else {
                throw LocalDataTransitionError.invalidRecord
            }
        }
    }

    private func isSHA256Fingerprint(_ value: String) -> Bool {
        value.count == 64 && value.allSatisfy { character in
            character.isNumber || ("a"..."f").contains(String(character))
        }
    }

    private func snapshotsMatch(_ lhs: AppSnapshot?, _ rhs: AppSnapshot?) throws -> Bool {
        switch (lhs, rhs) {
        case (nil, nil):
            return true
        case (.some(let lhs), .some(let rhs)):
            return try encoder.encode(lhs) == encoder.encode(rhs)
        default:
            return false
        }
    }
}
