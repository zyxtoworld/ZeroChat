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
        messages: [ChatMessage]
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

        if provider.proxyUrl != nil {
            request.setValue(provider.baseUrl, forHTTPHeaderField: "x-zerochat-base-url")
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
        if let proxyUrl = provider.proxyUrl {
            guard let url = URL(string: proxyUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/proxy") else {
                throw AiError.invalidURL
            }
            return url
        }

        let suffix = provider.kind == .anthropic ? "/messages" : "/chat/completions"
        guard let url = URL(string: provider.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + suffix) else {
            throw AiError.invalidURL
        }
        return url
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
}
