import Foundation

struct AppleCloudflareSyncTransport {
    private let session: CredentialBoundURLSession
    private let crypto: CryptoEngine
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: CredentialBoundURLSession, crypto: CryptoEngine) {
        self.session = session
        self.crypto = crypto
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    func readSnapshotEnvelope(
        endpoint: URL,
        token: String
    ) async throws -> LegacySnapshotRead {
        var request = URLRequest(url: endpoint.appendingPathComponent("snapshot"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncSnapshotBytes,
            label: "Cloud sync snapshot response"
        )
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.readFailed(0)
        }
        guard http.statusCode == 200 || http.statusCode == 404 else {
            throw SyncError.readFailed(http.statusCode)
        }
        let generation = try Self.requiredSyncGeneration(http)
        if http.statusCode == 404 {
            return .missing(generation: generation)
        }

        guard let strongETag = Self.validatedSnapshotETag(
            http.value(forHTTPHeaderField: "ETag")
        ) else {
            throw SyncError.badSnapshotETag
        }
        return .found(
            envelope: try decoder.decode(EncryptedSnapshotEnvelope.self, from: data),
            strongETag: strongETag,
            generation: generation
        )
    }

    func writeSnapshotEnvelope(
        _ envelope: EncryptedSnapshotEnvelope,
        endpoint: URL,
        token: String,
        condition: LegacySnapshotWriteCondition,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("snapshot"))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
        switch condition {
        case .create:
            request.setValue("*", forHTTPHeaderField: "If-None-Match")
        case .replace(let strongETag):
            guard Self.validatedSnapshotETag(strongETag) != nil else {
                throw SyncError.badSnapshotETag
            }
            request.setValue(strongETag, forHTTPHeaderField: "If-Match")
        }
        request.httpBody = try encoder.encode(envelope)
        try assertSyncDataSize(
            request.httpBody ?? Data(),
            maxBytes: maxSyncSnapshotBytes,
            label: "Encrypted sync snapshot"
        )

        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud sync write response"
        )
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.writeFailed(0)
        }
        if Self.isMutationConflict(http.statusCode) {
            throw SyncError.remoteUpdated
        }
        if !(200..<300).contains(http.statusCode) {
            throw SyncError.writeFailed(http.statusCode)
        }
    }

    func readSnapshotVault(
        endpoint: URL,
        token: String,
        passphrase: String
    ) async throws -> LegacySnapshotVaultRead {
        switch try await readSnapshotEnvelope(endpoint: endpoint, token: token) {
        case .missing(let generation):
            return LegacySnapshotVaultRead(
                vault: nil,
                writeCondition: .create,
                generation: generation
            )
        case .found(let envelope, let strongETag, let generation):
            return LegacySnapshotVaultRead(
                vault: try await crypto.decryptVault(envelope, passphrase: passphrase),
                writeCondition: .replace(strongETag: strongETag),
                generation: generation
            )
        }
    }

    func revalidateSnapshotObservation(
        endpoint: URL,
        token: String,
        expected: LegacySnapshotObservation
    ) async throws {
        let observed = try await readSnapshotEnvelope(endpoint: endpoint, token: token)
        guard observed.observation == expected else {
            throw SyncError.remoteUpdated
        }
    }

    func writeSnapshotVault(
        _ vault: SyncVault,
        passphrase: String,
        endpoint: URL,
        token: String,
        condition: LegacySnapshotWriteCondition,
        generation: SyncGeneration
    ) async throws {
        let envelope = try await crypto.encryptVault(vault, passphrase: passphrase)
        try await writeSnapshotEnvelope(
            envelope,
            endpoint: endpoint,
            token: token,
            condition: condition,
            generation: generation
        )
    }

    func readIncrementalHead(
        endpoint: URL,
        token: String
    ) async throws -> IncrementalHeadRead {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/head"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncIncrementalHeadBytes,
            label: "Cloud incremental head response"
        )
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.readFailed(0)
        }

        if http.statusCode == 501 {
            return .unsupported
        }
        if http.statusCode == 404 {
            return .empty(generation: try Self.requiredSyncGeneration(http))
        }
        guard http.statusCode == 200 else {
            throw SyncError.readFailed(http.statusCode)
        }

        let generation = try Self.requiredSyncGeneration(http)
        let head = try decoder.decode(IncrementalSyncHead.self, from: data)
        guard head.kind == "zerochat.incrementalHead",
              head.version == 1,
              isSafeObjectKey(head.manifestKey),
              head.manifestKey.hasPrefix("manifest-"),
              head.updatedAt > 0 else {
            throw SyncError.badIncrementalHead
        }
        return .head(head, generation: generation)
    }

    func readIncrementalObject(
        endpoint: URL,
        token: String,
        key: String
    ) async throws -> EncryptedObjectEnvelope {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/object/\(encodeKey(key))"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncIncrementalObjectBytes,
            label: "Cloud incremental object response"
        )
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw SyncError.readFailed((response as? HTTPURLResponse)?.statusCode ?? 0)
        }

        let envelope = try decoder.decode(EncryptedObjectEnvelope.self, from: data)
        guard envelope.kind == "zerochat.encryptedObject", envelope.version == 1 else {
            throw SyncError.badIncrementalObject
        }
        return envelope
    }

    func revalidateIncrementalHeadObservation(
        endpoint: URL,
        token: String,
        expected: IncrementalHeadRead
    ) async throws {
        let observed = try await readIncrementalHead(endpoint: endpoint, token: token)
        guard observed.hasSameObservation(as: expected) else {
            throw SyncError.remoteUpdated
        }
    }

    func writeIncrementalObject(
        endpoint: URL,
        token: String,
        key: String,
        envelope: EncryptedObjectEnvelope,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/object/\(encodeKey(key))"))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
        request.httpBody = try encoder.encode(envelope)
        try assertSyncDataSize(
            request.httpBody ?? Data(),
            maxBytes: maxSyncIncrementalObjectBytes,
            label: "Encrypted incremental sync object"
        )

        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud incremental object write response"
        )
        try Self.requireSuccessfulMutation(response)
    }

    func deleteIncrementalObject(
        endpoint: URL,
        token: String,
        key: String,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/object/\(encodeKey(key))"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)

        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud incremental object delete response"
        )
        try Self.requireSuccessfulMutation(response, allowingNotFound: true)
    }

    func writeIncrementalHead(
        endpoint: URL,
        token: String,
        head: IncrementalSyncHead,
        expectedPreviousHead: IncrementalSyncHead?,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/head"))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
        if let expectedPreviousHead {
            request.setValue(
                "\"\(expectedPreviousHead.manifestKey)\"",
                forHTTPHeaderField: "If-Match"
            )
        } else {
            request.setValue("*", forHTTPHeaderField: "If-None-Match")
        }
        request.httpBody = try encoder.encode(head)
        try assertSyncDataSize(
            request.httpBody ?? Data(),
            maxBytes: maxSyncIncrementalHeadBytes,
            label: "Incremental sync head"
        )

        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud incremental head write response"
        )
        try Self.requireSuccessfulMutation(response)
    }

    func deleteIncrementalHead(
        endpoint: URL,
        token: String,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("sync/head"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud incremental head delete response"
        )
        try Self.requireSuccessfulMutation(response, allowingNotFound: true)
    }

    func deleteLegacySnapshot(
        endpoint: URL,
        token: String,
        generation: SyncGeneration
    ) async throws {
        var request = URLRequest(url: endpoint.appendingPathComponent("snapshot"))
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud legacy snapshot delete response"
        )
        try Self.requireSuccessfulMutation(response, allowingNotFound: true)
    }

    func clearRemote(
        workerEndpoint: String,
        token: String
    ) async throws {
        let endpoint = try Self.normalizedWorkerEndpoint(workerEndpoint)
        let trimmedToken = try Self.normalizedAccessToken(token)

        var bulkRequest = URLRequest(url: endpoint.appendingPathComponent("sync/clear"))
        bulkRequest.httpMethod = "DELETE"
        bulkRequest.setValue("Bearer \(trimmedToken)", forHTTPHeaderField: "Authorization")

        let (_, bulkResponse) = try await session.boundedData(
            for: bulkRequest,
            maxBytes: maxSyncErrorBodyBytes,
            label: "Cloud clear response"
        )
        guard let http = bulkResponse as? HTTPURLResponse else {
            throw SyncError.writeFailed(0)
        }
        if (200..<300).contains(http.statusCode) {
            _ = try Self.requiredSyncGeneration(http)
            return
        }
        if Self.isMutationConflict(http.statusCode) {
            throw SyncError.remoteUpdated
        }
        guard [404, 405, 501].contains(http.statusCode) else {
            throw SyncError.writeFailed(http.statusCode)
        }

        let headRead = try await readIncrementalHead(endpoint: endpoint, token: trimmedToken)
        let snapshotRead = try await readSnapshotEnvelope(endpoint: endpoint, token: trimmedToken)
        if let headGeneration = headRead.generation,
           headGeneration != snapshotRead.generation {
            throw SyncError.remoteUpdated
        }
        let generation = snapshotRead.generation

        for path in ["sync/head", "snapshot"] {
            var request = URLRequest(url: endpoint.appendingPathComponent(path))
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(trimmedToken)", forHTTPHeaderField: "Authorization")
            request.setValue(generation.rawValue, forHTTPHeaderField: syncGenerationHeader)
            let (_, response) = try await session.boundedData(
                for: request,
                maxBytes: maxSyncErrorBodyBytes,
                label: "Cloud fallback clear response"
            )
            try Self.requireSuccessfulMutation(response, allowingNotFound: true)
        }
    }

    static func normalizedAccessToken(_ value: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw SyncError.missingToken
        }
        return trimmed
    }

    static func validatedSnapshotETag(_ value: String?) -> String? {
        let prefix = "\"snapshot-sha256-"
        guard let value,
              value.count == prefix.count + 65,
              value.hasPrefix(prefix),
              value.hasSuffix("\"") else {
            return nil
        }

        let digest = value.dropFirst(prefix.count).dropLast()
        guard digest.utf8.count == 64,
              digest.utf8.allSatisfy({ byte in
                  (byte >= 48 && byte <= 57) ||
                      (byte >= 65 && byte <= 70) ||
                      (byte >= 97 && byte <= 102)
              }) else {
            return nil
        }
        return value
    }

    static func validatedSyncGeneration(_ value: String?) -> SyncGeneration? {
        guard let value else { return nil }
        return SyncGeneration(rawValue: value)
    }

    private static func requiredSyncGeneration(_ response: HTTPURLResponse) throws -> SyncGeneration {
        guard let generation = validatedSyncGeneration(
            response.value(forHTTPHeaderField: syncGenerationHeader)
        ) else {
            throw SyncError.badSyncGeneration
        }
        return generation
    }

    private static func isMutationConflict(_ statusCode: Int) -> Bool {
        [409, 412, 428].contains(statusCode)
    }

    private static func requireSuccessfulMutation(
        _ response: URLResponse,
        allowingNotFound: Bool = false
    ) throws {
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.writeFailed(0)
        }
        if isMutationConflict(http.statusCode) {
            throw SyncError.remoteUpdated
        }
        if allowingNotFound && http.statusCode == 404 {
            return
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncError.writeFailed(http.statusCode)
        }
    }

    static func normalizedWorkerEndpoint(_ value: String) throws -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed), let scheme = components.scheme else {
            throw SyncError.missingEndpoint
        }

        let host = components.host ?? ""
        let isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard scheme == "https" || (scheme == "http" && isLoopback) else {
            throw SyncError.unsafeEndpoint
        }
        guard components.user == nil, components.password == nil else {
            throw SyncError.unsafeEndpoint
        }
        guard components.query == nil, components.fragment == nil else {
            throw SyncError.unsafeEndpoint
        }

        guard var base = components.url?.absoluteString else {
            throw SyncError.missingEndpoint
        }

        while base.hasSuffix("/") {
            base.removeLast()
        }

        guard let endpoint = URL(string: base) else {
            throw SyncError.missingEndpoint
        }

        return endpoint
    }
}

enum LegacySnapshotRead {
    case missing(generation: SyncGeneration)
    case found(
        envelope: EncryptedSnapshotEnvelope,
        strongETag: String,
        generation: SyncGeneration
    )

    var envelope: EncryptedSnapshotEnvelope? {
        guard case .found(let envelope, _, _) = self else { return nil }
        return envelope
    }

    var generation: SyncGeneration {
        switch self {
        case .missing(let generation), .found(_, _, let generation):
            return generation
        }
    }

    var observation: LegacySnapshotObservation {
        switch self {
        case .missing(let generation):
            return LegacySnapshotObservation(generation: generation, strongETag: nil)
        case .found(_, let strongETag, let generation):
            return LegacySnapshotObservation(
                generation: generation,
                strongETag: strongETag
            )
        }
    }

    var writeCondition: LegacySnapshotWriteCondition {
        switch self {
        case .missing(_):
            return .create
        case .found(_, let strongETag, _):
            return .replace(strongETag: strongETag)
        }
    }
}

enum LegacySnapshotWriteCondition: Equatable {
    case create
    case replace(strongETag: String)
}

struct LegacySnapshotVaultRead {
    var vault: SyncVault?
    var writeCondition: LegacySnapshotWriteCondition
    var generation: SyncGeneration

    var observation: LegacySnapshotObservation {
        let strongETag: String?
        switch writeCondition {
        case .create:
            strongETag = nil
        case .replace(let value):
            strongETag = value
        }
        return LegacySnapshotObservation(
            generation: generation,
            strongETag: strongETag
        )
    }
}

struct LegacySnapshotObservation: Equatable, Sendable {
    var generation: SyncGeneration
    var strongETag: String?
}

enum IncrementalHeadRead {
    case unsupported
    case empty(generation: SyncGeneration)
    case head(IncrementalSyncHead, generation: SyncGeneration)

    var generation: SyncGeneration? {
        switch self {
        case .unsupported:
            return nil
        case .empty(let generation), .head(_, let generation):
            return generation
        }
    }

    func hasSameObservation(as other: IncrementalHeadRead) -> Bool {
        switch (self, other) {
        case (.unsupported, .unsupported):
            return true
        case (.empty(let lhsGeneration), .empty(let rhsGeneration)):
            return lhsGeneration == rhsGeneration
        case (
            .head(let lhs, let lhsGeneration),
            .head(let rhs, let rhsGeneration)
        ):
            return lhsGeneration == rhsGeneration &&
                lhs.kind == rhs.kind &&
                lhs.version == rhs.version &&
                lhs.manifestKey == rhs.manifestKey &&
                lhs.updatedAt == rhs.updatedAt
        default:
            return false
        }
    }
}

struct SyncGeneration: Equatable, RawRepresentable, Sendable {
    let rawValue: String

    init?(rawValue: String) {
        let bytes = Array(rawValue.utf8)
        guard bytes.count == 36,
              bytes[8] == 45,
              bytes[13] == 45,
              bytes[18] == 45,
              bytes[23] == 45,
              bytes[14] == 52,
              [56, 57, 65, 66, 97, 98].contains(bytes[19]) else {
            return nil
        }

        for (index, byte) in bytes.enumerated() where ![8, 13, 18, 23].contains(index) {
            guard (byte >= 48 && byte <= 57) ||
                    (byte >= 65 && byte <= 70) ||
                    (byte >= 97 && byte <= 102) else {
                return nil
            }
        }
        self.rawValue = rawValue.lowercased()
    }
}

private let syncGenerationHeader = "x-zerochat-sync-generation"

private func isSafeObjectKey(_ value: String) -> Bool {
    value.range(of: #"^(manifest|chunk|skill|attachment)-[0-9a-fA-F-]+\.json$"#, options: .regularExpression) != nil
}

private func encodeKey(_ key: String) -> String {
    key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
}
