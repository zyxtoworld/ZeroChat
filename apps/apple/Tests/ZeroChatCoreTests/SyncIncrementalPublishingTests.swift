import Foundation
import XCTest
@testable import ZeroChatCore

private let incrementalTestGenerationValue = "4f70f3a4-a836-4e90-9e14-8acbe4d9b2aa"
private let incrementalTestGeneration = SyncGeneration(
    rawValue: incrementalTestGenerationValue
)!

final class SyncIncrementalPublishingTests: XCTestCase {
    override func tearDown() {
        IncrementalPublishingURLProtocol.reset()
        super.tearDown()
    }

    func testSuccessfulPublishDoesNotDeleteObjectsFromPreviousManifest() async throws {
        IncrementalPublishingURLProtocol.setHeadWriteBehavior(.succeed)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let crypto = CryptoEngine()
        let transport = AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(session),
            crypto: crypto
        )
        let previousSnapshot = AppSnapshot(updatedAt: 1)
        let previous = IncrementalRemoteState(
            head: IncrementalSyncHead(
                kind: "zerochat.incrementalHead",
                version: 1,
                manifestKey: "manifest-00000000-0000-0000-0000-000000000001.json",
                updatedAt: 1
            ),
            manifest: IncrementalManifest(
                kind: "zerochat.incrementalManifest",
                version: 1,
                updatedAt: 1,
                data: previousSnapshot,
                secrets: ProviderSecrets(),
                chunks: [
                    IncrementalChunkRef(
                        conversationId: "old-conversation",
                        index: 0,
                        key: "chunk-00000000-0000-0000-0000-000000000002.json",
                        objectType: "conversationChunk:old-conversation:0",
                        fingerprint: "old-fingerprint",
                        messageCount: 1,
                        updatedAt: 1
                    ),
                ],
                skillChunks: []
            )
        )

        _ = try await AppleIncrementalSyncEngine(crypto: crypto, transport: transport).uploadVault(
            vault: SyncVault(data: AppSnapshot(updatedAt: 2)),
            passphrase: "publish-test-passphrase",
            endpoint: URL(string: "https://sync.example.test")!,
            token: "test-token",
            previous: previous,
            generation: incrementalTestGeneration
        )

        let requests = IncrementalPublishingURLProtocol.capturedRequests()
        let headRequest = try XCTUnwrap(
            requests.first { $0.method == "PUT" && $0.path == "/sync/head" }
        )
        XCTAssertEqual(
            headRequest.ifMatch,
            "\"manifest-00000000-0000-0000-0000-000000000001.json\""
        )
        XCTAssertNil(headRequest.ifNoneMatch)
        XCTAssertEqual(headRequest.syncGeneration, incrementalTestGenerationValue)
        XCTAssertTrue(
            requests.filter { $0.method == "PUT" || $0.method == "DELETE" }
                .allSatisfy { $0.syncGeneration == incrementalTestGenerationValue }
        )
        XCTAssertEqual(
            requests.filter { $0.method == "DELETE" && $0.path.hasPrefix("/sync/object/") }.map(\.path),
            []
        )
    }

    func testLostHeadResponseIsAcceptedWhenReadbackConfirmsPublishedHead() async throws {
        IncrementalPublishingURLProtocol.setHeadWriteBehavior(.failThenConfirm)

        _ = try await uploadTestVault()

        let requests = IncrementalPublishingURLProtocol.capturedRequests()
        XCTAssertTrue(requests.contains { $0.method == "GET" && $0.path == "/sync/head" })
        let headRequest = try XCTUnwrap(
            requests.first { $0.method == "PUT" && $0.path == "/sync/head" }
        )
        XCTAssertNil(headRequest.ifMatch)
        XCTAssertEqual(headRequest.ifNoneMatch, "*")
        XCTAssertEqual(headRequest.syncGeneration, incrementalTestGenerationValue)
        XCTAssertEqual(
            requests.filter { $0.method == "DELETE" && $0.path.hasPrefix("/sync/object/") }.map(\.path),
            []
        )
    }

    func testUnconfirmedHeadFailurePreservesUploadedObjects() async {
        IncrementalPublishingURLProtocol.setHeadWriteBehavior(.failWithoutConfirmation)

        do {
            _ = try await uploadTestVault()
            XCTFail("Expected the unconfirmed head failure")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .networkConnectionLost)
        } catch {
            XCTFail("Expected URLError.networkConnectionLost, received \(error)")
        }

        let requests = IncrementalPublishingURLProtocol.capturedRequests()
        XCTAssertTrue(requests.contains { $0.method == "GET" && $0.path == "/sync/head" })
        XCTAssertEqual(
            requests.filter { $0.method == "DELETE" && $0.path.hasPrefix("/sync/object/") }.map(\.path),
            []
        )
    }

    func testExplicitHeadConflictRollsBackUnpublishedObjects() async {
        IncrementalPublishingURLProtocol.setHeadWriteBehavior(.rejectAsConflict)

        do {
            _ = try await uploadTestVault()
            XCTFail("Expected a remote-updated conflict")
        } catch SyncError.remoteUpdated {
            // Expected: a 409 proves that this head was not committed.
        } catch {
            XCTFail("Expected SyncError.remoteUpdated, received \(error)")
        }

        let deletedObjects = IncrementalPublishingURLProtocol.capturedRequests()
            .filter { $0.method == "DELETE" && $0.path.hasPrefix("/sync/object/") }
        XCTAssertFalse(deletedObjects.isEmpty)
        XCTAssertTrue(
            deletedObjects.allSatisfy {
                $0.syncGeneration == incrementalTestGenerationValue
            }
        )
    }

    func testExplicitHeadDeleteCarriesAttemptGeneration() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let transport = AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(session),
            crypto: CryptoEngine()
        )
        try await transport.deleteIncrementalHead(
            endpoint: URL(string: "https://sync.example.test")!,
            token: "test-token",
            generation: incrementalTestGeneration
        )

        let request = try XCTUnwrap(
            IncrementalPublishingURLProtocol.capturedRequests().first {
                $0.method == "DELETE" && $0.path == "/sync/head"
            }
        )
        XCTAssertEqual(request.syncGeneration, incrementalTestGenerationValue)
    }

    func testHeadReadFailsClosedWithoutGenerationOn200And404() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let transport = AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(session),
            crypto: CryptoEngine()
        )
        for behavior in [
            IncrementalPublishingURLProtocol.HeadWriteBehavior.returnHeadWithoutGeneration,
            .returnEmptyWithoutGeneration,
        ] {
            IncrementalPublishingURLProtocol.setHeadWriteBehavior(behavior)
            do {
                _ = try await transport.readIncrementalHead(
                    endpoint: URL(string: "https://sync.example.test")!,
                    token: "test-token"
                )
                XCTFail("Expected missing generation to fail closed")
            } catch SyncError.badSyncGeneration {
                // Expected.
            } catch {
                XCTFail("Expected SyncError.badSyncGeneration, received \(error)")
            }
        }
    }

    func testClearRotatedGenerationRejectsStaleHeadDelete() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let transport = AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(session),
            crypto: CryptoEngine()
        )

        try await transport.clearRemote(
            workerEndpoint: "https://sync.example.test",
            token: "test-token"
        )
        let rotatedGeneration = IncrementalPublishingURLProtocol.currentGeneration()
        XCTAssertNotEqual(rotatedGeneration, incrementalTestGenerationValue)
        XCTAssertNotNil(SyncGeneration(rawValue: rotatedGeneration))

        do {
            try await transport.deleteIncrementalHead(
                endpoint: URL(string: "https://sync.example.test")!,
                token: "test-token",
                generation: incrementalTestGeneration
            )
            XCTFail("Expected stale generation to be rejected after clear")
        } catch SyncError.remoteUpdated {
            // Expected.
        } catch {
            XCTFail("Expected SyncError.remoteUpdated, received \(error)")
        }

        let clear = try XCTUnwrap(
            IncrementalPublishingURLProtocol.capturedRequests().first {
                $0.method == "DELETE" && $0.path == "/sync/clear"
            }
        )
        XCTAssertNil(clear.syncGeneration)
        let clearResponse = try XCTUnwrap(
            IncrementalPublishingURLProtocol.capturedResponses().first {
                $0.method == "DELETE" && $0.path == "/sync/clear"
            }
        )
        XCTAssertEqual(clearResponse.statusCode, 200)
        XCTAssertEqual(clearResponse.generation, rotatedGeneration)

        let staleDeleteResponse = try XCTUnwrap(
            IncrementalPublishingURLProtocol.capturedResponses().last {
                $0.method == "DELETE" && $0.path == "/sync/head"
            }
        )
        XCTAssertEqual(staleDeleteResponse.statusCode, 412)
    }

    func testMutationFixtureFailsClosedWithoutGeneration() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        for method in ["PUT", "DELETE"] {
            for path in ["/sync/object/test-object", "/sync/head", "/snapshot"] {
                var request = URLRequest(url: URL(string: "https://sync.example.test\(path)")!)
                request.httpMethod = method
                let (_, response) = try await session.data(for: request)
                XCTAssertEqual(
                    (response as? HTTPURLResponse)?.statusCode,
                    428,
                    "Expected \(method) \(path) without generation to fail closed"
                )
            }
        }
    }

    func testIncrementalFinalObservationRejectsWriterUpdateAndClear() async {
        let expectedHead = IncrementalSyncHead(
            kind: "zerochat.incrementalHead",
            version: 1,
            manifestKey: "manifest-00000000-0000-0000-0000-000000000001.json",
            updatedAt: 1
        )
        let expected = IncrementalHeadRead.head(
            expectedHead,
            generation: incrementalTestGeneration
        )

        for behavior in [
            IncrementalPublishingURLProtocol.HeadWriteBehavior.returnChangedHead,
            .returnEmptyAfterClear,
        ] {
            IncrementalPublishingURLProtocol.setHeadWriteBehavior(behavior)
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let transport = AppleCloudflareSyncTransport(
                session: CredentialBoundURLSession(session),
                crypto: CryptoEngine()
            )

            do {
                try await transport.revalidateIncrementalHeadObservation(
                    endpoint: URL(string: "https://sync.example.test")!,
                    token: "test-token",
                    expected: expected
                )
                XCTFail("Expected changed incremental observation to be rejected")
            } catch SyncError.remoteUpdated {
                // Expected.
            } catch {
                XCTFail("Expected SyncError.remoteUpdated, received \(error)")
            }
        }
    }

    func testHeadConflictRetryBoundaryStopsAtConfiguredLimit() {
        XCTAssertEqual(
            (0..<3).map { shouldRetryCloudflareHeadConflict(afterAttempt: $0, maxAttempts: 3) },
            [true, true, false]
        )
    }

    private func uploadTestVault() async throws -> SyncVault {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IncrementalPublishingURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        let crypto = CryptoEngine()
        let transport = AppleCloudflareSyncTransport(
            session: CredentialBoundURLSession(session),
            crypto: crypto
        )
        return try await AppleIncrementalSyncEngine(crypto: crypto, transport: transport).uploadVault(
            vault: SyncVault(data: AppSnapshot(updatedAt: 2)),
            passphrase: "publish-test-passphrase",
            endpoint: URL(string: "https://sync.example.test")!,
            token: "test-token",
            previous: nil,
            generation: incrementalTestGeneration
        )
    }
}

private final class IncrementalPublishingURLProtocol: URLProtocol {
    enum HeadWriteBehavior: Equatable {
        case succeed
        case failThenConfirm
        case failWithoutConfirmation
        case rejectAsConflict
        case returnHeadWithoutGeneration
        case returnEmptyWithoutGeneration
        case returnChangedHead
        case returnEmptyAfterClear
    }

    struct CapturedRequest: Sendable {
        var method: String
        var path: String
        var ifMatch: String?
        var ifNoneMatch: String?
        var syncGeneration: String?
    }

    struct CapturedResponse: Sendable {
        var method: String
        var path: String
        var statusCode: Int
        var generation: String?
    }

    nonisolated(unsafe) private static var requests: [CapturedRequest] = []
    nonisolated(unsafe) private static var responses: [CapturedResponse] = []
    nonisolated(unsafe) private static var headWriteBehavior = HeadWriteBehavior.succeed
    nonisolated(unsafe) private static var currentGenerationValue = incrementalTestGenerationValue
    nonisolated(unsafe) private static var publishedHeadBody: Data?
    nonisolated(unsafe) private static var objects: [String: Data] = [:]
    nonisolated(unsafe) private static var snapshotBody: Data?
    nonisolated(unsafe) private static let lock = NSLock()

    static func reset() {
        lock.withLock {
            requests = []
            responses = []
            headWriteBehavior = .succeed
            currentGenerationValue = incrementalTestGenerationValue
            publishedHeadBody = nil
            objects = [:]
            snapshotBody = nil
        }
    }

    static func setHeadWriteBehavior(_ behavior: HeadWriteBehavior) {
        lock.withLock { headWriteBehavior = behavior }
    }

    static func capturedRequests() -> [CapturedRequest] {
        lock.withLock { requests }
    }

    static func capturedResponses() -> [CapturedResponse] {
        lock.withLock { responses }
    }

    static func currentGeneration() -> String {
        lock.withLock { currentGenerationValue }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "sync.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        let path = request.url?.path ?? ""
        let requestBody = method == "PUT" ? Self.bodyData(for: request) : nil
        let state = Self.lock.withLock { () -> (HeadWriteBehavior, Int?, String?) in
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
                Self.publishedHeadBody = nil
                Self.objects = [:]
                Self.snapshotBody = nil
                Self.rotateGeneration()
                return (Self.headWriteBehavior, 200, Self.currentGenerationValue)
            }

            if Self.isGenerationProtectedMutation(method: method, path: path) {
                guard let requestGeneration else {
                    return (Self.headWriteBehavior, 428, nil)
                }
                guard requestGeneration == Self.currentGenerationValue else {
                    return (Self.headWriteBehavior, 412, nil)
                }
            }

            if method == "PUT", path == "/sync/head" {
                if Self.headWriteBehavior != .rejectAsConflict,
                   Self.headWriteBehavior != .failWithoutConfirmation {
                    Self.publishedHeadBody = requestBody
                }
            } else if method == "DELETE", path == "/sync/head" {
                Self.publishedHeadBody = nil
            } else if method == "PUT", path.hasPrefix("/sync/object/") {
                Self.objects[path] = requestBody ?? Data()
            } else if method == "DELETE", path.hasPrefix("/sync/object/") {
                Self.objects.removeValue(forKey: path)
            } else if method == "PUT", path == "/snapshot" {
                Self.snapshotBody = requestBody
            } else if method == "DELETE", path == "/snapshot" {
                Self.snapshotBody = nil
            }
            return (Self.headWriteBehavior, nil, nil)
        }

        if let statusCode = state.1 {
            respond(statusCode: statusCode, data: Data(), generation: state.2)
            return
        }
        let behavior = state.0

        if method == "PUT", path == "/sync/head" {
            switch behavior {
            case .succeed:
                respond(statusCode: 200, data: Data("{}".utf8))
            case .failThenConfirm, .failWithoutConfirmation:
                client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            case .rejectAsConflict:
                respond(statusCode: 409, data: Data())
            case .returnHeadWithoutGeneration, .returnEmptyWithoutGeneration,
                 .returnChangedHead, .returnEmptyAfterClear:
                respond(statusCode: 200, data: Data("{}".utf8))
            }
            return
        }

        if method == "GET", path == "/sync/head" {
            if behavior == .returnHeadWithoutGeneration {
                respond(
                    statusCode: 200,
                    data: Self.validHeadBody(),
                    generation: nil
                )
                return
            }
            if behavior == .returnEmptyWithoutGeneration {
                respond(statusCode: 404, data: Data(), generation: nil)
                return
            }
            if behavior == .returnChangedHead {
                respond(
                    statusCode: 200,
                    data: Self.changedHeadBody(),
                    generation: incrementalTestGenerationValue
                )
                return
            }
            if behavior == .returnEmptyAfterClear {
                respond(
                    statusCode: 404,
                    data: Data(),
                    generation: "a0f38d9d-bd2a-4aaf-b7db-eaa0c24fd869"
                )
                return
            }
            if behavior == .failThenConfirm,
               let body = Self.lock.withLock({ Self.publishedHeadBody }) {
                respond(
                    statusCode: 200,
                    data: body,
                    generation: Self.currentGeneration()
                )
            } else {
                client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            }
            return
        }

        respond(statusCode: 200, data: Data("{}".utf8))
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

    private static func validHeadBody() -> Data {
        Data(
            """
            {"kind":"zerochat.incrementalHead","version":1,"manifestKey":"manifest-00000000-0000-0000-0000-000000000001.json","updatedAt":1}
            """.utf8
        )
    }

    private static func changedHeadBody() -> Data {
        Data(
            """
            {"kind":"zerochat.incrementalHead","version":1,"manifestKey":"manifest-00000000-0000-0000-0000-000000000002.json","updatedAt":2}
            """.utf8
        )
    }

    private func respond(
        statusCode: Int,
        data: Data,
        generation: String? = nil
    ) {
        Self.lock.withLock {
            Self.responses.append(CapturedResponse(
                method: request.httpMethod ?? "GET",
                path: request.url?.path ?? "",
                statusCode: statusCode,
                generation: generation
            ))
        }
        var headers = ["Content-Type": "application/json"]
        if let generation {
            headers["x-zerochat-sync-generation"] = generation
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
