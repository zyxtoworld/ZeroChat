import Foundation

public actor SyncClient {
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(session: URLSession = .shared) {
        self.session = session
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public func syncCloudflare(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String
    ) async throws -> EncryptedSnapshotEnvelope {
        let endpoint = try snapshotEndpoint(workerEndpoint)
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SyncError.missingToken
        }

        var readRequest = URLRequest(url: endpoint)
        readRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (remoteData, readResponse) = try await session.data(for: readRequest)
        if let http = readResponse as? HTTPURLResponse, http.statusCode == 200 {
            let remote = try decoder.decode(EncryptedSnapshotEnvelope.self, from: remoteData)
            if remote.kind == "zerochat.encryptedSnapshot", remote.updatedAt > envelope.updatedAt {
                return remote
            }
        }

        var writeRequest = URLRequest(url: endpoint)
        writeRequest.httpMethod = "PUT"
        writeRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        writeRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        writeRequest.httpBody = try encoder.encode(envelope)

        let (_, writeResponse) = try await session.data(for: writeRequest)
        if let http = writeResponse as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw SyncError.writeFailed(http.statusCode)
        }
        return envelope
    }

    private func snapshotEndpoint(_ value: String) throws -> URL {
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

        components.query = nil
        components.fragment = nil

        guard var base = components.url?.absoluteString else {
            throw SyncError.missingEndpoint
        }

        while base.hasSuffix("/") {
            base.removeLast()
        }

        guard let endpoint = URL(string: base + "/snapshot") else {
            throw SyncError.missingEndpoint
        }

        return endpoint
    }
}

public enum SyncError: Error {
    case missingEndpoint
    case missingToken
    case unsafeEndpoint
    case writeFailed(Int)
}
