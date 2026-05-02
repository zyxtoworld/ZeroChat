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
        guard let endpoint = URL(string: workerEndpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/snapshot") else {
            throw SyncError.missingEndpoint
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
}

public enum SyncError: Error {
    case missingEndpoint
    case writeFailed(Int)
}
