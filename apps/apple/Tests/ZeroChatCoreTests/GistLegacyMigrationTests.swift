import Foundation
import XCTest
@testable import ZeroChatCore

final class GistLegacyMigrationTests: XCTestCase {
    override func tearDown() {
        GistMigrationURLProtocol.reset()
        super.tearDown()
    }

    func testGistRawFileURLsStayOnGitHubGistHost() throws {
        XCTAssertThrowsError(try AppleGistSyncTransport.validatedGithubGistRawURL("https://attacker.example/file"))
        XCTAssertThrowsError(try AppleGistSyncTransport.validatedGithubGistRawURL("https://user@gist.githubusercontent.com/user/gist/raw/file"))
        XCTAssertEqual(
            try AppleGistSyncTransport.validatedGithubGistRawURL("https://gist.githubusercontent.com/user/gist/raw/file").host,
            "gist.githubusercontent.com"
        )
    }

    func testLegacySnapshotMigratesToImmutableOperationAndDeletesBaseFileInOnePatch() async throws {
        let passphrase = "migration-test-passphrase"
        let crypto = CryptoEngine()
        let legacyEnvelope = try await crypto.encryptVault(
            migrationVault(updatedAt: 10),
            passphrase: passphrase
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let legacyContent = try XCTUnwrap(
            String(data: try encoder.encode(legacyEnvelope), encoding: .utf8)
        )
        GistMigrationURLProtocol.configure(
            gistId: "gist-legacy-migration-test",
            files: [
                "zerochat-sync.json": legacyContent,
                "notes.txt": "unrelated",
            ]
        )

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GistMigrationURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = SyncClient(session: session)

        let result = try await client.syncGistVault(
            vault: migrationVault(updatedAt: 20),
            passphrase: passphrase,
            gistId: "gist-legacy-migration-test",
            gistFile: "zerochat-sync.json",
            token: "test-token",
            firstSyncStrategy: .useLocal,
            hasCompletedSync: false,
            hasLocalUserContent: true
        )

        XCTAssertEqual(result.data.sync.gistId, "gist-legacy-migration-test")
        let patchBody = try XCTUnwrap(GistMigrationURLProtocol.capturedPatchBodies().first)
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: patchBody) as? [String: Any]
        )
        let files = try XCTUnwrap(json["files"] as? [String: Any])
        XCTAssertTrue(files["zerochat-sync.json"] is NSNull)
        XCTAssertNil(files["notes.txt"])
        let operationFiles = files.keys.filter {
            gistOperationId(fileName: "zerochat-sync.json", candidate: $0) != nil
        }
        XCTAssertEqual(operationFiles.count, 1)
        XCTAssertNotNil((files[operationFiles[0]] as? [String: Any])?["content"] as? String)
        XCTAssertEqual(GistMigrationURLProtocol.capturedMethods(), ["GET", "PATCH"])
    }

    func testStateWriteCompactsObservedImmutableOperationAndPreservesUserFile() async throws {
        let passphrase = "compaction-test-passphrase"
        let crypto = CryptoEngine()
        let previous = try createGistStateOperation(
            parents: [],
            vault: migrationVault(updatedAt: 10),
            tombstones: []
        )
        let envelope = try await crypto.encryptObject(
            previous,
            passphrase: passphrase,
            objectType: gistOperationObjectType,
            updatedAt: 10
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let content = try XCTUnwrap(String(data: try encoder.encode(envelope), encoding: .utf8))
        let previousFile = gistOperationFileName("zerochat-sync.json", id: previous.id)
        GistMigrationURLProtocol.configure(
            gistId: "gist-compaction-test",
            files: [
                previousFile: content,
                "notes.txt": "unrelated",
            ]
        )

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [GistMigrationURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        _ = try await SyncClient(session: session).syncGistVault(
            vault: migrationVault(updatedAt: 20),
            passphrase: passphrase,
            gistId: "gist-compaction-test",
            gistFile: "zerochat-sync.json",
            token: "test-token",
            firstSyncStrategy: .useLocal,
            hasCompletedSync: true,
            hasLocalUserContent: true
        )

        let patchBody = try XCTUnwrap(GistMigrationURLProtocol.capturedPatchBodies().first)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: patchBody) as? [String: Any])
        let files = try XCTUnwrap(json["files"] as? [String: Any])
        XCTAssertTrue(files[previousFile] is NSNull)
        XCTAssertNil(files["notes.txt"])
        XCTAssertEqual(
            files.keys.filter {
                gistOperationId(fileName: "zerochat-sync.json", candidate: $0) != nil
                    && $0 != previousFile
            }.count,
            1
        )
        XCTAssertEqual(GistMigrationURLProtocol.capturedMethods(), ["GET", "PATCH"])
    }
}

private final class GistMigrationURLProtocol: URLProtocol {
    nonisolated(unsafe) private static var gistId = ""
    nonisolated(unsafe) private static var files: [String: String] = [:]
    nonisolated(unsafe) private static var methods: [String] = []
    nonisolated(unsafe) private static var patchBodies: [Data] = []
    nonisolated(unsafe) private static let lock = NSLock()

    static func configure(gistId: String, files: [String: String]) {
        lock.withLock {
            self.gistId = gistId
            self.files = files
            methods = []
            patchBodies = []
        }
    }

    static func reset() {
        configure(gistId: "", files: [:])
    }

    static func capturedMethods() -> [String] {
        lock.withLock { methods }
    }

    static func capturedPatchBodies() -> [Data] {
        lock.withLock { patchBodies }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "api.github.com"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        let patchBody = method == "PATCH" ? requestBody() : nil
        let responseState = Self.lock.withLock { () -> (String, [String: String]) in
            Self.methods.append(method)
            if let body = patchBody {
                Self.patchBodies.append(body)
            }
            return (Self.gistId, Self.files)
        }
        let body: Data
        if method == "GET" {
            let files = responseState.1.mapValues { content in
                [
                    "content": content,
                    "truncated": false,
                ] as [String: Any]
            }
            body = try! JSONSerialization.data(withJSONObject: [
                "id": responseState.0,
                "files": files,
            ])
        } else {
            body = Data("{}".utf8)
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func requestBody() -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { return nil }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private func migrationVault(updatedAt: Int64) -> SyncVault {
    let provider = ProviderConfig(
        id: "provider",
        name: "Provider",
        kind: .openAICompatible,
        baseUrl: "https://example.test/v1",
        model: "model",
        enabled: true,
        needsApiKey: true,
        createdAt: 1,
        updatedAt: updatedAt
    )
    return SyncVault(
        data: AppSnapshot(
            providers: [provider],
            conversations: [
                Conversation(
                    id: "conversation",
                    title: "Conversation",
                    providerId: provider.id,
                    model: provider.model,
                    messages: [],
                    createdAt: 1,
                    updatedAt: updatedAt
                ),
            ],
            skills: [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(mode: "gist", autoSync: true, encryptionEnabled: true, gistFile: nil),
            preferences: Preferences(firstRunDone: true),
            updatedAt: updatedAt
        )
    )
}
