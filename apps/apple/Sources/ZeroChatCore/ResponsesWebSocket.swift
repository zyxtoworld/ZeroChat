import Foundation

struct ResponsesWebSocketFallbackError: Error {
    let message: String
}

private let responsesWebSocketBeta = "responses_websockets=2026-02-06"

private func responsesWebSocketJSON(_ message: URLSessionWebSocketTask.Message) throws -> [String: Any] {
    let data: Data
    switch message {
    case .string(let text):
        data = Data(text.utf8)
    case .data(let value):
        data = value
    @unknown default:
        throw ResponsesWebSocketFallbackError(message: "Responses WebSocket returned an unsupported message.")
    }

    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw ResponsesWebSocketFallbackError(message: "Responses WebSocket returned invalid JSON.")
    }
    return object
}

private func responsesWebSocketMessage(_ value: [String: Any]) throws -> URLSessionWebSocketTask.Message {
    let data = try JSONSerialization.data(withJSONObject: value, options: [])
    return .string(String(decoding: data, as: UTF8.self))
}

private func responseCreateMessage(body: Data) throws -> URLSessionWebSocketTask.Message {
    guard var object = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
        throw AiError.invalidURL
    }
    object.removeValue(forKey: "stream")
    object["type"] = "response.create"
    return try responsesWebSocketMessage(object)
}

private func responseErrorMessage(_ value: [String: Any]) -> String {
    (value["error"] as? [String: Any])?["message"] as? String
        ?? "Responses WebSocket request failed."
}

private func receiveWithTimeout(
    _ task: URLSessionWebSocketTask,
    seconds: TimeInterval
) async throws -> URLSessionWebSocketTask.Message {
    try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
        group.addTask {
            try await task.receive()
        }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw AiError.httpFailed(statusCode: 408, message: "Responses WebSocket timed out.")
        }
        defer { group.cancelAll() }
        return try await group.next()!
    }
}

func streamResponsesWebSocket(
    session: CredentialBoundURLSession,
    provider: ProviderConfig,
    apiKey: String,
    model: String,
    messages: [ChatMessage],
    contextMessageLimit: Int,
    proxyToken: String,
    onPartial: @Sendable (String) async -> Void
) async throws -> String? {
    guard provider.kind == .openAIResponses else { return nil }

    let httpEndpoint = try endpoint(for: provider)
    let proxy = providerRequestUsesProxy(provider)
    let endpointString: String
    if proxy {
        endpointString = httpEndpoint.absoluteString.hasSuffix("/proxy")
            ? String(httpEndpoint.absoluteString.dropLast("/proxy".count)) + "/proxy/ws"
            : httpEndpoint.absoluteString + "/ws"
    } else {
        endpointString = httpEndpoint.absoluteString.replacingOccurrences(of: "https://", with: "wss://", options: [.anchored])
    }
    guard let endpoint = URL(string: endpointString) else { throw AiError.invalidURL }

    var request = URLRequest(url: endpoint)
    request.timeoutInterval = aiProviderStreamIdleTimeoutSeconds
    request.setValue(responsesWebSocketBeta, forHTTPHeaderField: "OpenAI-Beta")
    if !proxy {
        try applyAuthHeaders(to: &request, provider: provider, apiKey: apiKey)
    }

    let task = session.webSocketTask(for: request)
    task.resume()
    var received = ""

    do {
        if proxy {
            guard !proxyToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw AiError.missingAccessKey
            }
            let authorization: [String: Any] = [
                "type": "zerochat.proxy.authorize",
                "accessKey": proxyToken.trimmingCharacters(in: .whitespacesAndNewlines),
                "providerKind": provider.kind.rawValue,
                "baseUrl": provider.baseUrl,
                "apiKey": providerNeedsClientKey(provider) ? apiKey : ""
            ]
            try await task.send(try responsesWebSocketMessage(authorization))
            let ready = try await receiveWithTimeout(task, seconds: aiProviderStreamIdleTimeoutSeconds)
            let readyObject = try responsesWebSocketJSON(ready)
            guard readyObject["type"] as? String == "zerochat.proxy.ready" else {
                throw ResponsesWebSocketFallbackError(message: responseErrorMessage(readyObject))
            }
        }

        try await task.send(
            try responseCreateMessage(
                body: chatRequestBody(
                    provider: provider,
                    model: model,
                    messages: messages,
                    contextMessageLimit: contextMessageLimit,
                    stream: true
                )
            )
        )

        while true {
            let event = try await receiveWithTimeout(task, seconds: aiProviderStreamIdleTimeoutSeconds)
            let object = try responsesWebSocketJSON(event)
            let type = object["type"] as? String ?? ""
            switch type {
            case "response.output_text.delta":
                if let delta = object["delta"] as? String, !delta.isEmpty {
                    received += delta
                    await onPartial(received)
                }
            case "response.completed":
                return try validatedChatStreamResponse(received)
            case "response.failed", "response.incomplete", "error":
                throw AiError.httpFailed(statusCode: 502, message: responseErrorMessage(object))
            default:
                continue
            }
        }
    } catch is CancellationError {
        throw CancellationError()
    } catch let fallback as ResponsesWebSocketFallbackError {
        if received.isEmpty { throw fallback }
        throw AiError.httpFailed(statusCode: 502, message: fallback.message)
    } catch {
        if received.isEmpty {
            throw ResponsesWebSocketFallbackError(message: "Responses WebSocket connection failed.")
        }
        throw error
    }
}
