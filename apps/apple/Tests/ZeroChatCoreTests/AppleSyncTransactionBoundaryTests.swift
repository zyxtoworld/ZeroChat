import Foundation
import Testing

@Test func appleSyncDefersSecretsUntilSnapshotDurabilityAndGenerationAcceptance() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let network = try appleFunctionBody("private func syncIfConfigured(", in: source)
    let acceptance = try appleFunctionBody("private func applySyncedSnapshot(", in: source)
    let manual = try appleFunctionBody("private func runManualCloudSync(", in: source)

    #expect(!network.contains("appleApplyProviderKeys("))
    #expect(!network.contains("try keychain.set("))
    #expect(network.contains("AppleSyncCandidate"))
    #expect(acceptance.contains("AppleSyncAcceptanceResult"))
    #expect(acceptance.contains("appleIsStaleSyncResult("))
    #expect(acceptance.contains("sourceRevision: sourceRevision"))
    #expect(try appleAppearsBefore("try await store.save(accepted)", "try appleApplyProviderKeys(", in: acceptance))
    #expect(try appleAppearsBefore("try appleApplyProviderKeys(", "snapshot = accepted", in: acceptance))
    #expect(try appleAppearsBefore("await applySyncedSnapshot(", "notifySyncCompleteIfNeeded", in: manual))
}

@Test func appleManualAndAutomaticSyncShareSnapshotRevisionChecks() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let manual = try appleFunctionBody("private func runManualCloudSync(", in: source)
    let automatic = try appleFunctionBody("private func drainAutoSyncQueue(", in: source)

    #expect(manual.contains("let sourceRevision = snapshotRevision"))
    #expect(manual.contains("persistSyncSource(source, sourceRevision: sourceRevision)"))
    #expect(manual.contains("sourceRevision: sourceRevision"))
    #expect(manual.contains("case .stale:"))
    #expect(manual.contains("case .failed:"))
    #expect(automatic.contains("let nextRevision = pendingAutoSyncRevision ?? snapshotRevision"))
    #expect(automatic.contains("nextRevision != snapshotRevision"))
    #expect(automatic.contains("sourceRevision: nextRevision"))
    #expect(try appleAppearsBefore("nextRevision != snapshotRevision", "let candidate = await syncIfConfigured(", in: automatic))
    #expect(automatic.contains("case .stale:"))
    #expect(automatic.contains("case .failed:"))
}

@Test func appleFailedSnapshotSaveKeepsNewestDirtyCandidateRetryable() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let drain = try appleFunctionBody("private func drainSnapshotSaveQueue(", in: source)
    let retry = try appleFunctionBody("func retryLocalSnapshotSave()", in: source)
    let catchBody = try #require(drain.range(of: "} catch {"))
    let failureTail = String(drain[catchBody.upperBound...])
        .components(separatedBy: "reportSnapshotSaveFailure(error)")[0]

    #expect(failureTail.contains("if pendingSnapshotSave == nil"))
    #expect(failureTail.contains("pendingSnapshotSave = candidate"))
    #expect(failureTail.contains("pendingSnapshotSaveRevision = candidateRevision"))
    #expect(!failureTail.contains("snapshotSaveAutoSyncRequested = false"))
    #expect(retry.contains("pendingSnapshotSaveRevision ?? snapshotRevision"))
    #expect(retry.contains("enqueueSnapshotSave("))
}

@Test func appleProviderSecretBatchRollsBackAppliedKeysInReverseOrder() throws {
    let source = try appleSource("App/AppleBackupState.swift")
    let replacement = try appleFunctionBody("private func appleReplaceProviderKeysAtomically(", in: source)
    let restore = try appleFunctionBody("private func appleRestoreProviderKeys(", in: source)

    #expect(replacement.contains("var previousValues: [String: String] = [:]"))
    #expect(replacement.contains("previousValues[providerId] = try providerKey(providerId)"))
    #expect(replacement.contains("appliedProviderIds.append(providerId)"))
    #expect(replacement.contains("try appleRestoreProviderKeys("))
    #expect(replacement.contains("AppleCompensationError("))
    #expect(!replacement.contains("try? setProviderKey"))
    #expect(restore.contains("for providerId in providerIds.reversed()"))
    #expect(restore.contains("errors.append(error)"))
    #expect(restore.contains("Array(errors.dropFirst())"))
}

@Test func appleBackupImportStagesDurableRecoveryBeforeSecretsAndSnapshot() throws {
    let viewModel = try appleSource("App/AppleChatViewModel.swift")
    let importBackup = try appleFunctionBody("func importEncryptedBackup(", in: viewModel)
    let recovery = try appleFunctionBody("private func recoverPendingLocalDataTransition(", in: viewModel)

    #expect(importBackup.contains("LocalDataTransition("))
    #expect(importBackup.contains("kind: .encryptedBackupImport"))
    #expect(importBackup.contains("encryptedBackup: data"))
    #expect(importBackup.contains("try await stageLocalDataTransition("))
    #expect(importBackup.contains("try await recoverPendingLocalDataTransition("))
    #expect(try appleAppearsBefore(
        "try await stageLocalDataTransition(",
        "try await recoverPendingLocalDataTransition(",
        in: importBackup
    ))
    #expect(recovery.contains("localDataTransitionPassphrase("))
    #expect(recovery.contains("try appleApplyProviderKeyValues("))
    #expect(recovery.contains("try await recoverLocalSnapshot(target)"))
    #expect(recovery.contains("try await store.completeLocalDataTransition()"))
    #expect(try appleAppearsBefore(
        "try appleApplyProviderKeyValues(",
        "try await recoverLocalSnapshot(target)",
        in: recovery
    ))
    #expect(try appleAppearsBefore(
        "try await recoverLocalSnapshot(target)",
        "try await store.completeLocalDataTransition()",
        in: recovery
    ))
    #expect(importBackup.contains("requestAutoSync()"))
}

@Test func appleLocalResetStagesDurableRollForwardBeforeKeychainClear() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let reset = try appleFunctionBody("func resetLocalData()", in: source)
    let recovery = try appleFunctionBody("private func recoverPendingLocalDataTransition(", in: source)

    #expect(reset.contains("LocalDataTransition("))
    #expect(reset.contains("kind: .reset"))
    #expect(reset.contains("targetSnapshot: replacement"))
    #expect(reset.contains("if localSnapshotIssue != nil"))
    #expect(reset.contains("try await localStore.discardLocalDataTransition()"))
    #expect(reset.contains("try keychain.clearAllLocalDataTransitionPassphrases()"))
    #expect(reset.contains("try await stageLocalDataTransition("))
    #expect(reset.contains("try await recoverPendingLocalDataTransition("))
    #expect(!reset.contains("recoverLocalSnapshot(previousSnapshot)"))
    #expect(try appleAppearsBefore(
        "try await localStore.discardLocalDataTransition()",
        "try keychain.clearAllLocalDataTransitionPassphrases()",
        in: reset
    ))
    #expect(try appleAppearsBefore(
        "try keychain.clearAllLocalDataTransitionPassphrases()",
        "try await stageLocalDataTransition(",
        in: reset
    ))
    #expect(recovery.contains("case .reset:"))
    #expect(recovery.contains("try clearSecrets()"))
    #expect(recovery.contains("try await recoverLocalSnapshot(target)"))
    #expect(try appleAppearsBefore("try clearSecrets()", "try await recoverLocalSnapshot(target)", in: recovery))
}

@Test func appleBackupImportAndResetShareOneWholeTransactionRecoveryGate() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let begin = try appleFunctionBody("private func beginLocalSnapshotRecovery()", in: source)
    let importBackup = try appleFunctionBody("func importEncryptedBackup(", in: source)
    let reset = try appleFunctionBody("func resetLocalData()", in: source)

    #expect(source.contains("@Published private(set) var recoveringLocalSnapshot = false"))
    #expect(begin.contains("guard !recoveringLocalSnapshot"))
    #expect(begin.contains("recoveringLocalSnapshot = true"))
    for operation in [importBackup, reset] {
        #expect(operation.contains("try beginLocalSnapshotRecovery()"))
        #expect(operation.contains("defer { recoveringLocalSnapshot = false }"))
        #expect(operation.contains("await quiesceSnapshotPersistenceForRecovery()"))
    }
}

@Test func appleLocalDataRecoveryQuiescesOldSnapshotWritersAndBlocksNewOnes() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let quiesce = try appleFunctionBody("private func quiesceSnapshotPersistenceForRecovery()", in: source)
    let commit = try appleFunctionBody("func commit(", in: source)

    #expect(quiesce.contains("while let saveTask = snapshotSaveTask"))
    #expect(quiesce.contains("await saveTask.value"))
    #expect(quiesce.contains("pendingSnapshotSave = nil"))
    #expect(quiesce.contains("pendingSnapshotSaveRevision = nil"))
    #expect(commit.contains("!recoveringLocalSnapshot"))
}

@Test func appleStartupRecoversDurableLocalDataTransitionBeforeHydration() throws {
    let viewModel = try appleSource("App/AppleChatViewModel.swift")
    let keychain = try appleSource("Sources/ZeroChatCore/KeychainStore.swift")
    let store = try appleSource("Sources/ZeroChatCore/SnapshotStore.swift")
    let load = try appleFunctionBody("func load()", in: viewModel)
    let recovery = try appleFunctionBody("private func recoverPendingLocalDataTransition(", in: viewModel)

    #expect(try appleAppearsBefore(
        "recoverPendingLocalDataTransition(using: loadedStore)",
        "loadedStore.load()",
        in: load
    ))
    #expect(recovery.contains("sourceSnapshotFingerprint"))
    #expect(recovery.contains("currentFingerprint == sourceFingerprint || currentFingerprint == targetFingerprint"))
    #expect(keychain.contains("app.zerochat.client.local-data-transition"))
    #expect(keychain.contains("transitionId: String"))
    #expect(store.contains("snapshot.v1.local-data-transition.json"))
    #expect(store.contains("options: [.atomic]"))
    #expect(store.contains("maxLocalDataTransitionFileBytes"))
}

@Test func appleProviderDeletionCommitsKeychainAndSnapshotAsOneCompensatedTransaction() throws {
    let viewModel = try appleSource("App/AppleChatViewModel.swift")
    let editor = try appleSource("App/ProviderEditor.swift")
    let store = try appleSource("Sources/ZeroChatCore/SnapshotStore.swift")
    let deletion = try appleFunctionBody("func deleteProviderTransaction(", in: viewModel)
    let staleCompensation = try appleFunctionBody(
        "private func compensateStaleProviderDeletion(",
        in: viewModel
    )
    let compareAndSave = try appleFunctionBody("public func saveIfUnchanged(", in: store)

    #expect(deletion.contains("while let saveTask = snapshotSaveTask"))
    #expect(deletion.contains("try keychain.set(\"\", account: account)"))
    #expect(deletion.contains("store.saveIfUnchanged(expected: source, snapshot: candidate)"))
    #expect(deletion.contains("compensateProviderDeletionKey("))
    #expect(deletion.contains("await compensateStaleProviderDeletion("))
    #expect(deletion.contains("guard snapshotRevision == sourceRevision"))
    #expect(try appleAppearsBefore(
        "store.saveIfUnchanged(expected: source, snapshot: candidate)",
        "snapshot = candidate",
        in: deletion
    ))
    #expect(staleCompensation.contains("try await store.save(latest)"))
    #expect(staleCompensation.contains("compensateProviderDeletionKey("))
    #expect(compareAndSave.contains("guard try snapshotsMatch(current, expected)"))
    #expect(try appleAppearsBefore("snapshotsMatch(current, expected)", "try save(snapshot)", in: compareAndSave))
    #expect(editor.contains("await model.deleteProviderTransaction(provider.id)"))
    #expect(!editor.contains("model.setProviderKey(provider.id, \"\")"))
    #expect(!editor.contains("private func deleteProvider()"))
}

@Test func appleCloudClearCancelsPendingAutoSyncAndRejectsStaleCompletion() throws {
    let source = try appleSource("App/AppleChatViewModel.swift")
    let clear = try appleFunctionBody("func clearCloudData()", in: source)

    #expect(clear.contains("pendingAutoSync = nil"))
    #expect(clear.contains("pendingAutoSyncRevision = nil"))
    #expect(clear.contains("autoSyncTask?.cancel()"))
    #expect(clear.contains("clearCloudDataTask?.cancel()"))
    #expect(clear.contains("let clearSerial = cloudClearSerial"))
    #expect(clear.components(separatedBy: "guard cloudClearSerial == clearSerial").count - 1 == 4)
    #expect(clear.components(separatedBy: "catch is CancellationError").count - 1 == 2)
    #expect(clear.contains("passphrase: passphrase"))
}

@Test func appleRemoteMutationsShareOneSerializedOperationGate() throws {
    let source = try appleSource("Sources/ZeroChatCore/SyncClient.swift")
    let gate = try appleFunctionBody("private func withSerializedRemoteOperation", in: source)

    #expect(gate.contains("await acquireRemoteOperation()"))
    #expect(gate.contains("try Task.checkCancellation()"))
    #expect(gate.components(separatedBy: "releaseRemoteOperation()").count - 1 == 2)
    #expect(source.contains("private var remoteOperationWaiters: [CheckedContinuation<Void, Never>]"))

    for marker in [
        "public func syncGistVault(",
        "public func syncCloudflareVault(",
        "public func writeCloudflareSnapshot(",
        "public func clearCloudflare(",
    ] {
        let function = try appleFunctionBody(marker, in: source)
        #expect(function.contains("withSerializedRemoteOperation"))
    }
    #expect(source.components(separatedBy: "try await withSerializedRemoteOperation").count - 1 == 5)
}

@Test func appleSyncTargetChangeInvalidatesFirstSyncCompletion() throws {
    let helpers = try appleSource("App/AppleSyncStateHelpers.swift")
    let viewModel = try appleSource("App/AppleChatViewModel.swift")
    let identity = try appleFunctionBody("func appleSyncTargetIdentity(", in: helpers)
    let reset = try appleFunctionBody("func appleResetSyncCompletionWhenTargetChanges(", in: helpers)

    #expect(identity.contains("gist:"))
    #expect(identity.contains("cloudflare:"))
    #expect(identity.contains("components.host = components.host?.lowercased()"))
    #expect(reset.contains("reset.sync.lastSyncAt = nil"))
    #expect(reset.contains("reset.sync.lastSyncStatus = nil"))
    #expect(viewModel.contains("appleResetSyncCompletionWhenTargetChanges(previous: previous, next: next)"))
    #expect(viewModel.contains("appleHasCompletedSyncForCurrentTarget(local)"))
}

@Test func appleCloudflareConflictRetriesRereadAndMergeBeforeRepublish() throws {
    let source = try appleSource("Sources/ZeroChatCore/SyncClient.swift")
    let publicSync = try appleFunctionBody("public func syncCloudflareVault(", in: source)
    let attempt = try appleFunctionBody("private func syncCloudflareVaultAttempt(", in: source)

    #expect(publicSync.contains("for conflictAttempt in 0..<3"))
    #expect(publicSync.contains("shouldRetryCloudflareHeadConflict(afterAttempt: conflictAttempt)"))
    #expect(publicSync.contains("mergeRemoteAfterConflict: conflictAttempt > 0"))
    #expect(publicSync.contains("var hasConflictBase = false"))
    #expect(publicSync.contains("conflictBase = conflict.base"))
    #expect(attempt.contains("readIncrementalHead("))
    #expect(attempt.contains("if let remoteVault, mergeRemoteAfterConflict"))
    #expect(attempt.contains("selectedVault = try mergeGistVaults("))
    #expect(attempt.contains("base: conflictBase"))
    #expect(attempt.contains("throw CloudflareHeadConflict(base: remoteVault)"))
    #expect(try appleAppearsBefore("readIncrementalHead(", "mergeGistVaults(", in: attempt))
}

@Test func appleCloudflareRemoteAcceptanceRevalidatesFinalObservation() throws {
    let source = try appleSource("Sources/ZeroChatCore/SyncClient.swift")
    let attempt = try appleFunctionBody("private func syncCloudflareVaultAttempt(", in: source)
    let snapshotAttempt = try appleFunctionBody("private func syncCloudflareSnapshotVault(", in: source)
    let observation = try appleFunctionBody(
        "private func revalidateCloudflareRemoteObservation(",
        in: source
    )

    let incrementalReturns = attempt.components(separatedBy: "return acceptRemoteVault(")
    #expect(incrementalReturns.count == 4)
    for prefix in incrementalReturns.dropLast() {
        #expect(prefix.contains("revalidateCloudflareRemoteObservation("))
    }

    let snapshotReturns = snapshotAttempt.components(separatedBy: "return acceptRemoteVault(")
    #expect(snapshotReturns.count == 4)
    for prefix in snapshotReturns.dropLast() {
        #expect(prefix.contains("revalidateSnapshotObservation("))
    }

    #expect(try appleAppearsBefore(
        "manifestToVault(",
        "revalidateCloudflareRemoteObservation(",
        in: attempt
    ))
    #expect(try appleAppearsBefore(
        "readSnapshotVault(",
        "revalidateSnapshotObservation(",
        in: snapshotAttempt
    ))
    #expect(observation.contains("revalidateSnapshotObservation("))
    #expect(observation.contains("revalidateIncrementalHeadObservation("))
}

private enum AppleSyncTransactionBoundaryTestError: Error {
    case markerMissing(String)
    case malformedFunction(String)
}

private func appleSource(_ relativePath: String) throws -> String {
    let repositoryRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    let sourceURL = relativePath.split(separator: "/").reduce(
        repositoryRoot.appendingPathComponent("apps").appendingPathComponent("apple")
    ) { url, component in
        url.appendingPathComponent(String(component))
    }
    return try String(contentsOf: sourceURL, encoding: .utf8)
}

private func appleFunctionBody(_ marker: String, in source: String) throws -> String {
    guard let markerRange = source.range(of: marker) else {
        throw AppleSyncTransactionBoundaryTestError.markerMissing(marker)
    }
    guard let openingBrace = source[markerRange.lowerBound...].firstIndex(of: "{") else {
        throw AppleSyncTransactionBoundaryTestError.malformedFunction(marker)
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
    throw AppleSyncTransactionBoundaryTestError.malformedFunction(marker)
}

private func appleAppearsBefore(_ first: String, _ second: String, in source: String) throws -> Bool {
    guard let firstRange = source.range(of: first) else {
        throw AppleSyncTransactionBoundaryTestError.markerMissing(first)
    }
    guard let secondRange = source.range(of: second) else {
        throw AppleSyncTransactionBoundaryTestError.markerMissing(second)
    }
    return firstRange.lowerBound < secondRange.lowerBound
}
