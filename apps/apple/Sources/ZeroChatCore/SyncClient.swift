import Foundation

public actor SyncClient {
    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(session: URLSession = .shared) {
        self.session = session
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }

    public func syncCloudflare(snapshot: AppSnapshot, token: String) async throws -> AppSnapshot {
        guard let workerEndpoint = snapshot.sync.workerEndpoint,
              let endpoint = URL(string: workerEndpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/snapshot") else {
            throw SyncError.missingEndpoint
        }

        var readRequest = URLRequest(url: endpoint)
        readRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (remoteData, readResponse) = try await session.data(for: readRequest)
        if let http = readResponse as? HTTPURLResponse, http.statusCode == 200 {
            let remote = try decoder.decode(AppSnapshot.self, from: remoteData)
            if remote.updatedAt > snapshot.updatedAt {
                var accepted = remote
                accepted.sync.lastSyncAt = Int64(Date().timeIntervalSince1970 * 1000)
                accepted.sync.lastSyncStatus = "已采用远端较新的数据"
                return accepted
            }
        }

        var synced = snapshot
        synced.sync.lastSyncAt = Int64(Date().timeIntervalSince1970 * 1000)
        synced.sync.lastSyncStatus = "同步完成"

        var writeRequest = URLRequest(url: endpoint)
        writeRequest.httpMethod = "PUT"
        writeRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        writeRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        writeRequest.httpBody = try encoder.encode(synced)

        _ = try await session.data(for: writeRequest)
        return synced
    }
}

public enum SyncError: Error {
    case missingEndpoint
}
