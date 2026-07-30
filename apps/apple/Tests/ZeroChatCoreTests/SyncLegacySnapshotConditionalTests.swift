import Foundation
import XCTest
@testable import ZeroChatCore

final class SyncLegacySnapshotConditionalTests: XCTestCase {
    private let strongETag = "\"snapshot-sha256-\(String(repeating: "a", count: 64))\""
    private let generation = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"

    override func tearDown() {
        LegacySnapshotURLProtocol.reset()
        super.tearDown()
    }

    func testExistingSnapshotReplacementUsesStrongETagFromRead() async throws {
        LegacySnapshotURLProtocol.configure(
            getStatus: 200,
            getETag: strongETag,
            putStatus: 200
        )

        try await client().writeCloudflareSnapshot(
            envelope: testEnvelope(),
            workerEndpoint: "https://legacy-sync.example.test",
            token: "test-token"
        )

        let put = try XCTUnwrap(
            LegacySnapshotURLProtocol.capturedRequests().first {
                $0.method == "PUT" && $0.path == "/snapshot"
            }
        )
        XCTAssertEqual(put.ifMatch, strongETag)
        XCTAssertNil(put.ifNoneMatch)
        XCTAssertEqual(put.syncGeneration, generation)
    }

    func testMissingSnapshotCreationUsesIfNoneMatchStar() async throws {
        LegacySnapshotURLProtocol.configure(getStatus: 404, getETag: nil, putStatus: 200)

        try await client().writeCloudflareSnapshot(
            envelope: testEnvelope(),
            workerEndpoint: "https://legacy-sync.example.test",
            token: "test-token"
        )

        let put = try XCTUnwrap(
            LegacySnapshotURLProtocol.capturedRequests().first {
                $0.method == "PUT" && $0.path == "/snapshot"
            }
        )
        XCTAssertNil(put.ifMatch)
        XCTAssertEqual(put.ifNoneMatch, "*")
        XCTAssertEqual(put.syncGeneration, generation)
    }

    func testSnapshotReadFailsClosedWithoutExactStrongETag() async {
        let invalidETags: [String?] = [
            nil,
            "W/\(strongETag)",
            "\"other-sha256-\(String(repeating: "a", count: 64))\"",
            "\"snapshot-sha256-short\"",
            "\"snapshot-sha256-\(String(repeating: "z", count: 64))\"",
            "snapshot-sha256-\(String(repeating: "a", count: 64))",
        ]

        for invalidETag in invalidETags {
            LegacySnapshotURLProtocol.configure(
                getStatus: 200,
                getETag: invalidETag,
                putStatus: 200
            )

            do {
                _ = try await transport().readSnapshotEnvelope(
                    endpoint: URL(string: "https://legacy-sync.example.test")!,
                    token: "test-token"
                )
                XCTFail("Expected invalid ETag to fail closed: \(invalidETag ?? "nil")")
            } catch SyncError.badSnapshotETag {
                // Expected.
            } catch {
                XCTFail("Expected SyncError.badSnapshotETag, received \(error)")
            }
        }
    }

    func testStrongETagValidatorAcceptsOnlyAsciiSha256Form() {
        XCTAssertEqual(
            AppleCloudflareSyncTransport.validatedSnapshotETag(strongETag),
            strongETag
        )
        XCTAssertNotNil(
            AppleCloudflareSyncTransport.validatedSnapshotETag(
                "\"snapshot-sha256-\(String(repeating: "F", count: 64))\""
            )
        )
        XCTAssertNil(
            AppleCloudflareSyncTransport.validatedSnapshotETag(
                "\"snapshot-sha256-\(String(repeating: "ａ", count: 64))\""
            )
        )
    }

    func testSyncGenerationValidatorAcceptsOnlyCanonicalUUIDv4Shape() {
        XCTAssertEqual(
            AppleCloudflareSyncTransport.validatedSyncGeneration(generation)?.rawValue,
            generation
        )
        XCTAssertEqual(
            AppleCloudflareSyncTransport.validatedSyncGeneration(
                generation.uppercased()
            )?.rawValue,
            generation
        )
        for invalid in [
            "4f70f3a4-a836-3e90-9e14-8acbe4d9b2aa",
            "4f70f3a4-a836-4e90-7e14-8acbe4d9b2aa",
            "4f70f3a4a8364e909e148acbe4d9b2aa",
            "4f70f3a4-a836-4e90-9e14-8acbe4d9b2ag",
            "４f70f3a4-a836-4e90-9e14-8acbe4d9b2aa",
        ] {
            XCTAssertNil(AppleCloudflareSyncTransport.validatedSyncGeneration(invalid))
        }
    }

    func testConflictStatusesMapToRemoteUpdated() async {
        for status in [409, 412, 428] {
            LegacySnapshotURLProtocol.configure(
                getStatus: 200,
                getETag: strongETag,
                putStatus: status
            )

            do {
                try await client().writeCloudflareSnapshot(
                    envelope: testEnvelope(),
                    workerEndpoint: "https://legacy-sync.example.test",
                    token: "test-token"
                )
                XCTFail("Expected HTTP \(status) to report a remote update")
            } catch SyncError.remoteUpdated {
                // Expected.
            } catch {
                XCTFail("Expected SyncError.remoteUpdated, received \(error)")
            }
        }
    }

    func testSnapshotReadFailsClosedWithoutUUIDv4GenerationOn200And404() async {
        let invalidGenerations: [String?] = [
            nil,
            "",
            "4f70f3a4-a836-3e90-9e14-8acbe4d9b2aa",
            "4f70f3a4-a836-4e90-7e14-8acbe4d9b2aa",
            "4f70f3a4a8364e909e148acbe4d9b2aa",
            "４f70f3a4-a836-4e90-9e14-8acbe4d9b2aa",
        ]

        for status in [200, 404] {
            for invalidGeneration in invalidGenerations {
                LegacySnapshotURLProtocol.configure(
                    getStatus: status,
                    getETag: status == 200 ? strongETag : nil,
                    putStatus: 200,
                    snapshotGeneration: invalidGeneration
                )

                do {
                    _ = try await transport().readSnapshotEnvelope(
                        endpoint: URL(string: "https://legacy-sync.example.test")!,
                        token: "test-token"
                    )
                    XCTFail("Expected invalid generation to fail closed")
                } catch SyncError.badSyncGeneration {
                    // Expected.
                } catch {
                    XCTFail("Expected SyncError.badSyncGeneration, received \(error)")
                }
            }
        }
    }

    func testSnapshotFinalObservationRejectsWriterUpdateAndClear() async throws {
        let changedETag = "\"snapshot-sha256-\(String(repeating: "b", count: 64))\""
        let rotatedGeneration = "a0f38d9d-bd2a-4aaf-b7db-eaa0c24fd869"
        let scenarios: [[LegacySnapshotURLProtocol.SnapshotResponse]] = [
            [
                .init(status: 200, etag: strongETag, generation: generation),
                .init(status: 200, etag: changedETag, generation: generation),
            ],
            [
                .init(status: 200, etag: strongETag, generation: generation),
                .init(status: 404, etag: nil, generation: rotatedGeneration),
            ],
        ]

        for responses in scenarios {
            LegacySnapshotURLProtocol.configureSnapshotSequence(responses)
            let transport = transport()
            let initial = try await transport.readSnapshotEnvelope(
                endpoint: URL(string: "https://legacy-sync.example.test")!,
                token: "test-token"
            )

            do {
                try await transport.revalidateSnapshotObservation(
                    endpoint: URL(string: "https://legacy-sync.example.test")!,
                    token: "test-token",
                    expected: initial.observation
                )
                XCTFail("Expected changed snapshot observation to be rejected")
            } catch SyncError.remoteUpdated {
                // Expected.
            } catch {
                XCTFail("Expected SyncError.remoteUpdated, received \(error)")
            }
        }
    }

    func testHeadAndSnapshotGenerationMismatchRejectsWrite() async {
        LegacySnapshotURLProtocol.configure(
            getStatus: 404,
            getETag: nil,
            putStatus: 200,
            headStatus: 404,
            headGeneration: generation,
            snapshotGeneration: "a0f38d9d-bd2a-4aaf-b7db-eaa0c24fd869"
        )

        do {
            try await client().writeCloudflareSnapshot(
                envelope: testEnvelope(),
                workerEndpoint: "https://legacy-sync.example.test",
                token: "test-token"
            )
            XCTFail("Expected cross-generation read to fail")
        } catch SyncError.remoteUpdated {
            // Expected.
        } catch {
            XCTFail("Expected SyncError.remoteUpdated, received \(error)")
        }

        XCTAssertFalse(
            LegacySnapshotURLProtocol.capturedRequests().contains {
                $0.method == "PUT" && $0.path == "/snapshot"
            }
        )
    }

    func testVaultSyncRetriesWhenHeadAndSnapshotGenerationsDiffer() async {
        LegacySnapshotURLProtocol.configure(
            getStatus: 404,
            getETag: nil,
            putStatus: 200,
            headStatus: 404,
            headGeneration: generation,
            snapshotGeneration: "a0f38d9d-bd2a-4aaf-b7db-eaa0c24fd869"
        )

        do {
            _ = try await client().syncCloudflareVault(
                vault: SyncVault(data: AppSnapshot(updatedAt: 1)),
                passphrase: "generation-retry-test",
                workerEndpoint: "https://legacy-sync.example.test",
                token: "test-token"
            )
            XCTFail("Expected cross-generation reads to exhaust the retry boundary")
        } catch SyncError.remoteUpdated {
            // Expected.
        } catch {
            XCTFail("Expected SyncError.remoteUpdated, received \(error)")
        }

        let requests = LegacySnapshotURLProtocol.capturedRequests()
        XCTAssertEqual(
            requests.filter { $0.method == "GET" && $0.path == "/sync/head" }.count,
            3
        )
        XCTAssertEqual(
            requests.filter { $0.method == "GET" && $0.path == "/snapshot" }.count,
            3
        )
        XCTAssertFalse(requests.contains { $0.method == "PUT" })
    }

    func testBulkClearOmitsOldGenerationAndRotatesGenerationEveryTime() async throws {
        let initialGeneration = LegacySnapshotURLProtocol.currentGeneration()

        try await client().clearCloudflare(
            workerEndpoint: "https://legacy-sync.example.test",
            token: "test-token"
        )

        let clear = try XCTUnwrap(
            LegacySnapshotURLProtocol.capturedRequests().first {
                $0.method == "DELETE" && $0.path == "/sync/clear"
            }
        )
        XCTAssertNil(clear.syncGeneration)
        let firstRotatedGeneration = LegacySnapshotURLProtocol.currentGeneration()
        XCTAssertNotEqual(firstRotatedGeneration, initialGeneration)
        XCTAssertNotNil(SyncGeneration(rawValue: firstRotatedGeneration))

        try await client().clearCloudflare(
            workerEndpoint: "https://legacy-sync.example.test",
            token: "test-token"
        )
        let secondRotatedGeneration = LegacySnapshotURLProtocol.currentGeneration()
        XCTAssertNotEqual(secondRotatedGeneration, firstRotatedGeneration)
        XCTAssertNotNil(SyncGeneration(rawValue: secondRotatedGeneration))
        XCTAssertTrue(
            LegacySnapshotURLProtocol.capturedRequests()
                .filter { $0.method == "DELETE" && $0.path == "/sync/clear" }
                .allSatisfy { $0.syncGeneration == nil }
        )
    }

    private func client() -> SyncClient {
        SyncClient(session: testSession())
    }

    private func transport() -> AppleCloudflareSyncTransport {
        AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(testSession()),
            crypto: CryptoEngine()
        )
    }

    private func testSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [LegacySnapshotURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func testEnvelope() -> EncryptedSnapshotEnvelope {
        EncryptedSnapshotEnvelope(
            kind: "zerochat.encryptedSnapshot",
            version: 1,
            encryptedAt: 1,
            updatedAt: 1,
            crypto: EnvelopeCrypto(
                cipher: "AES-256-GCM",
                kdf: "PBKDF2-SHA256",
                iterations: 600_000,
                salt: "AA==",
                iv: "AA==",
                aad: "AA=="
            ),
            payload: "AA=="
        )
    }
}

private final class LegacySnapshotURLProtocol: URLProtocol {
    struct SnapshotResponse: Sendable {
        var status: Int
        var etag: String?
        var generation: String?
    }

    struct CapturedRequest: Sendable {
        var method: String
        var path: String
        var ifMatch: String?
        var ifNoneMatch: String?
        var syncGeneration: String?
    }

    nonisolated(unsafe) private static var requests: [CapturedRequest] = []
    nonisolated(unsafe) private static var getStatus = 404
    nonisolated(unsafe) private static var getETag: String?
    nonisolated(unsafe) private static var putStatus = 200
    nonisolated(unsafe) private static var headStatus = 501
    nonisolated(unsafe) private static var headGeneration: String?
    nonisolated(unsafe) private static var currentGenerationValue =
        "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
    nonisolated(unsafe) private static var snapshotGeneration: String? =
        "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
    nonisolated(unsafe) private static var snapshotBody: Data?
    nonisolated(unsafe) private static var objects: [String: Data] = [:]
    nonisolated(unsafe) private static var snapshotSequence: [SnapshotResponse] = []
    nonisolated(unsafe) private static var snapshotReadIndex = 0
    nonisolated(unsafe) private static let lock = NSLock()

    static func reset() {
        lock.withLock {
            requests = []
            getStatus = 404
            getETag = nil
            putStatus = 200
            headStatus = 501
            headGeneration = nil
            currentGenerationValue = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
            snapshotGeneration = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
            snapshotBody = nil
            objects = [:]
            snapshotSequence = []
            snapshotReadIndex = 0
        }
    }

    static func configure(
        getStatus: Int,
        getETag: String?,
        putStatus: Int,
        headStatus: Int = 501,
        headGeneration: String? = nil,
        snapshotGeneration: String? = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
    ) {
        lock.withLock {
            requests = []
            Self.getStatus = getStatus
            Self.getETag = getETag
            Self.putStatus = putStatus
            Self.headStatus = headStatus
            Self.headGeneration = headGeneration
            Self.currentGenerationValue = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
            Self.snapshotGeneration = snapshotGeneration
            Self.snapshotBody = nil
            Self.objects = [:]
            snapshotSequence = []
            snapshotReadIndex = 0
        }
    }

    static func configureSnapshotSequence(_ responses: [SnapshotResponse]) {
        precondition(!responses.isEmpty)
        lock.withLock {
            requests = []
            snapshotSequence = responses
            snapshotReadIndex = 0
        }
    }

    static func capturedRequests() -> [CapturedRequest] {
        lock.withLock { requests }
    }

    static func currentGeneration() -> String {
        lock.withLock { currentGenerationValue }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "legacy-sync.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        let path = request.url?.path ?? ""
        let requestBody = method == "PUT" ? Self.bodyData(for: request) : nil
        let state = Self.lock.withLock { () -> (Int, String?, String?) in
            let requestGeneration = request.value(
                forHTTPHeaderField: "x-zerochat-sync-generation"
            )
            Self.requests.append(CapturedRequest(
                method: method,
                path: path,
                ifMatch: request.value(forHTTPHeaderField: "If-Match"),
                ifNoneMatch: request.value(forHTTPHeaderField: "If-None-Match"),
                syncGeneration: requestGeneration
            ))

            if method == "DELETE", path == "/sync/clear" {
                Self.getStatus = 404
                Self.getETag = nil
                Self.headStatus = 404
                Self.snapshotBody = nil
                Self.objects = [:]
                Self.snapshotSequence = []
                Self.snapshotReadIndex = 0
                Self.rotateGeneration()
                Self.headGeneration = Self.currentGenerationValue
                Self.snapshotGeneration = Self.currentGenerationValue
                return (200, nil, Self.currentGenerationValue)
            }

            if Self.isGenerationProtectedMutation(method: method, path: path) {
                guard let requestGeneration else {
                    return (428, nil, nil)
                }
                guard requestGeneration == Self.currentGenerationValue else {
                    return (412, nil, nil)
                }
            }

            if method == "GET", path == "/sync/head" {
                return (Self.headStatus, nil, Self.headGeneration)
            }
            if method == "GET", path == "/snapshot" {
                if !Self.snapshotSequence.isEmpty {
                    let index = min(Self.snapshotReadIndex, Self.snapshotSequence.count - 1)
                    Self.snapshotReadIndex += 1
                    let response = Self.snapshotSequence[index]
                    return (response.status, response.etag, response.generation)
                }
                return (Self.getStatus, Self.getETag, Self.snapshotGeneration)
            }
            if method == "PUT", path == "/snapshot" {
                if (200..<300).contains(Self.putStatus) {
                    Self.snapshotBody = requestBody
                    Self.getStatus = 200
                    Self.snapshotGeneration = Self.currentGenerationValue
                }
                return (Self.putStatus, nil, nil)
            }
            if method == "DELETE", path == "/snapshot" {
                Self.snapshotBody = nil
                Self.getStatus = 404
                Self.getETag = nil
                Self.snapshotGeneration = Self.currentGenerationValue
                return (204, nil, nil)
            }
            if method == "PUT", path == "/sync/head" {
                Self.headStatus = 200
                Self.headGeneration = Self.currentGenerationValue
                return (200, nil, nil)
            }
            if method == "DELETE", path == "/sync/head" {
                Self.headStatus = 404
                Self.headGeneration = Self.currentGenerationValue
                return (204, nil, nil)
            }
            if method == "PUT", path.hasPrefix("/sync/object/") {
                Self.objects[path] = requestBody ?? Data()
                return (200, nil, nil)
            }
            if method == "DELETE", path.hasPrefix("/sync/object/") {
                Self.objects.removeValue(forKey: path)
                return (204, nil, nil)
            }
            return (404, nil, nil)
        }

        var headers = ["Content-Type": "application/json"]
        if let etag = state.1 {
            headers["ETag"] = etag
        }
        if let generation = state.2 {
            headers["x-zerochat-sync-generation"] = generation
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: state.0,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if method == "GET", path == "/snapshot", state.0 == 200 {
            client?.urlProtocol(self, didLoad: Self.encodedEnvelope())
        } else {
            client?.urlProtocol(self, didLoad: Data())
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    private static func isGenerationProtectedMutation(method: String, path: String) -> Bool {
        guard method == "PUT" || method == "DELETE" else {
            return false
        }
        return path == "/sync/head" ||
            path == "/snapshot" ||
            path.hasPrefix("/sync/object/")
    }

    private static func rotateGeneration() {
        let previous = currentGenerationValue
        repeat {
            currentGenerationValue = UUID().uuidString.lowercased()
        } while currentGenerationValue == previous
    }

    private static func bodyData(for request: URLRequest) -> Data? {
        if let body = request.httpBody {
            return body
        }
        guard let stream = request.httpBodyStream else {
            return nil
        }

        stream.open()
        defer { stream.close() }
        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count >= 0 else {
                return nil
            }
            if count == 0 {
                break
            }
            body.append(contentsOf: buffer.prefix(count))
        }
        return body
    }

    private static func encodedEnvelope() -> Data {
        Data(
            """
            {"kind":"zerochat.encryptedSnapshot","version":1,"encryptedAt":1,"updatedAt":1,"crypto":{"cipher":"AES-256-GCM","kdf":"PBKDF2-SHA256","iterations":600000,"salt":"AA==","iv":"AA==","aad":"AA=="},"payload":"AA=="}
            """.utf8
        )
    }

    override func stopLoading() {}
}
