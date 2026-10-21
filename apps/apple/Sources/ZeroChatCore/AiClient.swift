import Foundation

public let aiProviderModelListTimeoutSeconds: TimeInterval = 30
public let aiProviderChatRequestTimeoutSeconds: TimeInterval = 60
public let aiProviderImageRequestTimeoutSeconds: TimeInterval = 180
public let aiProviderCapabilityRequestTimeoutSeconds: TimeInterval = 60
public let aiProviderStreamIdleTimeoutSeconds: TimeInterval = 90
public let aiProviderErrorResponseMaxBytes = 16_384
public let aiProviderTextResponseMaxBytes = 8_000_000
public let aiProviderImageResponseMaxBytes = 32_000_000
public let aiProviderAudioResponseMaxBytes = 32_000_000
public let aiProviderStreamResponseMaxBytes = 8_000_000

private func generatedImageMimeType(_ data: Data) -> String? {
    let bytes = [UInt8](data.prefix(12))
    if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return "image/png"
    }
    if bytes.starts(with: [0xFF, 0xD8, 0xFF]) {
        return "image/jpeg"
    }
    if bytes.count >= 12,
       Array(bytes[0..<4]) == Array("RIFF".utf8),
       Array(bytes[8..<12]) == Array("WEBP".utf8) {
        return "image/webp"
    }
    return nil
}

public struct GeneratedImage: Sendable {
    public var dataUrl: String?
    public var url: String?
    public var mimeType: String
    public var revisedPrompt: String?

    public init(
        dataUrl: String? = nil,
        url: String? = nil,
        mimeType: String = "image/png",
        revisedPrompt: String? = nil
    ) {
        self.dataUrl = dataUrl
        self.url = url
        self.mimeType = mimeType
        self.revisedPrompt = revisedPrompt
    }
}

public struct ImageUpload: Sendable {
    public var data: Data
    public var fileName: String
    public var mimeType: String

    public init(data: Data, fileName: String, mimeType: String) {
        self.data = data
        self.fileName = fileName
        self.mimeType = mimeType
    }
}

public struct AudioUpload: Sendable {
    public var data: Data
    public var fileName: String
    public var mimeType: String

    public init(data: Data, fileName: String = "audio.webm", mimeType: String = "audio/webm") {
        self.data = data
        self.fileName = fileName
        self.mimeType = mimeType
    }
}

public actor AiClient {
    private let session: CredentialBoundURLSession

    public init(session: URLSession = .shared) {
        self.session = CredentialBoundURLSession(session)
    }

    public func send(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: [ChatMessage],
        contextMessageLimit: Int = 24,
        proxyToken: String = ""
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        if providerNeedsClientKey(provider), trimmedKey.isEmpty {
            throw AiError.missingAPIKey
        }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }

        let endpoint = try endpoint(for: provider)
        var request = providerRequest(url: endpoint, timeout: aiProviderChatRequestTimeoutSeconds)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "chat")

        request.httpBody = try chatRequestBody(
            provider: provider,
            model: trimmedModel,
            messages: messages,
            contextMessageLimit: contextMessageLimit,
            stream: false
        )

        let (data, response) = try await boundedProviderData(
            for: request,
            successMaxBytes: aiProviderTextResponseMaxBytes,
            successLabel: "AI chat response"
        )

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        return chatText(from: data) ?? String(data: data, encoding: .utf8) ?? ""
    }

    public func stream(
        provider: ProviderConfig,
        apiKey: String,
        model: String,
        messages: [ChatMessage],
        contextMessageLimit: Int = 24,
        proxyToken: String = "",
        onPartial: @Sendable (String) async -> Void
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        if providerNeedsClientKey(provider), trimmedKey.isEmpty {
            throw AiError.missingAPIKey
        }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }
        if provider.kind == .openAIResponses {
            do {
                if let received = try await streamResponsesWebSocket(
                    session: session,
                    provider: provider,
                    apiKey: trimmedKey,
                    model: trimmedModel,
                    messages: messages,
                    contextMessageLimit: contextMessageLimit,
                    proxyToken: proxyToken,
                    onPartial: onPartial
                ) {
                    return received
                }
            } catch is ResponsesWebSocketFallbackError {
                // The HTTP/SSE path below owns fallback when the WS handshake fails before output.
            }
        }


        var request = providerRequest(
            url: try endpoint(for: provider),
            timeout: aiProviderStreamIdleTimeoutSeconds
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "chat")
        request.httpBody = try chatRequestBody(
            provider: provider,
            model: trimmedModel,
            messages: messages,
            contextMessageLimit: contextMessageLimit,
            stream: true
        )

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let data = try await session.boundedData(
                from: bytes,
                response: response,
                maxBytes: aiProviderErrorResponseMaxBytes,
                label: "AI provider error response"
            )
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }
        try session.assertBoundedExpectedContentLength(
            for: bytes,
            response: response,
            maxBytes: aiProviderStreamResponseMaxBytes,
            label: "AI provider stream response"
        )

        var received = ""
        var eventData: [String] = []
        var lineData = Data()
        var totalBytes = 0
        var streamShouldContinue = true

        func consumeSseLine(_ rawLine: String) -> (partial: String?, shouldContinue: Bool) {
            let line = rawLine.trimmingCharacters(in: CharacterSet(charactersIn: "\r"))

            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let event = sseEventDelta(from: eventData)
                eventData.removeAll(keepingCapacity: true)
                if let delta = event.delta, !delta.isEmpty {
                    received += delta
                    return (received, event.shouldContinue)
                }
                return (nil, event.shouldContinue)
            }

            if line.hasPrefix("data:") {
                eventData.append(String(line.dropFirst("data:".count)).trimmingCharacters(in: .whitespaces))
            } else if line.hasPrefix(":") ||
                line.hasPrefix("event:") ||
                line.hasPrefix("id:") ||
                line.hasPrefix("retry:") {
                return (nil, true)
            } else if line.hasPrefix("{") || line.hasPrefix("[") {
                eventData.append(line)
            }

            return (nil, true)
        }

        streamLoop: for try await byte in bytes {
            do {
                totalBytes = try accumulateResponseBodyBytes(
                    currentBytes: totalBytes,
                    nextBytes: 1,
                    maxBytes: aiProviderStreamResponseMaxBytes,
                    label: "AI provider stream response"
                )
            } catch {
                bytes.task.cancel()
                throw error
            }

            if byte == 0x0A {
                let result = consumeSseLine(String(decoding: lineData, as: UTF8.self))
                lineData.removeAll(keepingCapacity: true)
                if let partial = result.partial {
                    await onPartial(partial)
                }
                if !result.shouldContinue {
                    streamShouldContinue = false
                    bytes.task.cancel()
                    break streamLoop
                }
            } else {
                lineData.append(byte)
            }
        }

        if streamShouldContinue, !lineData.isEmpty {
            let result = consumeSseLine(String(decoding: lineData, as: UTF8.self))
            if let partial = result.partial {
                await onPartial(partial)
            }
            streamShouldContinue = result.shouldContinue
        }

        if streamShouldContinue, !eventData.isEmpty {
            let event = sseEventDelta(from: eventData)
            if let delta = event.delta, !delta.isEmpty {
                received += delta
                await onPartial(received)
            }
        }

        return try validatedChatStreamResponse(received)
    }

    public func listModels(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = ""
    ) async throws -> [String] {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if providerNeedsClientKey(provider), trimmedKey.isEmpty {
            throw AiError.missingAPIKey
        }

        var request = providerRequest(
            url: try modelListEndpoint(for: provider),
            timeout: aiProviderModelListTimeoutSeconds
        )
        request.httpMethod = "GET"
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "models")

        let (data, response) = try await boundedProviderData(
            for: request,
            successMaxBytes: aiProviderTextResponseMaxBytes,
            successLabel: "AI model list response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        let models = try parseModelIds(data)
        guard !models.isEmpty else { throw AiError.noModelsFound }
        return models
    }

    public func generateImage(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        responsesModel: String = "",
        prompt: String,
        size: String = "1024x1024"
    ) async throws -> GeneratedImage {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)

        if provider.kind == .anthropic { throw AiError.unsupportedImageAPI }
        if providerNeedsClientKey(provider), trimmedKey.isEmpty { throw AiError.missingAPIKey }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }
        guard !trimmedPrompt.isEmpty else { throw AiError.missingPrompt }

        var request = providerRequest(
            url: try imageGenerationEndpoint(for: provider),
            timeout: aiProviderImageRequestTimeoutSeconds
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "image-generations")
        request.httpBody = try imageGenerationRequestBody(model: trimmedModel, prompt: trimmedPrompt, size: size)

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if shouldTryResponsesImageFallback(statusCode: http.statusCode) {
                bytes.task.cancel()
                let generated = try await generateImageWithResponsesTool(
                    provider: provider,
                    apiKey: trimmedKey,
                    proxyToken: proxyToken,
                    responsesModel: responsesModel,
                    imageModel: trimmedModel,
                    prompt: trimmedPrompt,
                    size: size
                )
                return try await materializeGeneratedImage(generated)
            }
        }
        let isSuccess = (response as? HTTPURLResponse)
            .map { (200..<300).contains($0.statusCode) }
            ?? true
        let data = try await session.boundedData(
            from: bytes,
            response: response,
            maxBytes: isSuccess ? aiProviderImageResponseMaxBytes : aiProviderErrorResponseMaxBytes,
            label: isSuccess ? "AI image generation response" : "AI provider error response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        return try await materializeGeneratedImage(generatedImage(from: data))
    }

    public func editImage(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        responsesModel: String = "",
        prompt: String,
        image: ImageUpload,
        mask: ImageUpload? = nil,
        size: String = "1024x1024"
    ) async throws -> GeneratedImage {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)

        if provider.kind == .anthropic { throw AiError.unsupportedImageAPI }
        if providerNeedsClientKey(provider), trimmedKey.isEmpty { throw AiError.missingAPIKey }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }
        if isLikelyImageModelName(trimmedModel), !isLikelyImageEditingModelName(trimmedModel) {
            throw AiError.unsupportedImageEditModel
        }
        guard !trimmedPrompt.isEmpty else { throw AiError.missingPrompt }

        let boundary = "ZeroChat-\(UUID().uuidString)"
        var request = providerRequest(
            url: try imageEditEndpoint(for: provider),
            timeout: aiProviderImageRequestTimeoutSeconds
        )
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "image-edits")
        request.httpBody = imageEditMultipartBody(
            boundary: boundary,
            model: trimmedModel,
            prompt: trimmedPrompt,
            image: image,
            mask: mask,
            size: size
        )

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if mask == nil, shouldTryResponsesImageFallback(statusCode: http.statusCode) {
                bytes.task.cancel()
                let generated = try await editImageWithResponsesTool(
                    provider: provider,
                    apiKey: trimmedKey,
                    proxyToken: proxyToken,
                    responsesModel: responsesModel,
                    imageModel: trimmedModel,
                    prompt: trimmedPrompt,
                    image: image,
                    size: size
                )
                return try await materializeGeneratedImage(generated)
            }
        }
        let isSuccess = (response as? HTTPURLResponse)
            .map { (200..<300).contains($0.statusCode) }
            ?? true
        let data = try await session.boundedData(
            from: bytes,
            response: response,
            maxBytes: isSuccess ? aiProviderImageResponseMaxBytes : aiProviderErrorResponseMaxBytes,
            label: isSuccess ? "AI image edit response" : "AI provider error response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        return try await materializeGeneratedImage(generatedImage(from: data))
    }

    public func createSpeech(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String,
        voice: String = "alloy",
        responseFormat: String? = nil,
        speed: Double? = nil
    ) async throws -> Data {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedInput = input.trimmingCharacters(in: .whitespacesAndNewlines)

        if provider.kind == .anthropic { throw AiError.unsupportedCapabilityAPI }
        if providerNeedsClientKey(provider), trimmedKey.isEmpty { throw AiError.missingAPIKey }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }
        guard !trimmedInput.isEmpty else { throw AiError.missingInput }

        var request = providerRequest(
            url: try audioSpeechEndpoint(for: provider),
            timeout: aiProviderCapabilityRequestTimeoutSeconds
        )
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "audio-speech")
        request.httpBody = try audioSpeechRequestBody(
            model: trimmedModel,
            input: trimmedInput,
            voice: voice,
            responseFormat: responseFormat,
            speed: speed
        )

        let (data, response) = try await boundedProviderData(
            for: request,
            successMaxBytes: aiProviderAudioResponseMaxBytes,
            successLabel: "AI audio speech response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        let contentType = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
        guard providerAudioResponseLooksValid(data, contentType: contentType) else {
            throw AiError.invalidAudioResponse
        }

        return data
    }

    public func transcribeAudio(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        audio: AudioUpload,
        prompt: String? = nil,
        language: String? = nil,
        responseFormat: String? = nil,
        temperature: Double? = nil
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)

        if provider.kind == .anthropic { throw AiError.unsupportedCapabilityAPI }
        if providerNeedsClientKey(provider), trimmedKey.isEmpty { throw AiError.missingAPIKey }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }
        guard !audio.data.isEmpty else { throw AiError.missingInput }

        let boundary = "ZeroChat-\(UUID().uuidString)"
        var request = providerRequest(
            url: try audioTranscriptionEndpoint(for: provider),
            timeout: aiProviderCapabilityRequestTimeoutSeconds
        )
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "audio-transcriptions")
        request.httpBody = audioTranscriptionMultipartBody(
            boundary: boundary,
            model: trimmedModel,
            audio: audio,
            prompt: prompt,
            language: language,
            responseFormat: responseFormat,
            temperature: temperature
        )

        let (data, response) = try await boundedProviderData(
            for: request,
            successMaxBytes: aiProviderTextResponseMaxBytes,
            successLabel: "AI audio transcription response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        return String(data: data, encoding: .utf8) ?? ""
    }

    public func createEmbedding(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String
    ) async throws -> String {
        let trimmedInput = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else { throw AiError.missingInput }

        return try await postJsonCapability(
            provider: provider,
            apiKey: apiKey,
            proxyToken: proxyToken,
            model: model,
            endpoint: embeddingsEndpoint(for: provider),
            action: "embeddings",
            body: embeddingsRequestBody(model: model, input: trimmedInput)
        )
    }

    public func createEmbeddings(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: [String]
    ) async throws -> String {
        let normalizedInput = input
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !normalizedInput.isEmpty else { throw AiError.missingInput }

        return try await postJsonCapability(
            provider: provider,
            apiKey: apiKey,
            proxyToken: proxyToken,
            model: model,
            endpoint: embeddingsEndpoint(for: provider),
            action: "embeddings",
            body: embeddingsRequestBody(model: model, input: normalizedInput)
        )
    }

    public func moderateText(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        input: String
    ) async throws -> String {
        let trimmedInput = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else { throw AiError.missingInput }

        return try await postJsonCapability(
            provider: provider,
            apiKey: apiKey,
            proxyToken: proxyToken,
            model: model,
            endpoint: moderationsEndpoint(for: provider),
            action: "moderations",
            body: moderationsRequestBody(model: model, input: trimmedInput)
        )
    }

    public func createRealtimeSession(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        modalities: [String] = ["text"],
        instructions: String? = nil,
        voice: String? = nil,
        inputAudioFormat: String? = nil,
        outputAudioFormat: String? = nil
    ) async throws -> String {
        try await postJsonCapability(
            provider: provider,
            apiKey: apiKey,
            proxyToken: proxyToken,
            model: model,
            endpoint: realtimeEndpoint(for: provider),
            action: "realtime",
            body: realtimeRequestBody(
                model: model,
                modalities: modalities,
                instructions: instructions,
                voice: voice,
                inputAudioFormat: inputAudioFormat,
                outputAudioFormat: outputAudioFormat
            )
        )
    }

    public func createRealtimeClientSecret(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String = "",
        model: String,
        modalities: [String] = ["text"],
        instructions: String? = nil,
        voice: String? = nil,
        inputAudioFormat: String? = nil,
        outputAudioFormat: String? = nil
    ) async throws -> String {
        try await postJsonCapability(
            provider: provider,
            apiKey: apiKey,
            proxyToken: proxyToken,
            model: model,
            endpoint: realtimeClientSecretsEndpoint(for: provider),
            action: "realtime-client-secrets",
            body: realtimeClientSecretsRequestBody(
                model: model,
                modalities: modalities,
                instructions: instructions,
                voice: voice,
                inputAudioFormat: inputAudioFormat,
                outputAudioFormat: outputAudioFormat
            )
        )
    }

    private func generateImageWithResponsesTool(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        responsesModel: String,
        imageModel: String,
        prompt: String,
        size: String
    ) async throws -> GeneratedImage {
        let models = responsesImageModels(provider: provider, responsesModel: responsesModel, imageModel: imageModel)
        guard !models.isEmpty else { throw AiError.missingModel }

        var lastError: Error?
        for model in models {
            do {
                var request = providerRequest(
                    url: try imageResponsesEndpoint(for: provider),
                    timeout: aiProviderImageRequestTimeoutSeconds
                )
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                try applyAuthHeaders(to: &request, provider: provider, apiKey: apiKey)
                try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "image-responses")
                request.httpBody = try responsesImageGenerationRequestBody(
                    model: model,
                    prompt: prompt,
                    size: size
                )

                let (data, response) = try await boundedProviderData(
                    for: request,
                    successMaxBytes: aiProviderImageResponseMaxBytes,
                    successLabel: "AI Responses image generation response"
                )
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw aiHTTPFailure(statusCode: http.statusCode, data: data)
                }

                return try generatedImage(from: data)
            } catch {
                guard shouldTryNextResponsesImageModel(after: error) else { throw error }
                lastError = error
            }
        }

        throw lastError ?? AiError.missingModel
    }

    func materializeGeneratedImage(_ image: GeneratedImage) async throws -> GeneratedImage {
        if image.dataUrl?.isEmpty == false {
            return image
        }
        guard let source = safeRemoteImageAttachmentURL(image.url) else {
            throw AiError.imageResponseEmpty
        }

        var request = URLRequest(
            url: source,
            cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
            timeoutInterval: aiProviderImageRequestTimeoutSeconds
        )
        request.httpMethod = "GET"
        request.setValue("image/png,image/jpeg,image/webp", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.boundedData(
            for: request,
            maxBytes: maxImageFileBytes,
            label: "Generated image download"
        )
        if let http = response as? HTTPURLResponse,
           !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode)
        }
        guard let finalURL = response.url,
              safeRemoteImageAttachmentURL(finalURL.absoluteString) == source else {
            throw AiError.imageResponseEmpty
        }
        guard let mimeType = generatedImageMimeType(data) else {
            throw AiError.imageResponseEmpty
        }

        return GeneratedImage(
            dataUrl: "data:\(mimeType);base64,\(data.base64EncodedString())",
            url: nil,
            mimeType: mimeType,
            revisedPrompt: image.revisedPrompt
        )
    }

    private func editImageWithResponsesTool(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        responsesModel: String,
        imageModel: String,
        prompt: String,
        image: ImageUpload,
        size: String
    ) async throws -> GeneratedImage {
        let models = responsesImageModels(provider: provider, responsesModel: responsesModel, imageModel: imageModel)
        guard !models.isEmpty else { throw AiError.missingModel }

        var lastError: Error?
        for model in models {
            do {
                var request = providerRequest(
                    url: try imageResponsesEndpoint(for: provider),
                    timeout: aiProviderImageRequestTimeoutSeconds
                )
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                try applyAuthHeaders(to: &request, provider: provider, apiKey: apiKey)
                try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: "image-responses")
                request.httpBody = try responsesImageEditRequestBody(
                    model: model,
                    prompt: prompt,
                    image: image,
                    size: size
                )

                let (data, response) = try await boundedProviderData(
                    for: request,
                    successMaxBytes: aiProviderImageResponseMaxBytes,
                    successLabel: "AI Responses image edit response"
                )
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    throw aiHTTPFailure(statusCode: http.statusCode, data: data)
                }

                return try generatedImage(from: data)
            } catch {
                guard shouldTryNextResponsesImageModel(after: error) else { throw error }
                lastError = error
            }
        }

        throw lastError ?? AiError.missingModel
    }

    private func postJsonCapability(
        provider: ProviderConfig,
        apiKey: String,
        proxyToken: String,
        model: String,
        endpoint: URL,
        action: String,
        body: Data
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)

        if provider.kind == .anthropic { throw AiError.unsupportedCapabilityAPI }
        if providerNeedsClientKey(provider), trimmedKey.isEmpty { throw AiError.missingAPIKey }
        guard !trimmedModel.isEmpty else { throw AiError.missingModel }

        var request = providerRequest(url: endpoint, timeout: aiProviderCapabilityRequestTimeoutSeconds)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try applyAuthHeaders(to: &request, provider: provider, apiKey: trimmedKey)
        try applyProxyHeaders(to: &request, provider: provider, proxyToken: proxyToken, action: action)
        request.httpBody = body

        let (data, response) = try await boundedProviderData(
            for: request,
            successMaxBytes: aiProviderTextResponseMaxBytes,
            successLabel: "AI capability response"
        )
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw aiHTTPFailure(statusCode: http.statusCode, data: data)
        }

        return String(data: data, encoding: .utf8) ?? ""
    }

    private func boundedProviderData(
        for request: URLRequest,
        successMaxBytes: Int,
        successLabel: String
    ) async throws -> (Data, URLResponse) {
        try await session.boundedData(
            for: request,
            successMaxBytes: successMaxBytes,
            errorMaxBytes: aiProviderErrorResponseMaxBytes,
            successLabel: successLabel,
            errorLabel: "AI provider error response"
        )
    }
}

private func providerRequest(url: URL, timeout: TimeInterval) -> URLRequest {
    URLRequest(url: url, timeoutInterval: timeout)
}

private func audioBytesHaveKnownSignature(_ data: Data) -> Bool {
    let bytes = Array(data.prefix(8))
    func startsWith(_ values: [UInt8]) -> Bool {
        bytes.count >= values.count && Array(bytes.prefix(values.count)) == values
    }

    return startsWith([0x49, 0x44, 0x33]) ||
        startsWith([0x52, 0x49, 0x46, 0x46]) ||
        startsWith([0x4f, 0x67, 0x67, 0x53]) ||
        startsWith([0x66, 0x4c, 0x61, 0x43]) ||
        (bytes.count > 1 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0) ||
        (bytes.count > 7 && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70)
}

private func audioBytesLookLikeText(_ data: Data) -> Bool {
    let sample = Array(data.prefix(96))
    let firstContentByte = sample.first { byte in
        byte != 0x09 && byte != 0x0a && byte != 0x0d && byte != 0x20
    }

    if firstContentByte == 0x7b || firstContentByte == 0x5b || firstContentByte == 0x3c {
        return true
    }

    return sample.allSatisfy { byte in
        byte == 0x09 || byte == 0x0a || byte == 0x0d || (byte >= 0x20 && byte <= 0x7e)
    }
}

func providerAudioResponseLooksValid(_ data: Data, contentType: String) -> Bool {
    guard !data.isEmpty, !audioBytesLookLikeText(data) else { return false }

    let normalizedContentType = contentType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalizedContentType.hasPrefix("audio/") || normalizedContentType.contains("octet-stream") {
        return true
    }

    if audioBytesHaveKnownSignature(data) {
        return true
    }

    return !(
        normalizedContentType.contains("json") ||
        normalizedContentType.hasPrefix("text/") ||
        normalizedContentType.contains("html") ||
        normalizedContentType.contains("xml")
    )
}

private func responsesImageModels(provider: ProviderConfig, responsesModel: String, imageModel: String) -> [String] {
    let primary = responsesModel.trimmingCharacters(in: .whitespacesAndNewlines)
    let ordered: [String]
    if primary.isEmpty {
        ordered = [provider.model, imageModel]
    } else {
        ordered = [primary, imageModel, provider.model]
    }
    var seen = Set<String>()
    var models: [String] = []

    for model in ordered {
        let candidate = model.trimmingCharacters(in: .whitespacesAndNewlines)
        if !candidate.isEmpty && !seen.contains(candidate) {
            seen.insert(candidate)
            models.append(candidate)
        }
    }

    return models
}

func shouldTryResponsesImageFallback(statusCode: Int) -> Bool {
    statusCode == 404 || statusCode == 405 || (500...599).contains(statusCode)
}

func shouldTryNextResponsesImageModel(after error: Error) -> Bool {
    guard let aiError = error as? AiError,
          case let .httpFailed(statusCode, _) = aiError else {
        return false
    }

    return statusCode == 400 || statusCode == 422
}

func validatedChatStreamResponse(_ response: String) throws -> String {
    guard !response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw AiError.chatResponseEmpty
    }
    return response
}

private func aiHTTPFailure(statusCode: Int, data: Data? = nil) -> AiError {
    let message = data
        .flatMap { String(data: $0, encoding: .utf8) }?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return .httpFailed(statusCode: statusCode, message: message)
}

public enum AiError: LocalizedError {
    case invalidURL
    case missingAPIKey
    case missingModel
    case unsupportedImageEditModel
    case missingPrompt
    case missingInput
    case missingAccessKey
    case noModelsFound
    case unsupportedImageAPI
    case unsupportedCapabilityAPI
    case chatResponseEmpty
    case imageResponseEmpty
    case invalidAudioResponse
    case httpFailed(statusCode: Int, message: String)
    case unsafeURL(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "URL is invalid."
        case .missingAPIKey:
            return "Provider key is required."
        case .missingModel:
            return "Model name is required."
        case .unsupportedImageEditModel:
            return "This image model does not support editing."
        case .missingPrompt:
            return "Image prompt is required."
        case .missingInput:
            return "Capability input is required."
        case .missingAccessKey:
            return "Cloudflare access key is required."
        case .noModelsFound:
            return "No models were returned by the provider."
        case .unsupportedImageAPI:
            return "This provider does not support image generation."
        case .unsupportedCapabilityAPI:
            return "This provider does not support that capability."
        case .chatResponseEmpty:
            return "The provider returned an empty response."
        case .imageResponseEmpty:
            return "Image response did not include a result"
        case .invalidAudioResponse:
            return "AI audio speech response was not valid audio."
        case let .httpFailed(statusCode, message):
            let detail = message.trimmingCharacters(in: .whitespacesAndNewlines)
            return detail.isEmpty ? "HTTP \(statusCode)" : "HTTP \(statusCode): \(detail)"
        case let .unsafeURL(label):
            return "\(label) must be a remote HTTPS URL"
        }
    }
}
