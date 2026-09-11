import Foundation

let maxSyncSnapshotBytes = 900_000
let maxSyncIncrementalObjectBytes = 5_000_000
let maxSyncIncrementalHeadBytes = 16_384
let maxSyncErrorBodyBytes = 16_384
let maxSyncGistResponseBytes = 5_000_000
let syncRequestTimeoutSeconds: TimeInterval = 60

func syncURLSessionConfiguration(from session: URLSession) -> URLSessionConfiguration {
    let configuration = session.configuration
    configuration.timeoutIntervalForRequest = syncRequestTimeoutSeconds
    configuration.timeoutIntervalForResource = syncRequestTimeoutSeconds
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCredentialStorage = nil
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return configuration
}

enum ResponseBodyLimitError: LocalizedError {
    case exceeded(label: String, maxBytes: Int)
    case invalidCount(label: String)

    var errorDescription: String? {
        switch self {
        case .exceeded(let label, let maxBytes):
            return "\(label) exceeded the \(maxBytes)-byte safety limit."
        case .invalidCount(let label):
            return "\(label) reported an invalid byte count."
        }
    }
}

func accumulateResponseBodyBytes(
    currentBytes: Int,
    nextBytes: Int,
    maxBytes: Int,
    label: String
) throws -> Int {
    guard currentBytes >= 0, nextBytes >= 0, maxBytes >= 0 else {
        throw ResponseBodyLimitError.invalidCount(label: label)
    }
    let (totalBytes, overflow) = currentBytes.addingReportingOverflow(nextBytes)
    guard !overflow, totalBytes <= maxBytes else {
        throw ResponseBodyLimitError.exceeded(label: label, maxBytes: maxBytes)
    }
    return totalBytes
}

func assertSyncDataSize(_ data: Data, maxBytes: Int, label: String) throws {
    guard data.count <= maxBytes else {
        throw ResponseBodyLimitError.exceeded(label: label, maxBytes: maxBytes)
    }
}

func assertSyncTextSize(_ text: String, maxBytes: Int, label: String) throws {
    guard text.lengthOfBytes(using: .utf8) <= maxBytes else {
        throw ResponseBodyLimitError.exceeded(label: label, maxBytes: maxBytes)
    }
}

final class CredentialBoundURLSessionTaskDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    static let shared = CredentialBoundURLSessionTaskDelegate()

    private override init() {}

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @Sendable @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct CredentialBoundURLSession: @unchecked Sendable {
    private let session: URLSession

    init(_ session: URLSession) {
        self.session = URLSession(configuration: syncURLSessionConfiguration(from: session))
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(
            for: request,
            delegate: CredentialBoundURLSessionTaskDelegate.shared
        )
    }

    func bytes(for request: URLRequest) async throws -> (URLSession.AsyncBytes, URLResponse) {
        try await session.bytes(
            for: request,
            delegate: CredentialBoundURLSessionTaskDelegate.shared
        )
    }

    func boundedData(
        for request: URLRequest,
        maxBytes: Int,
        label: String
    ) async throws -> (Data, URLResponse) {
        let (bytes, response) = try await bytes(for: request)
        let data = try await boundedData(
            from: bytes,
            response: response,
            maxBytes: maxBytes,
            label: label
        )
        return (data, response)
    }

    func boundedData(
        for request: URLRequest,
        successMaxBytes: Int,
        errorMaxBytes: Int,
        successLabel: String,
        errorLabel: String
    ) async throws -> (Data, URLResponse) {
        let (bytes, response) = try await bytes(for: request)
        let isSuccess = (response as? HTTPURLResponse)
            .map { (200..<300).contains($0.statusCode) }
            ?? true
        let data = try await boundedData(
            from: bytes,
            response: response,
            maxBytes: isSuccess ? successMaxBytes : errorMaxBytes,
            label: isSuccess ? successLabel : errorLabel
        )
        return (data, response)
    }

    func assertBoundedExpectedContentLength(
        for bytes: URLSession.AsyncBytes,
        response: URLResponse,
        maxBytes: Int,
        label: String
    ) throws {
        if response.expectedContentLength > Int64(maxBytes) {
            bytes.task.cancel()
            throw ResponseBodyLimitError.exceeded(label: label, maxBytes: maxBytes)
        }
    }

    func boundedData(
        from bytes: URLSession.AsyncBytes,
        response: URLResponse,
        maxBytes: Int,
        label: String
    ) async throws -> Data {
        try assertBoundedExpectedContentLength(
            for: bytes,
            response: response,
            maxBytes: maxBytes,
            label: label
        )

        var data = Data()
        var totalBytes = 0
        if response.expectedContentLength > 0 {
            data.reserveCapacity(min(Int(response.expectedContentLength), maxBytes))
        }

        for try await byte in bytes {
            do {
                totalBytes = try accumulateResponseBodyBytes(
                    currentBytes: totalBytes,
                    nextBytes: 1,
                    maxBytes: maxBytes,
                    label: label
                )
            } catch {
                bytes.task.cancel()
                throw error
            }
            data.append(byte)
        }

        return data
    }
}
