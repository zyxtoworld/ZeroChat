import Foundation

public actor AiClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: [ChatMessage],
        proxyToken: String = ""
    ) async throws -> String {
        let endpoint = try endpoint(for: provider)
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if provider.kind == .anthropic {
            request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        } else {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if proxyToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                throw AiError.missingProxyToken
            }
            request.setValue(proxyToken, forHTTPHeaderField: "x-zerochat-proxy-token")
            request.setValue(try safeBaseURL(provider.baseUrl, label: "Base URL"), forHTTPHeaderField: "x-zerochat-base-url")
            request.setValue(provider.kind.rawValue, forHTTPHeaderField: "x-zerochat-provider-kind")
        }

        request.httpBody = try JSONEncoder().encode(OpenAIRequest(
            model: model,
            messages: messages.map { OpenAIMessage(role: $0.role.rawValue, content: $0.content) },
            stream: false,
            temperature: 0.7
        ))

        let (data, _) = try await session.data(for: request)
        return String(data: data, encoding: .utf8) ?? ""
    }

    private func endpoint(for provider: ProviderConfig) throws -> URL {
        if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            guard let url = URL(string: try safeBaseURL(proxyUrl, label: "Proxy URL") + "/proxy") else {
                throw AiError.invalidURL
            }
            return url
        }

        let suffix = provider.kind == .anthropic ? "/messages" : "/chat/completions"
        guard let url = URL(string: try safeBaseURL(provider.baseUrl, label: "Base URL") + suffix) else {
            throw AiError.invalidURL
        }
        return url
    }

    private func safeBaseURL(_ value: String, label: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var components = URLComponents(string: trimmed), let scheme = components.scheme else {
            throw AiError.invalidURL
        }

        let host = components.host ?? ""
        let isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard scheme == "https" || (scheme == "http" && isLoopback) else {
            throw AiError.unsafeURL(label)
        }
        guard components.user == nil, components.password == nil else {
            throw AiError.unsafeURL(label)
        }

        components.query = nil
        components.fragment = nil

        guard var base = components.url?.absoluteString else {
            throw AiError.invalidURL
        }

        while base.hasSuffix("/") {
            base.removeLast()
        }

        return base
    }
}

private struct OpenAIRequest: Encodable {
    var model: String
    var messages: [OpenAIMessage]
    var stream: Bool
    var temperature: Double
}

private struct OpenAIMessage: Encodable {
    var role: String
    var content: String
}

public enum AiError: Error {
    case invalidURL
    case missingProxyToken
    case unsafeURL(String)
}
