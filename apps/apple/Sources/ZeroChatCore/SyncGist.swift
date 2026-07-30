import Foundation

enum GistFileChange {
    case content(String)
    case delete
}

struct AppleGistSyncTransport {
    private let session: CredentialBoundURLSession
    private let crypto: CryptoEngine
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(session: CredentialBoundURLSession, crypto: CryptoEngine) {
        self.session = session
        self.crypto = crypto
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    }

    func readRemote(
        gistId: String,
        fileName: String,
        token: String,
        passphrase: String,
        allowMissing: Bool = false
    ) async throws -> GistRemoteState? {
        guard let gist = try await readGist(gistId: gistId, token: token, allowMissing: allowMissing) else {
            return nil
        }
        return try await decodeRemoteGist(
            gist,
            fileName: fileName,
            token: token,
            passphrase: passphrase
        )
    }

    func create(
        fileName: String,
        operation: GistOperation,
        passphrase: String,
        token: String,
        updatedAt: Int64
    ) async throws -> String {
        guard let endpoint = URL(string: "https://api.github.com/gists") else {
            throw SyncError.missingEndpoint
        }
        let operationFile = gistOperationFileName(fileName, id: operation.id)
        let content = try await serializedOperation(
            operation,
            passphrase: passphrase,
            updatedAt: updatedAt
        )
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        applyGitHubHeaders(to: &request, token: token, json: true)
        request.httpBody = try JSONSerialization.data(
            withJSONObject: [
                "description": "ZeroChat encrypted sync vault",
                "public": false,
                "files": [operationFile: ["content": content]],
            ]
        )

        let (data, response) = try await session.boundedData(
            for: request,
            successMaxBytes: maxSyncGistResponseBytes,
            errorMaxBytes: maxSyncErrorBodyBytes,
            successLabel: "GitHub Gist create response",
            errorLabel: "GitHub Gist create error"
        )
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw SyncError.writeFailed((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        let gist = try decoder.decode(GithubGistResponse.self, from: data)
        guard let id = try Self.normalizedGistId(gist.id) else {
            throw SyncError.missingGistId
        }
        return id
    }

    func publishState(
        gistId: String,
        fileName: String,
        token: String,
        passphrase: String,
        parents: [String],
        vault: SyncVault,
        tombstones: [GistTombstone],
        deleteFiles: [String]
    ) async throws -> GistOperation {
        let operation = try createGistStateOperation(
            parents: parents,
            vault: vault,
            tombstones: tombstones
        )
        let operationFile = gistOperationFileName(fileName, id: operation.id)
        var changes: [String: GistFileChange] = [
            operationFile: .content(try await serializedOperation(
                operation,
                passphrase: passphrase,
                updatedAt: operation.vault?.data.updatedAt ?? vault.data.updatedAt
            )),
        ]
        for candidate in deleteFiles where candidate != operationFile {
            changes[candidate] = .delete
        }
        try await patch(gistId: gistId, token: token, files: changes)
        return operation
    }

    func clear(
        gistId: String,
        fileName: String,
        token: String,
        passphrase: String,
        updatedAt: Int64
    ) async throws -> Bool {
        guard let gist = try await readGist(gistId: gistId, token: token, allowMissing: true) else {
            return false
        }
        let managedFiles = gist.files?.keys.filter {
            isManagedGistFile(fileName: fileName, candidate: $0)
        } ?? []
        let parents: [String]
        do {
            parents = try await decodeRemoteGist(
                gist,
                fileName: fileName,
                token: token,
                passphrase: passphrase
            ).heads
        } catch {
            try Task.checkCancellation()
            parents = []
        }

        let operation = try createGistClearOperation(parents: parents)
        let clearFile = gistOperationFileName(fileName, id: operation.id)
        var changes: [String: GistFileChange] = [
            clearFile: .content(try await serializedOperation(
                operation,
                passphrase: passphrase,
                updatedAt: updatedAt
            )),
        ]
        for candidate in managedFiles where candidate != clearFile {
            changes[candidate] = .delete
        }
        try await patch(gistId: gistId, token: token, files: changes)
        return true
    }

    static func configuredVault(
        _ vault: SyncVault,
        gistId: String?,
        fileName: String,
        status: String,
        syncedAt: Int64
    ) -> SyncVault {
        var copy = vault
        copy.data.sync.mode = "gist"
        copy.data.sync.encryptionEnabled = true
        copy.data.sync.gistId = gistId
        copy.data.sync.gistFile = fileName
        copy.data.sync.lastSyncAt = syncedAt
        copy.data.sync.lastSyncStatus = status
        return copy
    }

    static func localVault(_ vault: SyncVault, gistId: String?, fileName: String) -> SyncVault {
        var copy = vault
        copy.data.sync.mode = "gist"
        copy.data.sync.encryptionEnabled = true
        copy.data.sync.gistId = gistId
        copy.data.sync.gistFile = fileName
        return normalizeGistVault(copy)
    }

    static func normalizedGitHubToken(_ value: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SyncError.missingGitHubToken }
        return trimmed
    }

    static func normalizedGistId(_ value: String?) throws -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else {
            throw SyncError.invalidGistId
        }
        return trimmed
    }

    static func normalizedGistFile(_ value: String?) throws -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let fileName = trimmed.isEmpty ? "zerochat-sync.json" : trimmed
        guard !fileName.contains("/"), !fileName.contains("\\") else {
            throw SyncError.invalidGistFile
        }
        return fileName
    }

    private func readGist(
        gistId: String,
        token: String,
        allowMissing: Bool
    ) async throws -> GithubGistResponse? {
        var request = URLRequest(url: try Self.gistEndpoint(gistId))
        applyGitHubHeaders(to: &request, token: token)
        let (data, response) = try await session.boundedData(
            for: request,
            successMaxBytes: maxSyncGistResponseBytes,
            errorMaxBytes: maxSyncErrorBodyBytes,
            successLabel: "GitHub Gist sync response",
            errorLabel: "GitHub Gist sync error"
        )
        guard let http = response as? HTTPURLResponse else {
            throw SyncError.readFailed(-1)
        }
        if allowMissing, http.statusCode == 404 { return nil }
        guard (200..<300).contains(http.statusCode) else {
            throw SyncError.readFailed(http.statusCode)
        }
        return try decoder.decode(GithubGistResponse.self, from: data)
    }

    private func decodeRemoteGist(
        _ gist: GithubGistResponse,
        fileName: String,
        token: String,
        passphrase: String
    ) async throws -> GistRemoteState {
        let files = gist.files ?? [:]
        let managedFiles = files.keys.filter {
            isManagedGistFile(fileName: fileName, candidate: $0)
        }
        var operations: [String: GistOperation] = [:]

        for candidate in managedFiles where candidate != fileName {
            guard let expectedId = gistOperationId(fileName: fileName, candidate: candidate),
                  let content = try await readFileContent(files[candidate], token: token),
                  !content.isEmpty else {
                throw SyncError.badGistOperation
            }
            try assertSyncTextSize(
                content,
                maxBytes: maxSyncIncrementalObjectBytes,
                label: "Encrypted Gist sync operation"
            )
            let envelope: EncryptedObjectEnvelope
            do {
                envelope = try decoder.decode(EncryptedObjectEnvelope.self, from: Data(content.utf8))
            } catch {
                throw SyncError.badGistOperation
            }
            let decoded = try await crypto.decryptObject(
                GistOperation.self,
                envelope: envelope,
                passphrase: passphrase,
                expectedObjectType: gistOperationObjectType
            )
            operations[expectedId] = try validateGistOperation(decoded, expectedId: expectedId)
        }

        if !operations.isEmpty {
            let materialized = try materializeGistOperations(operations)
            return GistRemoteState(
                heads: materialized.heads,
                legacy: false,
                managedFiles: Array(managedFiles),
                operations: operations,
                tombstones: materialized.tombstones,
                vault: materialized.vault
            )
        }

        guard let legacyContent = try await readFileContent(files[fileName], token: token),
              !legacyContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return GistRemoteState(
                heads: [],
                legacy: false,
                managedFiles: Array(managedFiles),
                operations: [:],
                tombstones: [],
                vault: nil
            )
        }
        try assertSyncTextSize(
            legacyContent,
            maxBytes: maxSyncSnapshotBytes,
            label: "Remote sync snapshot"
        )
        let legacyEnvelope: EncryptedSnapshotEnvelope
        do {
            legacyEnvelope = try decoder.decode(EncryptedSnapshotEnvelope.self, from: Data(legacyContent.utf8))
        } catch {
            throw SyncError.badGistOperation
        }
        let legacyVault = normalizeGistVault(try await crypto.decryptVault(legacyEnvelope, passphrase: passphrase))
        let legacyOperation = try createGistStateOperation(parents: [], vault: legacyVault, tombstones: [])
        return GistRemoteState(
            heads: [legacyOperation.id],
            legacy: true,
            managedFiles: Array(managedFiles),
            operations: [legacyOperation.id: legacyOperation],
            tombstones: [],
            vault: legacyVault
        )
    }

    private func readFileContent(_ file: GithubGistFile?, token: String) async throws -> String? {
        guard let file else { return nil }
        if file.truncated != true, let content = file.content { return content }
        guard let raw = file.rawUrl else { throw SyncError.badGistOperation }
        let endpoint = try Self.validatedGithubGistRawURL(raw)
        var request = URLRequest(url: endpoint)
        applyGitHubHeaders(to: &request, token: token)
        let (data, response) = try await session.boundedData(
            for: request,
            successMaxBytes: maxSyncIncrementalObjectBytes,
            errorMaxBytes: maxSyncErrorBodyBytes,
            successLabel: "GitHub Gist sync file",
            errorLabel: "GitHub Gist sync file error"
        )
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw SyncError.readFailed((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        guard let content = String(data: data, encoding: .utf8) else {
            throw SyncError.badGistOperation
        }
        return content
    }

    private func serializedOperation(
        _ operation: GistOperation,
        passphrase: String,
        updatedAt: Int64
    ) async throws -> String {
        let envelope = try await crypto.encryptObject(
            operation,
            passphrase: passphrase,
            objectType: gistOperationObjectType,
            updatedAt: updatedAt
        )
        let data = try encoder.encode(envelope)
        try assertSyncDataSize(
            data,
            maxBytes: maxSyncIncrementalObjectBytes,
            label: "Encrypted Gist sync operation"
        )
        guard let content = String(data: data, encoding: .utf8) else {
            throw SyncError.badGistOperation
        }
        return content
    }

    private func patch(gistId: String, token: String, files: [String: GistFileChange]) async throws {
        var bodyFiles: [String: Any] = [:]
        for (fileName, change) in files {
            switch change {
            case .content(let content): bodyFiles[fileName] = ["content": content]
            case .delete: bodyFiles[fileName] = NSNull()
            }
        }
        var request = URLRequest(url: try Self.gistEndpoint(gistId))
        request.httpMethod = "PATCH"
        applyGitHubHeaders(to: &request, token: token, json: true)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["files": bodyFiles])
        let (_, response) = try await session.boundedData(
            for: request,
            maxBytes: maxSyncErrorBodyBytes,
            label: "GitHub Gist write response"
        )
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw SyncError.writeFailed((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }

    private func applyGitHubHeaders(to request: inout URLRequest, token: String, json: Bool = false) {
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if json { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    }

    static func validatedGithubGistRawURL(_ rawURL: String) throws -> URL {
        guard let components = URLComponents(string: rawURL),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == "gist.githubusercontent.com",
              components.user == nil,
              components.password == nil,
              components.port == nil,
              !components.path.isEmpty,
              components.path != "/",
              let endpoint = components.url else {
            throw SyncError.badGistOperation
        }
        return endpoint
    }

    private static func gistEndpoint(_ gistId: String) throws -> URL {
        guard let encoded = gistId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let endpoint = URL(string: "https://api.github.com/gists/\(encoded)") else {
            throw SyncError.invalidGistId
        }
        return endpoint
    }
}

private struct GithubGistResponse: Decodable {
    var id: String?
    var files: [String: GithubGistFile]?
}

private struct GithubGistFile: Decodable {
    var content: String?
    var rawUrl: String?
    var truncated: Bool?

    private enum CodingKeys: String, CodingKey {
        case content
        case rawUrl = "raw_url"
        case truncated
    }
}
