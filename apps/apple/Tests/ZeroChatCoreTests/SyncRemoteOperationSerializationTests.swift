import Foundation
import XCTest
@testable import ZeroChatCore

final class SyncRemoteOperationSerializationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        SerializedRemoteOperationURLProtocol.reset()
    }

    override func tearDown() {
        SerializedRemoteOperationURLProtocol.releaseFirstResponse()
        SerializedRemoteOperationURLProtocol.reset()
        super.tearDown()
    }

    func testRemoteMutationsAreSerializedPerSyncClient() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SerializedRemoteOperationURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = SyncClient(session: session)

        let first = Task {
            try await client.clearCloudflare(
                workerEndpoint: "https://sync.example.test",
                token: "test-token"
            )
        }
        try await waitForRequestCount(1)

        let second = Task {
            try await client.clearCloudflare(
                workerEndpoint: "https://sync.example.test",
                token: "test-token"
            )
        }
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertEqual(
            SerializedRemoteOperationURLProtocol.requestCount,
            1,
            "A second remote mutation escaped while the first was still in flight."
        )

        SerializedRemoteOperationURLProtocol.releaseFirstResponse()
        try await first.value
        try await waitForRequestCount(2)
        try await second.value
    }

    private func waitForRequestCount(_ expected: Int) async throws {
        for _ in 0..<100 {
            if SerializedRemoteOperationURLProtocol.requestCount >= expected {
                return
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for \(expected) remote requests.")
    }
}

private final class SerializedRemoteOperationURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var capturedRequestCount = 0
    nonisolated(unsafe) private static var pendingFirstResponse: (() -> Void)?

    static var requestCount: Int {
        lock.withLock { capturedRequestCount }
    }

    static func reset() {
        lock.withLock {
            capturedRequestCount = 0
            pendingFirstResponse = nil
        }
    }

    static func releaseFirstResponse() {
        let response = lock.withLock {
            let response = pendingFirstResponse
            pendingFirstResponse = nil
            return response
        }
        response?()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "sync.example.test"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let ordinal = Self.lock.withLock {
            Self.capturedRequestCount += 1
            return Self.capturedRequestCount
        }
        let response = { [weak self] in self?.sendSuccessResponse() }

        if ordinal == 1 {
            Self.lock.withLock {
                Self.pendingFirstResponse = response
            }
        } else {
            response()
        }
    }

    override func stopLoading() {}

    private func sendSuccessResponse() {
        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: 204,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "x-zerochat-sync-generation": "00000000-0000-4000-8000-000000000001"
                ]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
}
