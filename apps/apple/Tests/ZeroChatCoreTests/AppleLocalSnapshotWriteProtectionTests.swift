import Foundation
import Testing

@Test func appleViewModelBlocksSnapshotAndKeychainWritesBeforeSideEffects() throws {
    let source = try appleChatViewModelSource()
    let commit = try functionBody("func commit(", in: source)
    let providerKey = try functionBody("func setProviderKey(", in: source)
    let secret = try functionBody("func setSecret(", in: source)
    let autoSync = try functionBody("private func scheduleAutoSync(", in: source)

    try #require(commit.range(of: "guard localSnapshotIssue == nil else") != nil)
    try #require(providerKey.range(of: "guard localSnapshotIssue == nil else") != nil)
    try #require(secret.range(of: "guard localSnapshotIssue == nil else") != nil)
    try #require(autoSync.range(of: "guard localSnapshotIssue == nil else") != nil)
    #expect(source.components(separatedBy: "guard localSnapshotIssue == nil else").count - 1 == 4)

    #expect(try appearsBefore(
        "guard localSnapshotIssue == nil else",
        "let previousConversationIds = Set(snapshot.conversations.map(\\.id))",
        in: commit
    ))
    #expect(try appearsBefore(
        "guard localSnapshotIssue == nil else",
        "snapshot = updated",
        in: commit
    ))
    #expect(try appearsBefore(
        "guard localSnapshotIssue == nil else",
        "try keychain.set(value, account: \"provider:\\(providerId)\")",
        in: providerKey
    ))
    #expect(try appearsBefore(
        "guard localSnapshotIssue == nil else",
        "try keychain.set(value, account: account)",
        in: secret
    ))
    #expect(try appearsBefore(
        "guard localSnapshotIssue == nil else",
        "pendingAutoSync = PendingAutoSync(",
        in: autoSync
    ))
}

@Test func appleSnapshotRecoveryKeepsAnExplicitDurableWritePath() throws {
    let source = try appleChatViewModelSource()
    let recovery = try functionBody("private func recoverLocalSnapshot(", in: source)

    #expect(!recovery.contains("guard localSnapshotIssue == nil else"))
    #expect(try appearsBefore("try await recoveryStore.save(recovered)", "snapshot = recovered", in: recovery))
    #expect(try appearsBefore("snapshot = recovered", "localSnapshotIssue = nil", in: recovery))
}

private enum AppleWriteProtectionTestError: Error {
    case markerMissing(String)
    case malformedFunction(String)
}

private func appleChatViewModelSource() throws -> String {
    let repositoryRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let sourceURL = repositoryRoot
        .appendingPathComponent("apps")
        .appendingPathComponent("apple")
        .appendingPathComponent("App")
        .appendingPathComponent("AppleChatViewModel.swift")
    return try String(contentsOf: sourceURL, encoding: .utf8)
}

private func functionBody(_ marker: String, in source: String) throws -> String {
    guard let markerRange = source.range(of: marker) else {
        throw AppleWriteProtectionTestError.markerMissing(marker)
    }
    guard let openingBrace = source[markerRange.lowerBound...].firstIndex(of: "{") else {
        throw AppleWriteProtectionTestError.malformedFunction(marker)
    }

    var depth = 0
    var cursor = openingBrace
    while cursor < source.endIndex {
        switch source[cursor] {
        case "{":
            depth += 1
        case "}":
            depth -= 1
            if depth == 0 {
                return String(source[openingBrace...cursor])
            }
        default:
            break
        }
        cursor = source.index(after: cursor)
    }

    throw AppleWriteProtectionTestError.malformedFunction(marker)
}

private func appearsBefore(_ first: String, _ second: String, in source: String) throws -> Bool {
    guard let firstRange = source.range(of: first) else {
        throw AppleWriteProtectionTestError.markerMissing(first)
    }
    guard let secondRange = source.range(of: second) else {
        throw AppleWriteProtectionTestError.markerMissing(second)
    }
    return firstRange.lowerBound < secondRange.lowerBound
}
