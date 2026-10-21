import Foundation

private let defaultChatContextMessageLimit = 24
private let minChatContextMessageLimit = 4
private let maxChatContextMessageLimit = 200

private let audioMimeByExtension: [String: String] = [
    "aac": "audio/aac",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
    "mp3": "audio/mpeg",
    "mp4": "audio/mp4",
    "mpeg": "audio/mpeg",
    "oga": "audio/ogg",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
    "wav": "audio/wav",
    "webm": "audio/webm"
]

private let imageMimeByExtension: [String: String] = [
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp"
]

func providerNeedsClientKey(_ provider: ProviderConfig) -> Bool {
    provider.needsApiKey || !providerRequestUsesProxy(provider)
}

public func normalizedProviderRequest(_ provider: ProviderConfig, sync: SyncConfig) -> ProviderConfig {
    if provider.clientRequestMode == true {
        var copy = provider
        copy.proxyUrl = nil
        return copy
    }

    let existingProxy = provider.proxyUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard existingProxy.isEmpty,
          sync.mode == "cloudflare",
          let endpoint = sync.workerEndpoint?.trimmingCharacters(in: .whitespacesAndNewlines),
          !endpoint.isEmpty else {
        return provider
    }

    var copy = provider
    copy.proxyUrl = endpoint
    return copy
}

public func providerRequestNeedsClientKey(_ provider: ProviderConfig, sync: SyncConfig) -> Bool {
    let requestProvider = normalizedProviderRequest(provider, sync: sync)
    return requestProvider.clientRequestMode == true ||
        requestProvider.needsApiKey ||
        !providerRequestUsesProxy(requestProvider)
}

public func providerRequestUsesProxy(_ provider: ProviderConfig) -> Bool {
    !(provider.proxyUrl ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .isEmpty
}

func endpoint(for provider: ProviderConfig) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    let root = try providerAPIRoot(provider)
    let target: String
    switch provider.kind {
    case .openAICompatible:
        target = root + "/chat/completions"
    case .openAIResponses:
        target = root + "/responses"
    case .anthropic:
        target = root + "/messages"
    }

    guard let url = URL(string: target) else {
        throw AiError.invalidURL
    }
    return url
}
func responsesWebSocketEndpoint(for provider: ProviderConfig) throws -> URL {
    let root = if let proxyUrl = provider.proxyUrl,
                   !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        try proxyRootURL(proxyUrl) + "/proxy/ws"
    } else {
        try providerAPIRoot(provider) + "/responses"
    }
    guard let parsedComponents = URLComponents(string: root) else {
        throw AiError.invalidURL
    }
    var components = parsedComponents
    components.scheme = components.scheme == "https" ? "wss" : "ws"
    guard let url = components.url else { throw AiError.invalidURL }
    return url
}

func modelListEndpoint(for provider: ProviderConfig) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    guard let url = URL(string: try providerAPIRoot(provider) + "/models") else {
        throw AiError.invalidURL
    }
    return url
}

func imageGenerationEndpoint(for provider: ProviderConfig) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    guard let url = URL(string: try providerAPIRoot(provider) + "/images/generations") else {
        throw AiError.invalidURL
    }
    return url
}

func imageEditEndpoint(for provider: ProviderConfig) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    guard let url = URL(string: try providerAPIRoot(provider) + "/images/edits") else {
        throw AiError.invalidURL
    }
    return url
}

func imageResponsesEndpoint(for provider: ProviderConfig) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    guard let url = URL(string: try providerAPIRoot(provider) + "/responses") else {
        throw AiError.invalidURL
    }
    return url
}

func audioSpeechEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/audio/speech")
}

func audioTranscriptionEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/audio/transcriptions")
}

func embeddingsEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/embeddings")
}

func moderationsEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/moderations")
}

func realtimeEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/realtime")
}

func realtimeClientSecretsEndpoint(for provider: ProviderConfig) throws -> URL {
    try capabilityEndpoint(for: provider, path: "/realtime/client_secrets")
}

private func capabilityEndpoint(for provider: ProviderConfig, path: String) throws -> URL {
    if let proxyUrl = provider.proxyUrl, !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        guard let url = URL(string: try proxyRootURL(proxyUrl) + "/proxy") else {
            throw AiError.invalidURL
        }
        return url
    }

    guard let url = URL(string: try providerAPIRoot(provider) + path) else {
        throw AiError.invalidURL
    }
    return url
}

func applyAuthHeaders(
    to request: inout URLRequest,
    provider: ProviderConfig,
    apiKey: String
) throws {
    let requestApiKey = providerNeedsClientKey(provider)
        ? apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        : ""

    if provider.kind == .anthropic {
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        if !requestApiKey.isEmpty {
            request.setValue(requestApiKey, forHTTPHeaderField: "x-api-key")
        }
    } else if !requestApiKey.isEmpty {
        request.setValue("Bearer \(requestApiKey)", forHTTPHeaderField: "Authorization")
    }
}

func applyProxyHeaders(
    to request: inout URLRequest,
    provider: ProviderConfig,
    proxyToken: String,
    action: String
) throws {
    guard let proxyUrl = provider.proxyUrl,
          !proxyUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return
    }

    let token = proxyToken.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !token.isEmpty else { throw AiError.missingAccessKey }

    request.setValue(token, forHTTPHeaderField: "x-zerochat-access-key")
    request.setValue(action, forHTTPHeaderField: "x-zerochat-proxy-action")
    request.setValue(try providerAPIRoot(provider), forHTTPHeaderField: "x-zerochat-base-url")
    request.setValue(provider.kind.rawValue, forHTTPHeaderField: "x-zerochat-provider-kind")
}

func chatRequestBody(
    provider: ProviderConfig,
    model: String,
    messages: [ChatMessage],
    contextMessageLimit: Int,
    stream: Bool
) throws -> Data {
    let contextMessages = selectContextMessages(messages, contextMessageLimit: contextMessageLimit)
    let systemContent = contextMessages
        .filter { $0.role == .system }
        .map { $0.content.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: "\n\n")
    let encoder = JSONEncoder()

    switch provider.kind {
    case .openAICompatible:
        return try encoder.encode(OpenAIChatRequest(
            model: model,
            messages: contextMessages.map { AiMessage(role: $0.role.rawValue, content: openAIChatContent($0)) },
            stream: stream
        ))
    case .openAIResponses:
        return try encoder.encode(OpenAIResponsesRequest(
            model: model,
            input: contextMessages.map { AiMessage(role: $0.role.rawValue, content: responsesChatContent($0)) },
            stream: stream
        ))
    case .anthropic:
        return try encoder.encode(AnthropicRequest(
            model: model,
            system: systemContent.isEmpty ? nil : systemContent,
            messages: contextMessages
                .filter { $0.role != .system }
                .map { AiMessage(role: $0.role.rawValue, content: anthropicChatContent($0)) },
            stream: stream
        ))
    }
}

private func chatImageAttachments(_ message: ChatMessage) -> [MessageAttachment] {
    guard message.role == .user else { return [] }

    return (message.attachments ?? []).filter {
        $0.kind == "image" &&
            $0.purpose != "mask" &&
            imageAttachmentURL($0) != nil
    }
}

private func openAIChatContent(_ message: ChatMessage) -> AiMessageContent {
    let images = chatImageAttachments(message)
    guard !images.isEmpty else { return .text(message.content) }

    var parts: [AiMessageContentPart] = []
    if !message.content.isEmpty {
        parts.append(.text(message.content, type: "text"))
    }
    parts.append(contentsOf: images.map {
        .imageURL(.object(imageAttachmentURL($0) ?? ""), type: "image_url")
    })
    return .parts(parts)
}

private func responsesChatContent(_ message: ChatMessage) -> AiMessageContent {
    let images = chatImageAttachments(message)
    guard !images.isEmpty else { return .text(message.content) }

    var parts: [AiMessageContentPart] = []
    if !message.content.isEmpty {
        parts.append(.text(message.content, type: "input_text"))
    }
    parts.append(contentsOf: images.map {
        .imageURL(.string(imageAttachmentURL($0) ?? ""), type: "input_image")
    })
    return .parts(parts)
}

private func anthropicChatContent(_ message: ChatMessage) -> AiMessageContent {
    let images = chatImageAttachments(message)
        .compactMap { imageAttachmentURL($0).flatMap(dataUrlParts) }
    guard !images.isEmpty else { return .text(message.content) }

    var parts: [AiMessageContentPart] = []
    if !message.content.isEmpty {
        parts.append(.text(message.content, type: "text"))
    }
    parts.append(contentsOf: images.map {
        .anthropicImage(mediaType: $0.mediaType, data: $0.data)
    })
    return .parts(parts)
}

private func imageAttachmentURL(_ attachment: MessageAttachment) -> String? {
    if let dataUrl = safeImageAttachmentDataURL(attachment.dataUrl)?.dataURL {
        return dataUrl
    }
    if let url = safeRemoteImageAttachmentURL(attachment.url) {
        return url.absoluteString
    }
    return nil
}

private struct DataUrlParts {
    var mediaType: String
    var data: String
}

private func dataUrlParts(_ dataUrl: String) -> DataUrlParts? {
    let parts = dataUrl.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }

    let metadata = String(parts[0])
    let data = String(parts[1])
    guard metadata.hasPrefix("data:"), !data.isEmpty else { return nil }

    let mediaType = metadata
        .dropFirst("data:".count)
        .split(separator: ";", maxSplits: 1)
        .first
        .map(String.init)?
        .trimmingCharacters(in: .whitespacesAndNewlines)

    guard let mediaType, !mediaType.isEmpty else { return nil }
    return DataUrlParts(mediaType: mediaType, data: data)
}

func audioSpeechRequestBody(
    model: String,
    input: String,
    voice: String = "alloy",
    responseFormat: String? = nil,
    speed: Double? = nil
) throws -> Data {
    try JSONEncoder().encode(AudioSpeechRequest(
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        input: input,
        voice: voice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "alloy"
            : voice.trimmingCharacters(in: .whitespacesAndNewlines),
        response_format: responseFormat?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
        speed: speed
    ))
}

func embeddingsRequestBody(model: String, input: String) throws -> Data {
    try JSONEncoder().encode(TextCapabilityStringRequest(
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        input: input
    ))
}

func embeddingsRequestBody(model: String, input: [String]) throws -> Data {
    try JSONEncoder().encode(TextCapabilityArrayRequest(
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        input: input
    ))
}

func moderationsRequestBody(model: String, input: String) throws -> Data {
    try JSONEncoder().encode(TextCapabilityStringRequest(
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        input: input
    ))
}

func realtimeRequestBody(
    model: String,
    modalities: [String] = ["text"],
    instructions: String? = nil,
    voice: String? = nil,
    inputAudioFormat: String? = nil,
    outputAudioFormat: String? = nil
) throws -> Data {
    let outputModality = normalizedRealtimeModality(modalities)

    return try JSONEncoder().encode(RealtimeRequest(
        model: model.trimmingCharacters(in: .whitespacesAndNewlines),
        modalities: normalizedRealtimeModalities(outputModality),
        instructions: instructions?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
        voice: outputModality == "audio"
            ? voice?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            : nil,
        input_audio_format: inputAudioFormat?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
        output_audio_format: outputModality == "audio"
            ? outputAudioFormat?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            : nil
    ))
}

func realtimeClientSecretsRequestBody(
    model: String,
    modalities: [String] = ["text"],
    instructions: String? = nil,
    voice: String? = nil,
    inputAudioFormat: String? = nil,
    outputAudioFormat: String? = nil
) throws -> Data {
    let outputModality = normalizedRealtimeModality(modalities)

    return try JSONEncoder().encode(RealtimeClientSecretsRequest(
        session: RealtimeClientSecretsSession(
            model: model.trimmingCharacters(in: .whitespacesAndNewlines),
            output_modalities: normalizedRealtimeModalities(outputModality),
            instructions: instructions?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
            audio: realtimeSessionAudio(
                inputAudioFormat: inputAudioFormat,
                outputAudioFormat: outputAudioFormat,
                voice: voice,
                includeOutput: outputModality == "audio"
            )
        )
    ))
}

private func normalizedRealtimeModality(_ modalities: [String]) -> String {
    for modality in modalities {
        let normalized = modality.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized == "text" || normalized == "audio" {
            return normalized
        }
    }

    return "text"
}

private func normalizedRealtimeModalities(_ modality: String) -> [String] {
    [modality]
}

private func realtimeSessionAudio(
    inputAudioFormat: String?,
    outputAudioFormat: String?,
    voice: String?,
    includeOutput: Bool
) -> RealtimeSessionAudio? {
    let inputFormat = realtimeAudioFormat(inputAudioFormat)
    let outputFormat = realtimeAudioFormat(outputAudioFormat)
    let outputVoice = voice?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    let output = includeOutput && (outputFormat != nil || outputVoice != nil)
        ? RealtimeSessionAudioOutput(format: outputFormat, voice: outputVoice)
        : nil

    guard inputFormat != nil || output != nil else { return nil }
    return RealtimeSessionAudio(
        input: inputFormat.map { RealtimeSessionAudioInput(format: $0) },
        output: output
    )
}

private func realtimeAudioFormat(_ value: String?) -> RealtimeAudioFormat? {
    guard let normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty else {
        return nil
    }

    switch normalized {
    case "pcm16", "audio/pcm":
        return RealtimeAudioFormat(type: "audio/pcm", rate: 24000)
    case "g711_ulaw", "audio/pcmu":
        return RealtimeAudioFormat(type: "audio/pcmu")
    case "g711_alaw", "audio/pcma":
        return RealtimeAudioFormat(type: "audio/pcma")
    default:
        return RealtimeAudioFormat(type: normalized)
    }
}

func imageGenerationRequestBody(model: String, prompt: String, size: String) throws -> Data {
    try JSONEncoder().encode(ImageGenerationRequest(
        model: model,
        prompt: prompt,
        n: 1,
        size: size,
        response_format: "b64_json"
    ))
}

func responsesImageGenerationRequestBody(model: String, prompt: String, size: String) throws -> Data {
    try JSONEncoder().encode(ResponsesImageGenerationRequest(
        model: model,
        input: prompt,
        tools: [ResponsesImageTool(action: "generate", size: size)]
    ))
}

func responsesImageEditRequestBody(model: String, prompt: String, image: ImageUpload, size: String) throws -> Data {
    let imageDataUrl = imageDataURL(from: image)

    return try JSONEncoder().encode(ResponsesImageEditRequest(
        model: model,
        input: [
            ResponsesImageInputMessage(
                content: [
                    ResponsesImageInputContent(type: "input_text", text: prompt, image_url: nil),
                    ResponsesImageInputContent(type: "input_image", text: nil, image_url: imageDataUrl)
                ]
            )
        ],
        tools: [ResponsesImageTool(action: "edit", size: size)]
    ))
}

func imageEditMultipartBody(
    boundary: String,
    model: String,
    prompt: String,
    image: ImageUpload,
    mask: ImageUpload?,
    size: String
) -> Data {
    var files = [
        MultipartFile(field: "image", upload: MultipartUpload(image))
    ]
    if let mask {
        files.append(MultipartFile(field: "mask", upload: MultipartUpload(mask)))
    }

    return multipartBody(
        boundary: boundary,
        fields: [
            "model": model,
            "prompt": prompt,
            "n": "1",
            "size": size,
            "response_format": "b64_json"
        ],
        files: files
    )
}

func audioTranscriptionMultipartBody(
    boundary: String,
    model: String,
    audio: AudioUpload,
    prompt: String? = nil,
    language: String? = nil,
    responseFormat: String? = nil,
    temperature: Double? = nil
) -> Data {
    var fields = [
        "model": model.trimmingCharacters(in: .whitespacesAndNewlines)
    ]
    if let value = prompt?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
        fields["prompt"] = value
    }
    if let value = language?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
        fields["language"] = value
    }
    if let value = responseFormat?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty {
        fields["response_format"] = value
    }
    if let temperature {
        fields["temperature"] = decimalString(temperature)
    }

    return multipartBody(
        boundary: boundary,
        fields: fields,
        files: [
            MultipartFile(field: "file", upload: MultipartUpload(audio))
        ]
    )
}

func sseEventDelta(from eventData: [String]) -> (shouldContinue: Bool, delta: String?) {
    let data = eventData
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    if data.isEmpty {
        return (true, nil)
    }
    if data == "[DONE]" {
        return (false, nil)
    }

    return (true, chatDelta(from: data))
}

func parseModelIds(_ data: Data) throws -> [String] {
    let root = try JSONSerialization.jsonObject(with: data)
    let items: [Any]

    if let array = root as? [Any] {
        items = array
    } else if let record = root as? [String: Any] {
        items = (record["data"] as? [Any]) ??
            (record["models"] as? [Any]) ??
            (record["result"] as? [Any]) ??
            []
    } else {
        items = []
    }

    let models = Set(items.compactMap(readModelId))
    return models.sorted()
}

func generatedImage(from data: Data) throws -> GeneratedImage {
    guard
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        throw AiError.imageResponseEmpty
    }

    if let image = generatedImageFromImagesAPI(root) ?? generatedImageFromResponsesAPI(root) {
        return image
    }

    throw AiError.imageResponseEmpty
}

private let acceptedImageAttachmentMimeTypes: Set<String> = [
    "image/jpeg",
    "image/png",
    "image/webp"
]

private let maxImageAttachmentBase64Bytes = ((maxImageFileBytes + 2) / 3) * 4
let maxImageAttachmentDataURLBytes =
    "data:image/jpeg;base64,".utf8.count + maxImageAttachmentBase64Bytes

private func acceptedImageAttachmentMimeType(_ value: String) -> String? {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if normalized == "image/jpg" {
        return "image/jpeg"
    }
    return acceptedImageAttachmentMimeTypes.contains(normalized) ? normalized : nil
}

public func normalizedImageAttachmentMimeType(_ value: String?) -> String {
    guard let value else { return "image/png" }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let format = normalized.hasPrefix("image/") ? normalized : "image/\(normalized)"
    return acceptedImageAttachmentMimeType(format) ?? "image/png"
}

private func containsURLWhitespaceOrControl(_ value: String) -> Bool {
    value.unicodeScalars.contains { scalar in
        CharacterSet.whitespacesAndNewlines.contains(scalar) ||
            CharacterSet.controlCharacters.contains(scalar)
    }
}

private func validImageAttachmentBase64(_ value: String) -> Bool {
    guard !value.isEmpty, !containsURLWhitespaceOrControl(value) else { return false }

    let paddingStart = value.firstIndex(of: "=") ?? value.endIndex
    let body = value[..<paddingStart]
    let padding = value[paddingStart...]
    let alphabet = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")

    guard body.unicodeScalars.allSatisfy(alphabet.contains) else { return false }
    guard padding.count <= 2, padding.allSatisfy({ $0 == "=" }) else { return false }
    guard body.utf8.count % 4 != 1 else { return false }

    return padding.isEmpty || value.utf8.count % 4 == 0
}

func imageAttachmentDecodedBase64ByteCount(
    encodedByteCount: Int,
    paddingCount: Int
) -> Int? {
    guard encodedByteCount > 0,
          (0...2).contains(paddingCount),
          encodedByteCount % 4 != 1,
          paddingCount == 0 || encodedByteCount % 4 == 0 else {
        return nil
    }

    let (fullGroupBytes, multipliedOverflow) =
        (encodedByteCount / 4).multipliedReportingOverflow(by: 3)
    guard !multipliedOverflow else { return nil }

    if paddingCount > 0 {
        guard fullGroupBytes >= paddingCount else { return nil }
        return fullGroupBytes - paddingCount
    }

    let remainderBytes = encodedByteCount % 4 == 2 ? 1 : encodedByteCount % 4 == 3 ? 2 : 0
    let (decodedByteCount, additionOverflow) = fullGroupBytes.addingReportingOverflow(remainderBytes)
    return additionOverflow ? nil : decodedByteCount
}

public func safeImageAttachmentDataURL(
    _ value: String?
) -> (dataURL: String, mimeType: String)? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty, !containsURLWhitespaceOrControl(trimmed) else { return nil }
    guard let separator = trimmed.firstIndex(of: ",") else { return nil }

    let metadata = String(trimmed[..<separator]).lowercased()
    guard metadata.hasPrefix("data:"), metadata.hasSuffix(";base64") else { return nil }

    let rawMimeType = String(metadata.dropFirst("data:".count).dropLast(";base64".count))
    guard let mimeType = acceptedImageAttachmentMimeType(rawMimeType) else { return nil }

    let payload = String(trimmed[trimmed.index(after: separator)...])
    guard validImageAttachmentBase64(payload) else { return nil }
    let paddingCount = payload.reversed().prefix(while: { $0 == "=" }).count
    guard let decodedByteCount = imageAttachmentDecodedBase64ByteCount(
        encodedByteCount: payload.utf8.count,
        paddingCount: paddingCount
    ), decodedByteCount <= maxImageFileBytes else {
        return nil
    }

    return ("data:\(mimeType);base64,\(payload)", mimeType)
}

public func safeRemoteImageAttachmentURL(_ value: String?) -> URL? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !trimmed.isEmpty, !containsURLWhitespaceOrControl(trimmed) else { return nil }

    let lowercased = trimmed.lowercased()
    let prefixLength = lowercased.hasPrefix("https://") ? 8 : lowercased.hasPrefix("http://") ? 7 : 0
    guard prefixLength > 0 else { return nil }

    let authority = lowercased.dropFirst(prefixLength)
    guard !authority.isEmpty, authority.first != "/" else { return nil }
    guard let components = URLComponents(string: trimmed) else { return nil }

    let scheme = components.scheme?.lowercased()
    let host = components.host ?? ""
    guard scheme == "http" || scheme == "https" else { return nil }
    guard components.user == nil, components.password == nil else { return nil }
    guard !host.isEmpty, !isDisallowedRemoteHost(host) else { return nil }

    return components.url
}

private func generatedImageFromImagesAPI(_ root: [String: Any]) -> GeneratedImage? {
    guard
        let items = root["data"] as? [[String: Any]],
        let item = items.first
    else {
        return nil
    }

    return generatedImageFromRecord(item)
}

private func generatedImageFromResponsesAPI(_ root: [String: Any]) -> GeneratedImage? {
    guard let output = root["output"] as? [[String: Any]] else {
        return nil
    }

    for item in output where item["type"] as? String == "image_generation_call" {
        if let image = generatedImageFromRecord(item) {
            return image
        }
    }

    return nil
}

private func generatedImageFromRecord(_ item: [String: Any]) -> GeneratedImage? {
    let mimeType = (item["mime_type"] as? String) ??
        (item["mimeType"] as? String) ??
        imageMimeType(from: item["output_format"] as? String)
    let revisedPrompt = item["revised_prompt"] as? String

    if let raw = (item["b64_json"] as? String) ?? (item["result"] as? String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let candidate = trimmed.hasPrefix("data:") ? trimmed : "data:\(mimeType);base64,\(trimmed)"
            if let safeData = safeImageAttachmentDataURL(candidate) {
                return GeneratedImage(
                    dataUrl: safeData.dataURL,
                    url: nil,
                    mimeType: safeData.mimeType,
                    revisedPrompt: revisedPrompt
                )
            }
        }
    }

    if let raw = item["url"] as? String {
        if let safeURL = safeRemoteImageAttachmentURL(raw) {
            return GeneratedImage(
                dataUrl: nil,
                url: safeURL.absoluteString,
                mimeType: mimeType,
                revisedPrompt: revisedPrompt
            )
        }
    }

    return nil
}

private func imageMimeType(from format: String?) -> String {
    normalizedImageAttachmentMimeType(format)
}

private func imageMimeType(fromFileName fileName: String) -> String {
    let extensionName = fileName
        .split(separator: ".")
        .last
        .map(String.init)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    return imageMimeByExtension[extensionName] ?? "image/png"
}

private func imageDataURL(from image: ImageUpload) -> String {
    let upload = MultipartUpload(image)
    return "data:\(upload.mimeType);base64,\(upload.data.base64EncodedString())"
}

private func audioMimeType(fromFileName fileName: String) -> String {
    let extensionName = fileName
        .split(separator: ".")
        .last
        .map(String.init)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() ?? ""
    return audioMimeByExtension[extensionName] ?? "audio/webm"
}

func chatText(from data: Data) -> String? {
    guard
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        return nil
    }

    if let outputText = (root["output_text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
       !outputText.isEmpty {
        return outputText
    }

    if let choices = root["choices"] as? [[String: Any]],
       let first = choices.first {
        if let message = first["message"] as? [String: Any] {
            let content = openAIContentText(message["content"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !content.isEmpty {
                return content
            }
        }
        if let delta = first["delta"] as? [String: Any] {
            let content = openAIContentText(delta["content"])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !content.isEmpty {
                return content
            }
        }
    }

    if let output = root["output"] as? [[String: Any]] {
        let text = output.flatMap { item -> [String] in
            guard let content = item["content"] as? [[String: Any]] else {
                return []
            }
            return content.compactMap { part in
                ((part["text"] ?? part["output_text"]) as? String)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")

        if !text.isEmpty {
            return text
        }
    }

    if let content = root["content"] as? [[String: Any]] {
        let text = content.compactMap { item in
            (item["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")

        if !text.isEmpty {
            return text
        }
    }

    return nil
}

private func openAIContentText(_ value: Any?) -> String {
    if let text = value as? String {
        return text
    }

    guard let parts = value as? [[String: Any]] else {
        return ""
    }

    return parts.compactMap { part in
        guard
            part["type"] as? String == "text",
            let text = part["text"] as? String
        else {
            return nil
        }
        return text
    }
    .joined()
}

private func providerAPIRoot(_ provider: ProviderConfig) throws -> String {
    let base = try safeBaseURL(provider.baseUrl, label: "Base URL")

    if base.hasSuffix("/chat/completions") {
        return String(base.dropLast("/chat/completions".count))
    }

    if base.hasSuffix("/responses") {
        return String(base.dropLast("/responses".count))
    }

    if base.hasSuffix("/messages") {
        return String(base.dropLast("/messages".count))
    }

    if base.hasSuffix("/models") {
        return String(base.dropLast("/models".count))
    }

    if base.hasSuffix("/images/generations") {
        return String(base.dropLast("/images/generations".count))
    }

    if base.hasSuffix("/images/edits") {
        return String(base.dropLast("/images/edits".count))
    }

    if base.hasSuffix("/audio/speech") {
        return String(base.dropLast("/audio/speech".count))
    }

    if base.hasSuffix("/audio/transcriptions") {
        return String(base.dropLast("/audio/transcriptions".count))
    }

    if base.hasSuffix("/embeddings") {
        return String(base.dropLast("/embeddings".count))
    }

    if base.hasSuffix("/moderations") {
        return String(base.dropLast("/moderations".count))
    }

    if base.hasSuffix("/realtime/client_secrets") {
        return String(base.dropLast("/realtime/client_secrets".count))
    }

    if base.hasSuffix("/realtime") {
        return String(base.dropLast("/realtime".count))
    }

    return base
}

private func safeBaseURL(_ value: String, label: String) throws -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let components = URLComponents(string: trimmed), let scheme = components.scheme else {
        throw AiError.invalidURL
    }

    let host = components.host ?? ""
    guard scheme == "https" else {
        throw AiError.unsafeURL(label)
    }
    guard components.user == nil, components.password == nil else {
        throw AiError.unsafeURL(label)
    }
    guard components.query == nil, components.fragment == nil else {
        throw AiError.unsafeURL(label)
    }
    guard !host.isEmpty, !isDisallowedRemoteHost(host) else {
        throw AiError.unsafeURL(label)
    }

    guard var base = components.url?.absoluteString else {
        throw AiError.invalidURL
    }

    while base.hasSuffix("/") {
        base.removeLast()
    }

    return base
}

private func proxyRootURL(_ value: String) throws -> String {
    let base = try safeBaseURL(value, label: "Proxy URL")

    if base.hasSuffix("/proxy/hosts") {
        return String(base.dropLast("/proxy/hosts".count))
    }

    if base.hasSuffix("/proxy") {
        return String(base.dropLast("/proxy".count))
    }

    return base
}

private func isLegacyIPv4Label(_ label: Substring) -> Bool {
    let bytes = Array(label.utf8)
    let isDecimal = !bytes.isEmpty && bytes.allSatisfy({ (48...57).contains($0) })
    let isHexadecimal = bytes.count > 2 &&
        bytes[0] == 48 &&
        (bytes[1] == 88 || bytes[1] == 120) &&
        bytes.dropFirst(2).allSatisfy({
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        })
    return isDecimal || isHexadecimal
}

private func isDisallowedRemoteHost(_ host: String) -> Bool {
    let normalized = host
        .lowercased()
        .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        .trimmingCharacters(in: CharacterSet(charactersIn: "."))

    if normalized == "localhost" ||
        normalized.hasSuffix(".localhost") ||
        normalized.hasSuffix(".local") ||
        normalized.hasSuffix(".lan") ||
        normalized.hasSuffix(".home.arpa") {
        return true
    }

    if let octets = parseIPv4(normalized) {
        return normalized != octets.map({ String($0) }).joined(separator: ".") ||
            isDisallowedIPv4(octets)
    }

    if !normalized.contains(":") {
        return !normalized.contains(".") ||
            normalized.split(separator: ".", omittingEmptySubsequences: false).allSatisfy(isLegacyIPv4Label)
    }

    if let embeddedIPv4 = embeddedIPv4FromIPv6(normalized), isDisallowedIPv4(embeddedIPv4) {
        return true
    }

    if let ipv6 = parseIPv6Hextets(normalized) {
        let first = ipv6[0]
        return normalized == "::" ||
            normalized == "::1" ||
            (first == 0x100 && ipv6.dropFirst().prefix(3).allSatisfy({ $0 == 0 })) ||
            (first == 0x2001 && ipv6[1] == 0x0db8) ||
            (first & 0xfe00) == 0xfc00 ||
            (first & 0xffc0) == 0xfe80 ||
            (first & 0xff00) == 0xff00
    }

    return normalized == "::1" ||
        normalized.hasPrefix("fc") ||
        normalized.hasPrefix("fd") ||
        normalized.hasPrefix("fe80:") ||
        normalized.hasPrefix("ff")
}

private func isDisallowedIPv4(_ octets: [Int]) -> Bool {
    let first = octets[0]
    let second = octets[1]
    let third = octets[2]

    return first == 0 ||
        first == 10 ||
        first == 127 ||
        (first == 169 && second == 254) ||
        (first == 172 && (16...31).contains(second)) ||
        (first == 192 && second == 0 && [0, 2].contains(third)) ||
        (first == 192 && second == 88 && third == 99) ||
        (first == 192 && second == 168) ||
        (first == 198 && [18, 19].contains(second)) ||
        (first == 198 && second == 51 && third == 100) ||
        (first == 203 && second == 0 && third == 113) ||
        (first == 100 && (64...127).contains(second)) ||
        first >= 224
}

private func parseIPv4(_ value: String) -> [Int]? {
    let parts = value.split(separator: ".")

    guard parts.count == 4 else {
        return nil
    }

    let octets = parts.compactMap { part -> Int? in
        guard !part.isEmpty, part.allSatisfy({ $0.isNumber }) else {
            return nil
        }
        return Int(part)
    }

    guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
        return nil
    }

    return octets
}

private func parseIPv6Hextets(_ value: String) -> [Int]? {
    func parsePart(_ part: String) -> [Int]? {
        guard !part.isEmpty else {
            return nil
        }

        if part.contains(".") {
            guard let ipv4 = parseIPv4(part) else {
                return nil
            }

            return [ipv4[0] * 256 + ipv4[1], ipv4[2] * 256 + ipv4[3]]
        }

        guard
            part.range(of: #"^[0-9a-fA-F]{1,4}$"#, options: .regularExpression) != nil,
            let value = Int(part, radix: 16)
        else {
            return nil
        }

        return [value]
    }

    func parseSide(_ side: String) -> [Int]? {
        guard !side.isEmpty else {
            return []
        }

        var hextets: [Int] = []

        for part in side.split(separator: ":", omittingEmptySubsequences: false) {
            guard let parsed = parsePart(String(part)) else {
                return nil
            }

            hextets.append(contentsOf: parsed)
        }

        return hextets
    }

    let sections = value.components(separatedBy: "::")

    guard sections.count <= 2 else {
        return nil
    }

    guard let left = parseSide(sections[0]) else {
        return nil
    }

    let right: [Int]
    if sections.count == 2 {
        guard let parsedRight = parseSide(sections[1]) else {
            return nil
        }
        right = parsedRight
    } else {
        right = []
    }

    if sections.count == 1 {
        return left.count == 8 ? left : nil
    }

    let zeros = 8 - left.count - right.count

    guard zeros >= 1 else {
        return nil
    }

    return left + Array(repeating: 0, count: zeros) + right
}

private func embeddedIPv4FromIPv6(_ value: String) -> [Int]? {
    guard let hextets = parseIPv6Hextets(value) else {
        return nil
    }

    func fromWords(_ firstWord: Int, _ secondWord: Int) -> [Int] {
        [
            firstWord >> 8,
            firstWord & 255,
            secondWord >> 8,
            secondWord & 255,
        ]
    }

    if hextets.prefix(5).allSatisfy({ $0 == 0 }) &&
        (hextets[5] == 0 || hextets[5] == 0xffff) {
        return fromWords(hextets[6], hextets[7])
    }

    if hextets[0] == 0x64 &&
        hextets[1] == 0xff9b &&
        hextets.dropFirst(2).prefix(4).allSatisfy({ $0 == 0 }) {
        return fromWords(hextets[6], hextets[7])
    }

    if hextets[0] == 0x64 &&
        hextets[1] == 0xff9b &&
        hextets[2] == 1 &&
        hextets.dropFirst(3).prefix(3).allSatisfy({ $0 == 0 }) {
        return fromWords(hextets[6], hextets[7])
    }

    if hextets[0] == 0x2002 {
        return fromWords(hextets[1], hextets[2])
    }

    return nil
}

private func normalizeChatContextMessageLimit(_ value: Int) -> Int {
    let candidate = value <= 0 ? defaultChatContextMessageLimit : value
    return min(max(candidate, minChatContextMessageLimit), maxChatContextMessageLimit)
}

private func selectContextMessages(
    _ messages: [ChatMessage],
    contextMessageLimit: Int
) -> [ChatMessage] {
    let normalizedLimit = normalizeChatContextMessageLimit(contextMessageLimit)
    let systemMessages = messages.filter {
        $0.role == .system &&
            !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    let chatMessages = messages
        .filter { $0.role != .system }
        .suffix(normalizedLimit)

    return systemMessages + Array(chatMessages)
}

private func readModelId(_ value: Any) -> String? {
    if let text = value as? String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    guard let record = value as? [String: Any] else {
        return nil
    }

    for key in ["id", "name", "model", "slug"] {
        if let text = record[key] as? String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return trimmed
            }
        }
    }

    return nil
}

private func multipartBody(
    boundary: String,
    fields: [String: String],
    files: [MultipartFile]
) -> Data {
    var data = Data()

    for (name, value) in fields {
        data.appendUTF8("--\(boundary)\r\n")
        data.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        data.appendUTF8("\(value)\r\n")
    }

    for file in files {
        data.appendUTF8("--\(boundary)\r\n")
        data.appendUTF8("Content-Disposition: form-data; name=\"\(file.field)\"; filename=\"\(file.upload.fileName)\"\r\n")
        data.appendUTF8("Content-Type: \(file.upload.mimeType)\r\n\r\n")
        data.append(file.upload.data)
        data.appendUTF8("\r\n")
    }

    data.appendUTF8("--\(boundary)--\r\n")
    return data
}

private func chatDelta(from text: String) -> String? {
    guard
        let data = text.data(using: .utf8),
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        return nil
    }

    return openAIChoiceDelta(from: root) ??
        responsesDelta(from: root) ??
        anthropicDelta(from: root)
}

private func openAIChoiceDelta(from root: [String: Any]) -> String? {
    guard
        let choices = root["choices"] as? [[String: Any]],
        let first = choices.first
    else {
        return nil
    }

    if let delta = first["delta"] as? [String: Any],
       !openAIContentText(delta["content"]).isEmpty {
        return openAIContentText(delta["content"])
    }

    if let message = first["message"] as? [String: Any],
       !openAIContentText(message["content"]).isEmpty {
        return openAIContentText(message["content"])
    }

    return nil
}

private func responsesDelta(from root: [String: Any]) -> String? {
    let type = root["type"] as? String ?? ""
    if !type.isEmpty, !type.contains("delta") {
        return nil
    }

    if let delta = root["delta"] as? String {
        return delta
    }

    if let response = root["response"] as? [String: Any],
       let delta = response["delta"] as? String {
        return delta
    }

    return nil
}

private func anthropicDelta(from root: [String: Any]) -> String? {
    let type = root["type"] as? String ?? ""
    if !type.isEmpty, type != "content_block_delta" {
        return nil
    }

    guard
        let delta = root["delta"] as? [String: Any],
        let text = delta["text"] as? String
    else {
        return nil
    }

    return text
}

private struct OpenAIChatRequest: Encodable {
    var model: String
    var messages: [AiMessage]
    var stream = false
    var temperature = 0.7
}

private struct OpenAIResponsesRequest: Encodable {
    var model: String
    var input: [AiMessage]
    var stream = false
    var store = false
    var temperature = 0.7
}

private struct AnthropicRequest: Encodable {
    var model: String
    var system: String?
    var messages: [AiMessage]
    var stream = false
    var max_tokens = 4096
}

private struct AiMessage: Encodable {
    var role: String
    var content: AiMessageContent
}

private enum AiMessageContent: Encodable {
    case text(String)
    case parts([AiMessageContentPart])

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let value):
            try container.encode(value)
        case .parts(let value):
            try container.encode(value)
        }
    }
}

private struct AiMessageContentPart: Encodable {
    var type: String
    var text: String?
    var image_url: AiImageURL?
    var source: AnthropicImageSource?

    static func text(_ text: String, type: String) -> AiMessageContentPart {
        AiMessageContentPart(type: type, text: text, image_url: nil, source: nil)
    }

    static func imageURL(_ imageURL: AiImageURL, type: String) -> AiMessageContentPart {
        AiMessageContentPart(type: type, text: nil, image_url: imageURL, source: nil)
    }

    static func anthropicImage(mediaType: String, data: String) -> AiMessageContentPart {
        AiMessageContentPart(
            type: "image",
            text: nil,
            image_url: nil,
            source: AnthropicImageSource(media_type: mediaType, data: data)
        )
    }
}

private enum AiImageURL: Encodable {
    case string(String)
    case object(String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(OpenAIImageURL(url: value))
        }
    }
}

private struct OpenAIImageURL: Encodable {
    var url: String
}

private struct AnthropicImageSource: Encodable {
    var type = "base64"
    var media_type: String
    var data: String
}

private struct ImageGenerationRequest: Encodable {
    var model: String
    var prompt: String
    var n: Int
    var size: String
    var response_format: String
}

private struct AudioSpeechRequest: Encodable {
    var model: String
    var input: String
    var voice: String
    var response_format: String?
    var speed: Double?
}

private struct TextCapabilityStringRequest: Encodable {
    var model: String
    var input: String
}

private struct TextCapabilityArrayRequest: Encodable {
    var model: String
    var input: [String]
}

private struct RealtimeRequest: Encodable {
    var model: String
    var modalities: [String]
    var instructions: String?
    var voice: String?
    var input_audio_format: String?
    var output_audio_format: String?
}

private struct RealtimeClientSecretsRequest: Encodable {
    var expires_after = RealtimeClientSecretsExpiry()
    var session: RealtimeClientSecretsSession
}

private struct RealtimeClientSecretsExpiry: Encodable {
    var anchor = "created_at"
    var seconds = 600
}

private struct RealtimeClientSecretsSession: Encodable {
    var type = "realtime"
    var model: String
    var output_modalities: [String]
    var instructions: String?
    var audio: RealtimeSessionAudio?
}

private struct RealtimeSessionAudio: Encodable {
    var input: RealtimeSessionAudioInput?
    var output: RealtimeSessionAudioOutput?
}

private struct RealtimeSessionAudioInput: Encodable {
    var format: RealtimeAudioFormat
}

private struct RealtimeSessionAudioOutput: Encodable {
    var format: RealtimeAudioFormat?
    var voice: String?
}

private struct RealtimeAudioFormat: Encodable {
    var type: String
    var rate: Int?
}

private struct ResponsesImageGenerationRequest: Encodable {
    var model: String
    var input: String
    var tools: [ResponsesImageTool]
    var store = false
}

private struct ResponsesImageEditRequest: Encodable {
    var model: String
    var input: [ResponsesImageInputMessage]
    var tools: [ResponsesImageTool]
    var store = false
}

private struct ResponsesImageTool: Encodable {
    var type = "image_generation"
    var action: String
    var size: String
}

private struct ResponsesImageInputMessage: Encodable {
    var role = "user"
    var content: [ResponsesImageInputContent]
}

private struct ResponsesImageInputContent: Encodable {
    var type: String
    var text: String?
    var image_url: String?
}

private struct MultipartFile {
    var field: String
    var upload: MultipartUpload
}

private struct MultipartUpload {
    var data: Data
    var fileName: String
    var mimeType: String

    init(_ image: ImageUpload) {
        self.data = image.data
        self.fileName = image.fileName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "image.png"
        self.mimeType = image.mimeType.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ??
            imageMimeType(fromFileName: fileName)
    }

    init(_ audio: AudioUpload) {
        self.data = audio.data
        self.fileName = audio.fileName.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "audio.webm"
        self.mimeType = audio.mimeType.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ??
            audioMimeType(fromFileName: fileName)
    }
}

private extension Data {
    mutating func appendUTF8(_ value: String) {
        append(Data(value.utf8))
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}

private func decimalString(_ value: Double) -> String {
    value.rounded(.towardZero) == value ? String(Int64(value)) : String(value)
}
