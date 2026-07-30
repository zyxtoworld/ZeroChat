import Foundation
import XCTest
@testable import ZeroChatCore

final class AiClientCapabilityRuntimeTests: XCTestCase {
    override func setUp() {
        super.setUp()
        CapturingURLProtocol.reset()
    }

    override func tearDown() {
        CapturingURLProtocol.reset()
        super.tearDown()
    }

    func testCapabilityRuntimeRequestsUseProxyActions() async throws {
        let client = AiClient(session: capturingSession())
        let provider = provider()

        let audio = try await client.createSpeech(
            provider: provider,
            apiKey: "provider-key",
            proxyToken: "access-key",
            model: "tts-1",
            input: "hello"
        )
        XCTAssertEqual(audio, Data([0x00, 0x01, 0x02, 0x03]))
        XCTAssertEqual(
            try await client.transcribeAudio(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "gpt-4o-transcribe",
                audio: AudioUpload(data: Data("voice".utf8))
            ),
            #"{"text":"hello"}"#
        )
        XCTAssertEqual(
            try await client.createEmbedding(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "text-embedding-3-large",
                input: "hello"
            ),
            #"{"data":[{"embedding":[0.1]}]}"#
        )
        XCTAssertEqual(
            try await client.createEmbeddings(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "text-embedding-3-large",
                input: ["hello", "world"]
            ),
            #"{"data":[{"embedding":[0.1]}]}"#
        )
        XCTAssertEqual(
            try await client.moderateText(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "omni-moderation-latest",
                input: "hello"
            ),
            #"{"results":[{"flagged":false}]}"#
        )
        XCTAssertEqual(
            try await client.createRealtimeSession(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "gpt-realtime-2"
            ),
            #"{"id":"sess_1"}"#
        )
        XCTAssertEqual(
            try await client.createRealtimeClientSecret(
                provider: provider,
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "gpt-realtime-2"
            ),
            #"{"client_secret":{"value":"ek_test"}}"#
        )

        let requests = CapturingURLProtocol.capturedRequests()
        XCTAssertEqual(
            requests.map { $0.value(forHTTPHeaderField: "x-zerochat-proxy-action") },
            [
                "audio-speech",
                "audio-transcriptions",
                "embeddings",
                "embeddings",
                "moderations",
                "realtime",
                "realtime-client-secrets"
            ]
        )

        for request in requests {
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/proxy")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-zerochat-access-key"), "access-key")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-zerochat-base-url"), "https://api.example.test/v1")
            XCTAssertNil(request.value(forHTTPHeaderField: "x-zerochat-provider-id"))
            XCTAssertNil(request.value(forHTTPHeaderField: "x-zerochat-provider-name"))
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-zerochat-provider-kind"), "openai-compatible")
        }
    }

    func testDallE3ImageEditingFailsBeforeNetworkRequest() async throws {
        let client = AiClient(session: capturingSession())

        do {
            _ = try await client.editImage(
                provider: provider(),
                apiKey: "provider-key",
                proxyToken: "access-key",
                model: "dall-e-3",
                prompt: "Edit this image",
                image: ImageUpload(
                    data: Data("image".utf8),
                    fileName: "source.png",
                    mimeType: "image/png"
                )
            )
            XCTFail("DALL-E 3 must not reach the image editing endpoint")
        } catch let error as AiError {
            guard case .unsupportedImageEditModel = error else {
                XCTFail("Unexpected image editing error: \(error)")
                return
            }
        }

        XCTAssertTrue(CapturingURLProtocol.capturedRequests().isEmpty)
    }

    func testURLOnlyGeneratedImageIsMaterializedWithoutProviderCredentials() async throws {
        let client = AiClient(session: capturingSession())
        let signedURL = "https://cdn.example.test/generated.png?token=temporary-secret&expires=1"

        let image = try await client.materializeGeneratedImage(
            GeneratedImage(url: signedURL, revisedPrompt: "revised")
        )

        XCTAssertEqual(image.dataUrl, "data:image/png;base64,iVBORw0KGgoA")
        XCTAssertNil(image.url)
        XCTAssertEqual(image.mimeType, "image/png")
        XCTAssertFalse(String(describing: image).contains("temporary-secret"))
        let request = try XCTUnwrap(CapturingURLProtocol.capturedRequests().last)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "x-zerochat-access-key"))
        XCTAssertNil(request.value(forHTTPHeaderField: "x-zerochat-proxy-action"))
        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
    }
}

private final class CapturingURLProtocol: URLProtocol {
    nonisolated(unsafe) private static var requests: [URLRequest] = []
    nonisolated(unsafe) private static let lock = NSLock()

    static func reset() {
        lock.withLock {
            requests = []
        }
    }

    static func capturedRequests() -> [URLRequest] {
        lock.withLock {
            requests
        }
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.lock.withLock {
            Self.requests.append(request)
        }

        let isGeneratedImage = request.url?.host == "cdn.example.test"
        let action = request.value(forHTTPHeaderField: "x-zerochat-proxy-action") ?? ""
        let body = isGeneratedImage
            ? Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00])
            : responseBody(for: action)
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://proxy.example.test/proxy")!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": isGeneratedImage
                    ? "image/png"
                    : action == "audio-speech" ? "audio/mpeg" : "application/json"
            ]
        )!

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func responseBody(for action: String) -> Data {
        switch action {
        case "audio-speech":
            return Data([0x00, 0x01, 0x02, 0x03])
        case "audio-transcriptions":
            return Data(#"{"text":"hello"}"#.utf8)
        case "embeddings":
            return Data(#"{"data":[{"embedding":[0.1]}]}"#.utf8)
        case "moderations":
            return Data(#"{"results":[{"flagged":false}]}"#.utf8)
        case "realtime":
            return Data(#"{"id":"sess_1"}"#.utf8)
        case "realtime-client-secrets":
            return Data(#"{"client_secret":{"value":"ek_test"}}"#.utf8)
        default:
            return Data(#"{"error":"unexpected action"}"#.utf8)
        }
    }
}

private func capturingSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [CapturingURLProtocol.self]
    return URLSession(configuration: configuration)
}

private func provider() -> ProviderConfig {
    ProviderConfig(
        id: "provider-1",
        name: "Example",
        kind: .openAICompatible,
        baseUrl: "https://api.example.test/v1/realtime/client_secrets",
        proxyUrl: "https://proxy.example.test",
        model: "gpt-5-mini",
        models: [
            "gpt-5-mini",
            "tts-1",
            "gpt-4o-transcribe",
            "text-embedding-3-large",
            "omni-moderation-latest",
            "gpt-realtime-2",
            "gpt-realtime"
        ],
        capabilities: ["chat", "audio", "embeddings", "moderation", "realtime"],
        enabled: true,
        needsApiKey: true,
        createdAt: 0,
        updatedAt: 0
    )
}
