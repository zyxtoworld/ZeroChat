import Foundation

public enum FirstSyncStrategy: Sendable {
    case ask
    case useLocal
    case useRemote
    case merge
}

func shouldRetryCloudflareHeadConflict(
    afterAttempt attempt: Int,
    maxAttempts: Int = 3
) -> Bool {
    precondition(maxAttempts > 0)
    precondition(attempt >= 0)
    return attempt + 1 < maxAttempts
}

public actor SyncClient {
    private let session: CredentialBoundURLSession
    private let crypto = CryptoEngine()
    private let gistCursorStore = GistCursorStore()
    private var remoteOperationInProgress = false
    private var remoteOperationWaiters: [CheckedContinuation<Void, Never>] = []

    public init(session: URLSession = .shared) {
        self.session = CredentialBoundURLSession(session)
    }

    private func acquireRemoteOperation() async {
        if !remoteOperationInProgress {
            remoteOperationInProgress = true
            return
        }

        await withCheckedContinuation { continuation in
            remoteOperationWaiters.append(continuation)
        }
    }

    private func releaseRemoteOperation() {
        guard !remoteOperationWaiters.isEmpty else {
            remoteOperationInProgress = false
            return
        }

        remoteOperationWaiters.removeFirst().resume()
    }

    private func withSerializedRemoteOperation<Value>(
        _ operation: () async throws -> Value
    ) async throws -> Value {
        await acquireRemoteOperation()
        do {
            try Task.checkCancellation()
            let value = try await operation()
            releaseRemoteOperation()
            return value
        } catch {
            releaseRemoteOperation()
            throw error
        }
    }

    public func syncGistVault(
        vault: SyncVault,
        passphrase: String,
        gistId: String?,
        gistFile: String?,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = .ask,
        hasCompletedSync: Bool = false,
        hasLocalUserContent: Bool = true
    ) async throws -> SyncVault {
        try await withSerializedRemoteOperation {
            try await syncGistVaultUnserialized(
                vault: vault,
                passphrase: passphrase,
                gistId: gistId,
                gistFile: gistFile,
                token: token,
                firstSyncStrategy: firstSyncStrategy,
                hasCompletedSync: hasCompletedSync,
                hasLocalUserContent: hasLocalUserContent
            )
        }
    }

    private func syncGistVaultUnserialized(
        vault: SyncVault,
        passphrase: String,
        gistId: String?,
        gistFile: String?,
        token: String,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Bool,
        hasLocalUserContent: Bool
    ) async throws -> SyncVault {
        let gist = AppleGistSyncTransport(session: session, crypto: crypto)
        let trimmedToken = try AppleGistSyncTransport.normalizedGitHubToken(token)
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }

        let fileName = try AppleGistSyncTransport.normalizedGistFile(gistFile)
        let resolvedGistId = try AppleGistSyncTransport.normalizedGistId(gistId)
        let local = AppleGistSyncTransport.localVault(
            vault,
            gistId: resolvedGistId,
            fileName: fileName
        )

        guard let resolvedGistId else {
            let operation = try createGistStateOperation(parents: [], vault: local, tombstones: [])
            let createdId = try await gist.create(
                fileName: fileName,
                operation: operation,
                passphrase: passphrase,
                token: trimmedToken,
                updatedAt: operation.vault?.data.updatedAt ?? local.data.updatedAt
            )
            let syncedAt = syncNowMillis()
            var resultBase = operation.vault ?? local
            resultBase.data.sync = vault.data.sync
            let result = AppleGistSyncTransport.configuredVault(
                resultBase,
                gistId: createdId,
                fileName: fileName,
                status: "Sync complete",
                syncedAt: syncedAt
            )
            try gistCursorStore.store(
                gistId: createdId,
                fileName: fileName,
                heads: [operation.id],
                localSyncAt: result.data.sync.lastSyncAt,
                vault: result
            )
            return result
        }

        guard let remote = try await gist.readRemote(
            gistId: resolvedGistId,
            fileName: fileName,
            token: trimmedToken,
            passphrase: passphrase
        ) else {
            throw SyncError.missingGistId
        }

        let reconciled = try reconcileGistVault(
            local: local,
            remote: remote,
            gistId: resolvedGistId,
            fileName: fileName,
            firstSyncStrategy: firstSyncStrategy,
            hasCompletedSync: hasCompletedSync,
            hasLocalUserContent: hasLocalUserContent,
            localSyncAt: vault.data.sync.lastSyncAt
        )
        let shouldWrite = reconciled.shouldWrite || remote.legacy
        var heads = remote.heads
        if shouldWrite {
            let operation = try await gist.publishState(
                gistId: resolvedGistId,
                fileName: fileName,
                token: trimmedToken,
                passphrase: passphrase,
                parents: remote.heads,
                vault: reconciled.vault,
                tombstones: reconciled.tombstones,
                deleteFiles: remote.managedFiles.filter { remote.legacy || $0 != fileName }
            )
            heads = [operation.id]
        }

        let status = reconciled.remoteAccepted && !shouldWrite
            ? "Remote data restored"
            : "Sync complete"
        let syncedAt = syncNowMillis()
        var resultBase = reconciled.vault
        resultBase.data.sync = vault.data.sync
        let result = AppleGistSyncTransport.configuredVault(
            resultBase,
            gistId: resolvedGistId,
            fileName: fileName,
            status: status,
            syncedAt: syncedAt
        )
        try gistCursorStore.store(
            gistId: resolvedGistId,
            fileName: fileName,
            heads: heads,
            localSyncAt: result.data.sync.lastSyncAt,
            vault: result
        )
        return result
    }

    public func syncCloudflareVault(
        vault: SyncVault,
        passphrase: String,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = .ask,
        hasCompletedSync: Bool = false,
        hasLocalUserContent: Bool = true
    ) async throws -> SyncVault {
        try await withSerializedRemoteOperation {
            try await syncCloudflareVaultUnserialized(
                vault: vault,
                passphrase: passphrase,
                workerEndpoint: workerEndpoint,
                token: token,
                firstSyncStrategy: firstSyncStrategy,
                hasCompletedSync: hasCompletedSync,
                hasLocalUserContent: hasLocalUserContent
            )
        }
    }

    private func syncCloudflareVaultUnserialized(
        vault: SyncVault,
        passphrase: String,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Bool,
        hasLocalUserContent: Bool
    ) async throws -> SyncVault {
        var hasConflictBase = false
        var conflictBase: SyncVault?
        for conflictAttempt in 0..<3 {
            do {
                return try await syncCloudflareVaultAttempt(
                    vault: vault,
                    passphrase: passphrase,
                    workerEndpoint: workerEndpoint,
                    token: token,
                    firstSyncStrategy: firstSyncStrategy,
                    hasCompletedSync: hasCompletedSync,
                    hasLocalUserContent: hasLocalUserContent,
                    mergeRemoteAfterConflict: conflictAttempt > 0,
                    conflictBase: hasConflictBase ? conflictBase : nil
                )
            } catch let conflict as CloudflareHeadConflict {
                if !shouldRetryCloudflareHeadConflict(afterAttempt: conflictAttempt) {
                    throw SyncError.remoteUpdated
                }
                if !hasConflictBase {
                    conflictBase = conflict.base
                    hasConflictBase = true
                }
            } catch SyncError.remoteUpdated {
                if !shouldRetryCloudflareHeadConflict(afterAttempt: conflictAttempt) {
                    throw SyncError.remoteUpdated
                }
            } catch {
                throw error
            }
        }
        throw SyncError.remoteUpdated
    }

    private func syncCloudflareVaultAttempt(
        vault: SyncVault,
        passphrase: String,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Bool,
        hasLocalUserContent: Bool,
        mergeRemoteAfterConflict: Bool,
        conflictBase: SyncVault?
    ) async throws -> SyncVault {
        let cloudflare = AppleCloudflareSyncTransport(session: session, crypto: crypto)
        let incremental = AppleIncrementalSyncEngine(crypto: crypto, transport: cloudflare)
        let endpoint = try AppleCloudflareSyncTransport.normalizedWorkerEndpoint(workerEndpoint)
        let trimmedToken = try AppleCloudflareSyncTransport.normalizedAccessToken(token)
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }

        let headRead = try await cloudflare.readIncrementalHead(endpoint: endpoint, token: trimmedToken)
        if case .unsupported = headRead {
            return try await syncCloudflareSnapshotVault(
                vault: vault,
                passphrase: passphrase,
                endpoint: endpoint,
                token: trimmedToken,
                transport: cloudflare,
                firstSyncStrategy: firstSyncStrategy,
                hasCompletedSync: hasCompletedSync,
                hasLocalUserContent: hasLocalUserContent,
                expectedGeneration: nil,
                mergeRemoteAfterConflict: mergeRemoteAfterConflict,
                conflictBase: conflictBase
            )
        }
        guard let generation = headRead.generation else {
            throw SyncError.badSyncGeneration
        }

        let remoteState: IncrementalRemoteState?
        if case .head(let value, _) = headRead {
            let manifest = try await incremental.readManifest(
                endpoint: endpoint,
                token: trimmedToken,
                passphrase: passphrase,
                head: value
            )
            remoteState = IncrementalRemoteState(head: value, manifest: manifest)
        } else {
            remoteState = nil
        }

        let remoteVault: SyncVault?
        let snapshotObservation: LegacySnapshotObservation?
        if let remoteState {
            remoteVault = try await incremental.manifestToVault(
                endpoint: endpoint,
                token: trimmedToken,
                passphrase: passphrase,
                manifest: remoteState.manifest
            )
            snapshotObservation = nil
        } else {
            let legacySnapshot = try await cloudflare.readSnapshotVault(
                endpoint: endpoint,
                token: trimmedToken,
                passphrase: passphrase
            )
            try requireMatchingSyncGeneration(
                expected: generation,
                observed: legacySnapshot.generation
            )
            remoteVault = legacySnapshot.vault
            snapshotObservation = legacySnapshot.observation
        }

        let selectedVault: SyncVault
        if let remoteVault, mergeRemoteAfterConflict {
            selectedVault = try mergeGistVaults(
                base: conflictBase,
                remote: remoteVault,
                local: vault
            )
        } else if let remoteVault, !hasCompletedSync {
            switch firstSyncStrategy {
            case .useRemote:
                try await revalidateCloudflareRemoteObservation(
                    transport: cloudflare,
                    endpoint: endpoint,
                    token: trimmedToken,
                    headRead: headRead,
                    snapshotObservation: snapshotObservation
                )
                return acceptRemoteVault(remoteVault, local: vault.data)
            case .useLocal:
                selectedVault = vault
            case .merge:
                selectedVault = mergeFirstSyncVault(remote: remoteVault, local: vault)
            case .ask:
                if !hasLocalUserContent {
                    try await revalidateCloudflareRemoteObservation(
                        transport: cloudflare,
                        endpoint: endpoint,
                        token: trimmedToken,
                        headRead: headRead,
                        snapshotObservation: snapshotObservation
                    )
                    return acceptRemoteVault(remoteVault, local: vault.data)
                }
                throw SyncError.firstSyncConflict
            }
        } else if let remoteVault, remoteVault.data.updatedAt > vault.data.updatedAt {
            try await revalidateCloudflareRemoteObservation(
                transport: cloudflare,
                endpoint: endpoint,
                token: trimmedToken,
                headRead: headRead,
                snapshotObservation: snapshotObservation
            )
            return acceptRemoteVault(remoteVault, local: vault.data)
        } else {
            selectedVault = vault
        }

        do {
            return try await incremental.uploadVault(
                vault: selectedVault,
                passphrase: passphrase,
                endpoint: endpoint,
                token: trimmedToken,
                previous: remoteState,
                generation: generation
            )
        } catch SyncError.remoteUpdated {
            throw CloudflareHeadConflict(base: remoteVault)
        }
    }

    public func syncCloudflare(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String,
        firstSyncStrategy: FirstSyncStrategy = .ask,
        hasCompletedSync: Bool = false,
        hasLocalUserContent: Bool = true
    ) async throws -> EncryptedSnapshotEnvelope {
        let cloudflare = AppleCloudflareSyncTransport(session: session, crypto: crypto)
        let baseEndpoint = try AppleCloudflareSyncTransport.normalizedWorkerEndpoint(workerEndpoint)
        let trimmedToken = try AppleCloudflareSyncTransport.normalizedAccessToken(token)

        let headRead = try await cloudflare.readIncrementalHead(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        if case .head = headRead {
            throw SyncError.incrementalRequiresVaultSync
        }

        let snapshotRead = try await cloudflare.readSnapshotEnvelope(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        try requireMatchingSyncGeneration(
            expected: headRead.generation,
            observed: snapshotRead.generation
        )
        if let remote = snapshotRead.envelope,
           remote.kind == "zerochat.encryptedSnapshot" {
            if !hasCompletedSync {
                switch firstSyncStrategy {
                case .useRemote:
                    try await cloudflare.revalidateSnapshotObservation(
                        endpoint: baseEndpoint,
                        token: trimmedToken,
                        expected: snapshotRead.observation
                    )
                    return remote
                case .useLocal, .merge:
                    break
                case .ask:
                    if !hasLocalUserContent {
                        try await cloudflare.revalidateSnapshotObservation(
                            endpoint: baseEndpoint,
                            token: trimmedToken,
                            expected: snapshotRead.observation
                        )
                        return remote
                    }
                    throw SyncError.firstSyncConflict
                }
            }

            if hasCompletedSync && remote.updatedAt > envelope.updatedAt {
                try await cloudflare.revalidateSnapshotObservation(
                    endpoint: baseEndpoint,
                    token: trimmedToken,
                    expected: snapshotRead.observation
                )
                return remote
            }
        }

        try await cloudflare.writeSnapshotEnvelope(
            envelope,
            endpoint: baseEndpoint,
            token: trimmedToken,
            condition: snapshotRead.writeCondition,
            generation: snapshotRead.generation
        )
        return envelope
    }

    public func readCloudflareSnapshot(
        workerEndpoint: String,
        token: String
    ) async throws -> EncryptedSnapshotEnvelope? {
        let cloudflare = AppleCloudflareSyncTransport(session: session, crypto: crypto)
        let baseEndpoint = try AppleCloudflareSyncTransport.normalizedWorkerEndpoint(workerEndpoint)
        let trimmedToken = try AppleCloudflareSyncTransport.normalizedAccessToken(token)

        let headRead = try await cloudflare.readIncrementalHead(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        if case .head = headRead {
            throw SyncError.incrementalRequiresVaultSync
        }

        let snapshotRead = try await cloudflare.readSnapshotEnvelope(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        try requireMatchingSyncGeneration(
            expected: headRead.generation,
            observed: snapshotRead.generation
        )
        try await cloudflare.revalidateSnapshotObservation(
            endpoint: baseEndpoint,
            token: trimmedToken,
            expected: snapshotRead.observation
        )
        return snapshotRead.envelope
    }

    public func writeCloudflareSnapshot(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String
    ) async throws {
        try await withSerializedRemoteOperation {
            try await writeCloudflareSnapshotUnserialized(
                envelope: envelope,
                workerEndpoint: workerEndpoint,
                token: token
            )
        }
    }

    private func writeCloudflareSnapshotUnserialized(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String
    ) async throws {
        let cloudflare = AppleCloudflareSyncTransport(session: session, crypto: crypto)
        let baseEndpoint = try AppleCloudflareSyncTransport.normalizedWorkerEndpoint(workerEndpoint)
        let trimmedToken = try AppleCloudflareSyncTransport.normalizedAccessToken(token)

        let headRead = try await cloudflare.readIncrementalHead(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        if case .head = headRead {
            throw SyncError.incrementalRequiresVaultSync
        }

        let snapshotRead = try await cloudflare.readSnapshotEnvelope(
            endpoint: baseEndpoint,
            token: trimmedToken
        )
        try requireMatchingSyncGeneration(
            expected: headRead.generation,
            observed: snapshotRead.generation
        )
        try await cloudflare.writeSnapshotEnvelope(
            envelope,
            endpoint: baseEndpoint,
            token: trimmedToken,
            condition: snapshotRead.writeCondition,
            generation: snapshotRead.generation
        )
    }

    public func clearCloudflare(
        workerEndpoint: String,
        token: String
    ) async throws {
        try await withSerializedRemoteOperation {
            try await AppleCloudflareSyncTransport(session: session, crypto: crypto)
                .clearRemote(workerEndpoint: workerEndpoint, token: token)
        }
    }

    public func clearGist(
        gistId: String?,
        gistFile: String?,
        token: String,
        passphrase: String
    ) async throws {
        try await withSerializedRemoteOperation {
            let trimmedToken = try AppleGistSyncTransport.normalizedGitHubToken(token)
            guard !passphrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw SnapshotCryptoError.missingPassphrase
            }
            let fileName = try AppleGistSyncTransport.normalizedGistFile(gistFile)
            guard let gistId = try AppleGistSyncTransport.normalizedGistId(gistId) else { return }
            _ = try await AppleGistSyncTransport(session: session, crypto: crypto).clear(
                gistId: gistId,
                fileName: fileName,
                token: trimmedToken,
                passphrase: passphrase,
                updatedAt: syncNowMillis()
            )
            gistCursorStore.clear(gistId: gistId, fileName: fileName)
        }
    }

    private func reconcileGistVault(
        local: SyncVault,
        remote: GistRemoteState,
        gistId: String,
        fileName: String,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Bool,
        hasLocalUserContent: Bool,
        localSyncAt: Int64?
    ) throws -> ReconciledGistVault {
        guard let remoteVault = remote.vault else {
            return ReconciledGistVault(
                remoteAccepted: false,
                shouldWrite: true,
                tombstones: [],
                vault: local
            )
        }

        if hasCompletedSync,
           let localSyncAt,
           let cursor = gistCursorStore.load(
               gistId: gistId,
               fileName: fileName,
               localSyncAt: localSyncAt
           ) {
            let localTombstones = try tombstonesFromGistCursor(cursor, vault: local)
            let localOperation = try createGistStateOperation(
                parents: cursor.heads,
                vault: local,
                tombstones: localTombstones
            )
            var combined = remote.operations
            combined[localOperation.id] = localOperation
            let materialized = try materializeGistOperations(combined)
            let selected = materialized.vault ?? local
            return ReconciledGistVault(
                remoteAccepted: try !gistVaultsEqual(selected, local),
                shouldWrite: try !gistVaultsEqual(selected, remoteVault),
                tombstones: materialized.tombstones,
                vault: selected
            )
        }

        if hasCompletedSync {
            let selected = try mergeGistVaults(base: nil, remote: remoteVault, local: local)
            return ReconciledGistVault(
                remoteAccepted: try !gistVaultsEqual(selected, local),
                shouldWrite: try !gistVaultsEqual(selected, remoteVault),
                tombstones: [],
                vault: selected
            )
        }

        switch firstSyncStrategy {
        case .useRemote:
            return ReconciledGistVault(
                remoteAccepted: true,
                shouldWrite: false,
                tombstones: remote.tombstones,
                vault: normalizeGistVault(acceptRemoteVault(remoteVault, local: local.data))
            )
        case .merge:
            return ReconciledGistVault(
                remoteAccepted: true,
                shouldWrite: true,
                tombstones: [],
                vault: normalizeGistVault(mergeFirstSyncVault(remote: remoteVault, local: local))
            )
        case .ask:
            if !hasLocalUserContent {
                return ReconciledGistVault(
                    remoteAccepted: true,
                    shouldWrite: false,
                    tombstones: remote.tombstones,
                    vault: normalizeGistVault(acceptRemoteVault(remoteVault, local: local.data))
                )
            }
            throw SyncError.firstSyncConflict
        case .useLocal:
            return ReconciledGistVault(
                remoteAccepted: false,
                shouldWrite: true,
                tombstones: try tombstonesBetweenGistVaults(remoteVault, local),
                vault: local
            )
        }
    }

    private func syncCloudflareSnapshotVault(
        vault: SyncVault,
        passphrase: String,
        endpoint: URL,
        token: String,
        transport: AppleCloudflareSyncTransport,
        firstSyncStrategy: FirstSyncStrategy,
        hasCompletedSync: Bool,
        hasLocalUserContent: Bool,
        expectedGeneration: SyncGeneration?,
        mergeRemoteAfterConflict: Bool = false,
        conflictBase: SyncVault? = nil
    ) async throws -> SyncVault {
        let snapshotRead = try await transport.readSnapshotVault(
            endpoint: endpoint,
            token: token,
            passphrase: passphrase
        )
        try requireMatchingSyncGeneration(
            expected: expectedGeneration,
            observed: snapshotRead.generation
        )
        let remote = snapshotRead.vault
        let selected: SyncVault

        if let remote, mergeRemoteAfterConflict {
            selected = try mergeGistVaults(
                base: conflictBase,
                remote: remote,
                local: vault
            )
        } else if let remote, !hasCompletedSync {
            switch firstSyncStrategy {
            case .useRemote:
                try await transport.revalidateSnapshotObservation(
                    endpoint: endpoint,
                    token: token,
                    expected: snapshotRead.observation
                )
                return acceptRemoteVault(remote, local: vault.data)
            case .useLocal:
                selected = vault
            case .merge:
                selected = mergeFirstSyncVault(remote: remote, local: vault)
            case .ask:
                if !hasLocalUserContent {
                    try await transport.revalidateSnapshotObservation(
                        endpoint: endpoint,
                        token: token,
                        expected: snapshotRead.observation
                    )
                    return acceptRemoteVault(remote, local: vault.data)
                }
                throw SyncError.firstSyncConflict
            }
        } else if let remote, remote.data.updatedAt > vault.data.updatedAt {
            try await transport.revalidateSnapshotObservation(
                endpoint: endpoint,
                token: token,
                expected: snapshotRead.observation
            )
            return acceptRemoteVault(remote, local: vault.data)
        } else {
            selected = vault
        }

        do {
            try await transport.writeSnapshotVault(
                selected,
                passphrase: passphrase,
                endpoint: endpoint,
                token: token,
                condition: snapshotRead.writeCondition,
                generation: snapshotRead.generation
            )
        } catch SyncError.remoteUpdated {
            throw CloudflareHeadConflict(base: remote)
        }
        return selected
    }

    private func revalidateCloudflareRemoteObservation(
        transport: AppleCloudflareSyncTransport,
        endpoint: URL,
        token: String,
        headRead: IncrementalHeadRead,
        snapshotObservation: LegacySnapshotObservation?
    ) async throws {
        if let snapshotObservation {
            try await transport.revalidateSnapshotObservation(
                endpoint: endpoint,
                token: token,
                expected: snapshotObservation
            )
            return
        }
        try await transport.revalidateIncrementalHeadObservation(
            endpoint: endpoint,
            token: token,
            expected: headRead
        )
    }
}

public enum SyncError: LocalizedError {
    case missingEndpoint
    case missingToken
    case unsafeEndpoint
    case incrementalRequiresVaultSync
    case firstSyncConflict
    case badIncrementalHead
    case badSnapshotETag
    case badSyncGeneration
    case badIncrementalObject
    case badIncrementalManifest
    case badGistOperation
    case badMessageChunk
    case badSkillChunk
    case remoteUpdated
    case readFailed(Int)
    case writeFailed(Int)
    case missingGitHubToken
    case missingGistId
    case invalidGistId
    case invalidGistFile

    public var errorDescription: String? {
        switch self {
        case .missingEndpoint:
            return "Cloudflare Worker URL is required."
        case .missingToken:
            return "Cloudflare access key is required."
        case .missingGitHubToken:
            return "GitHub token is required."
        case .missingGistId:
            return "Could not get a Gist ID."
        case .invalidGistId:
            return "Gist ID is invalid."
        case .invalidGistFile:
            return "Gist file name is invalid."
        case .unsafeEndpoint:
            return "Cloudflare Worker URL must use HTTPS unless it is a loopback address."
        case .incrementalRequiresVaultSync:
            return "Cloudflare has incremental sync data. Use the current native sync flow so Web, mobile, and desktop stay unified."
        case .firstSyncConflict:
            return "Local and cloud both have data. Choose local, cloud, or merge before syncing."
        case .badIncrementalHead:
            return "Remote incremental sync head is invalid."
        case .badSnapshotETag:
            return "Remote legacy snapshot is missing a valid strong ETag."
        case .badSyncGeneration:
            return "Remote sync response is missing a valid generation."
        case .badIncrementalObject:
            return "Remote incremental sync object is invalid."
        case .badIncrementalManifest:
            return "Remote incremental manifest is invalid."
        case .badGistOperation:
            return "Remote Gist sync operation is invalid."
        case .badMessageChunk:
            return "Remote message chunk does not match its manifest reference."
        case .badSkillChunk:
            return "Remote Skill chunk does not match its manifest reference."
        case .remoteUpdated:
            return "Cloud data changed. Pull again before uploading."
        case .readFailed(let status):
            return "Cloud sync request failed with HTTP \(status)."
        case .writeFailed(let status):
            return "Cloud sync request failed with HTTP \(status)."
        }
    }
}

private func requireMatchingSyncGeneration(
    expected: SyncGeneration?,
    observed: SyncGeneration
) throws {
    if let expected, expected != observed {
        throw SyncError.remoteUpdated
    }
}

private struct ReconciledGistVault {
    var remoteAccepted: Bool
    var shouldWrite: Bool
    var tombstones: [GistTombstone]
    var vault: SyncVault
}

private struct CloudflareHeadConflict: Error {
    let base: SyncVault?
}
