import Foundation
import XCTest
@testable import ZeroChatCore

final class ProviderRequestTests: XCTestCase {
    func testGeneratedImageSafetyAllowsOnlyRasterDataAndPublicHTTPURLs() throws {
        let dataImage = safeImageAttachmentDataURL(" data:image/jpg;base64,YQ== ")
        XCTAssertEqual(dataImage?.dataURL, "data:image/jpeg;base64,YQ==")
        XCTAssertEqual(dataImage?.mimeType, "image/jpeg")
        XCTAssertNil(safeImageAttachmentDataURL("data:image/svg+xml;base64,PHN2Zz4="))
        XCTAssertNil(safeImageAttachmentDataURL("data:text/html;base64,PGgxPkJvb208L2gxPg=="))
        XCTAssertNil(safeImageAttachmentDataURL("data:image/png;base64,"))

        XCTAssertEqual(
            safeRemoteImageAttachmentURL(" https://cdn.example.test/image.png?size=1024 ")?.absoluteString,
            "https://cdn.example.test/image.png?size=1024"
        )

        for value in [
            "intent://open/image",
            "file:///tmp/image.png",
            "https://user:secret@cdn.example/image.png",
            "https://localhost/image.png",
            "https://192.168.1.2/image.png",
            "https:///missing-host.png"
        ] {
            XCTAssertNil(safeRemoteImageAttachmentURL(value), value)
        }
    }

    func testImageAttachmentBase64SizeAccountingEnforcesDecodedFileLimit() throws {
        XCTAssertEqual(
            imageAttachmentDecodedBase64ByteCount(encodedByteCount: 4, paddingCount: 2),
            1
        )
        XCTAssertEqual(
            imageAttachmentDecodedBase64ByteCount(encodedByteCount: 4, paddingCount: 1),
            2
        )
        XCTAssertEqual(
            imageAttachmentDecodedBase64ByteCount(encodedByteCount: 4, paddingCount: 0),
            3
        )

        let encodedLimit = ((maxImageFileBytes + 2) / 3) * 4
        XCTAssertEqual(
            imageAttachmentDecodedBase64ByteCount(
                encodedByteCount: encodedLimit,
                paddingCount: 1
            ),
            maxImageFileBytes
        )
        XCTAssertEqual(
            imageAttachmentDecodedBase64ByteCount(
                encodedByteCount: encodedLimit,
                paddingCount: 0
            ),
            maxImageFileBytes + 1
        )
    }

    func testGeneratedImageParserRejectsUnsafeProviderSources() throws {
        for value in [
            "intent://open/image",
            "https://user:secret@cdn.example/image.png",
            "https://127.0.0.1/image.png"
        ] {
            let data = try JSONSerialization.data(withJSONObject: ["data": [["url": value]]])
            XCTAssertThrowsError(try generatedImage(from: data), value)
        }

        let activeData = try JSONSerialization.data(withJSONObject: [
            "data": [["b64_json": "data:image/svg+xml;base64,PHN2Zz4="]]
        ])
        XCTAssertThrowsError(try generatedImage(from: activeData))
    }

    func testChatRequestFiltersUnsafeImportedImageSources() throws {
        let attachments = [
            attachment(id: "safe-data", dataUrl: "data:image/png;base64,AA=="),
            attachment(id: "active-data", dataUrl: "data:image/svg+xml;base64,PHN2Zz4="),
            attachment(id: "credentials", url: "https://user:secret@cdn.example/image.png"),
            attachment(id: "loopback", url: "https://127.0.0.1/image.png"),
            attachment(id: "runtime-blob", url: "blob:zerochat-image"),
            attachment(id: "safe-remote", url: "https://cdn.example.test/image.webp?size=1024")
        ]
        let message = ChatMessage(
            id: "user",
            role: .user,
            content: "inspect",
            createdAt: 1,
            attachments: attachments
        )

        for kind in [ProviderKind.openAICompatible, .openAIResponses] {
            let payload = String(
                decoding: try chatRequestBody(
                    provider: provider(kind: kind),
                    model: "gpt-5",
                    messages: [message],
                    contextMessageLimit: 24,
                    stream: true
                ),
                as: UTF8.self
            )
            XCTAssertTrue(payload.contains("data:image/png;base64,AA=="))
            XCTAssertTrue(payload.contains("cdn.example.test"))
            XCTAssertFalse(payload.contains("image/svg+xml"))
            XCTAssertFalse(payload.contains("user:secret"))
            XCTAssertFalse(payload.contains("127.0.0.1"))
            XCTAssertFalse(payload.contains("blob:zerochat-image"))
        }

        let anthropic = String(
            decoding: try chatRequestBody(
                provider: provider(kind: .anthropic),
                model: "claude-sonnet-4-5",
                messages: [message],
                contextMessageLimit: 24,
                stream: true
            ),
            as: UTF8.self
        )
        XCTAssertTrue(anthropic.contains("\"media_type\":\"image/png\""))
        XCTAssertFalse(anthropic.contains("cdn.example.test"))
        XCTAssertFalse(anthropic.contains("image/svg+xml"))
    }

    func testClientModeStripsProxyBeforeCapabilityEndpoint() throws {
        let provider = provider(
            baseUrl: "https://api.example.test/v1",
            proxyUrl: "https://proxy.example.test",
            clientRequestMode: true
        )

        let requestProvider = normalizedProviderRequest(provider, sync: SyncConfig())

        XCTAssertNil(requestProvider.proxyUrl)
        XCTAssertTrue(providerRequestNeedsClientKey(provider, sync: SyncConfig()))
        XCTAssertEqual(
            try embeddingsEndpoint(for: requestProvider).absoluteString,
            "https://api.example.test/v1/embeddings"
        )
    }

    func testCloudflareFallbackStillUsesWorkerProxy() throws {
        let provider = provider(baseUrl: "https://api.example.test/v1")
        let sync = SyncConfig(
            mode: "cloudflare",
            workerEndpoint: " https://sync.example.workers.dev "
        )
        let requestProvider = normalizedProviderRequest(provider, sync: sync)

        XCTAssertEqual(requestProvider.proxyUrl, "https://sync.example.workers.dev")
        XCTAssertFalse(providerRequestNeedsClientKey(provider, sync: sync))
        XCTAssertEqual(
            try modelListEndpoint(for: requestProvider).absoluteString,
            "https://sync.example.workers.dev/proxy"
        )
    }

    func testManagedProxyAuthOmitsStaleProviderKey() throws {
        let managed = provider(proxyUrl: "https://proxy.example.test")
        var request = URLRequest(url: try embeddingsEndpoint(for: managed))

        try applyAuthHeaders(to: &request, provider: managed, apiKey: "stale-provider-key")

        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
    }

    func testCapabilityEndpointsNormalizeKnownEndpointRoots() throws {
        let pastedEmbeddingEndpoint = provider(baseUrl: "https://api.example.test/v1/embeddings")
        let pastedAudioEndpoint = provider(baseUrl: "https://api.example.test/v1/audio/speech")
        let pastedRealtimeSecretEndpoint = provider(baseUrl: "https://api.example.test/v1/realtime/client_secrets")
        let proxied = provider(
            baseUrl: "https://api.example.test/v1/realtime",
            proxyUrl: " https://proxy.example.test "
        )
        let proxyEndpoint = provider(
            baseUrl: "https://api.example.test/v1",
            proxyUrl: "https://proxy.example.test/zerochat/proxy"
        )
        let proxyHostListEndpoint = provider(
            baseUrl: "https://api.example.test/v1",
            proxyUrl: "https://proxy.example.test/zerochat/proxy/hosts"
        )

        XCTAssertEqual(
            try audioSpeechEndpoint(for: pastedEmbeddingEndpoint).absoluteString,
            "https://api.example.test/v1/audio/speech"
        )
        XCTAssertEqual(
            try audioTranscriptionEndpoint(for: pastedAudioEndpoint).absoluteString,
            "https://api.example.test/v1/audio/transcriptions"
        )
        XCTAssertEqual(
            try embeddingsEndpoint(for: pastedAudioEndpoint).absoluteString,
            "https://api.example.test/v1/embeddings"
        )
        XCTAssertEqual(
            try moderationsEndpoint(for: pastedEmbeddingEndpoint).absoluteString,
            "https://api.example.test/v1/moderations"
        )
        XCTAssertEqual(
            try realtimeEndpoint(for: pastedEmbeddingEndpoint).absoluteString,
            "https://api.example.test/v1/realtime"
        )
        XCTAssertEqual(
            try realtimeEndpoint(for: pastedRealtimeSecretEndpoint).absoluteString,
            "https://api.example.test/v1/realtime"
        )
        XCTAssertEqual(
            try realtimeClientSecretsEndpoint(for: pastedEmbeddingEndpoint).absoluteString,
            "https://api.example.test/v1/realtime/client_secrets"
        )
        XCTAssertEqual(
            try realtimeClientSecretsEndpoint(for: pastedRealtimeSecretEndpoint).absoluteString,
            "https://api.example.test/v1/realtime/client_secrets"
        )
        XCTAssertEqual(
            try realtimeClientSecretsEndpoint(for: proxied).absoluteString,
            "https://proxy.example.test/proxy"
        )
        XCTAssertEqual(
            try endpoint(for: proxyEndpoint).absoluteString,
            "https://proxy.example.test/zerochat/proxy"
        )
        XCTAssertEqual(
            try modelListEndpoint(for: proxyEndpoint).absoluteString,
            "https://proxy.example.test/zerochat/proxy"
        )
        XCTAssertEqual(
            try imageEditEndpoint(for: proxyHostListEndpoint).absoluteString,
            "https://proxy.example.test/zerochat/proxy"
        )
    }

    func testEndpointSafetyRejectsSpecialUseIPRanges() throws {
        for baseUrl in [
            "https://192.0.2.1/v1",
            "https://198.18.0.1/v1",
            "https://198.51.100.2/v1",
            "https://203.0.113.8/v1",
            "https://224.0.0.1/v1",
            "https://[2001:db8::1]/v1",
            "https://[ff02::1]/v1",
            "https://[64:ff9b::c000:201]/v1",
            "https://[2002:c000:0201::1]/v1"
        ] {
            XCTAssertThrowsError(try endpoint(for: provider(baseUrl: baseUrl)), baseUrl)
        }
    }

    func testRemoteURLSafetyRejectsSingleLabelAndAmbiguousNumericHosts() throws {
        for host in [
            "api",
            "0",
            "2130706433",
            "0x7f000001",
            "0x7f.0.0.1",
            "0177.0.0.1",
            "127.1",
            "127.0.1",
            "999.999.999.999",
        ] {
            XCTAssertThrowsError(
                try endpoint(for: provider(baseUrl: "https://\(host)/v1")),
                host
            )
            XCTAssertNil(
                safeRemoteImageAttachmentURL("https://\(host)/image.png"),
                host
            )
        }
    }

    func testCapabilityRequestBodiesTrimMetadataWithoutRewritingInputText() throws {
        let embeddings = try jsonObject(
            embeddingsRequestBody(
                model: " text-embedding-3-large ",
                input: [" keep spaces ", "second"]
            )
        )
        let moderation = try jsonObject(
            moderationsRequestBody(
                model: " omni-moderation-latest ",
                input: " inspect this text "
            )
        )
        let realtime = try jsonObject(
            realtimeRequestBody(
                model: " gpt-realtime-2 ",
                modalities: [" text ", "", " audio "],
                instructions: " stay brief ",
                voice: " alloy ",
                inputAudioFormat: " pcm16 ",
                outputAudioFormat: " opus "
            )
        )
        let realtimeClientSecrets = try jsonObject(
            realtimeClientSecretsRequestBody(
                model: " gpt-realtime-2 ",
                modalities: [" text ", "", " audio "],
                instructions: " stay brief ",
                voice: " alloy ",
                inputAudioFormat: " pcm16 ",
                outputAudioFormat: " g711_ulaw "
            )
        )

        XCTAssertEqual(embeddings["model"] as? String, "text-embedding-3-large")
        XCTAssertEqual(embeddings["input"] as? [String], [" keep spaces ", "second"])
        XCTAssertEqual(moderation["model"] as? String, "omni-moderation-latest")
        XCTAssertEqual(moderation["input"] as? String, " inspect this text ")
        XCTAssertEqual(realtime["model"] as? String, "gpt-realtime-2")
        XCTAssertEqual(realtime["modalities"] as? [String], ["text"])
        XCTAssertEqual(realtime["instructions"] as? String, "stay brief")
        XCTAssertNil(realtime["voice"])
        XCTAssertEqual(realtime["input_audio_format"] as? String, "pcm16")
        XCTAssertNil(realtime["output_audio_format"])

        let expiry = try XCTUnwrap(realtimeClientSecrets["expires_after"] as? [String: Any])
        let session = try XCTUnwrap(realtimeClientSecrets["session"] as? [String: Any])
        let audio = try XCTUnwrap(session["audio"] as? [String: Any])
        let audioInput = try XCTUnwrap(audio["input"] as? [String: Any])
        let inputFormat = try XCTUnwrap(audioInput["format"] as? [String: Any])

        XCTAssertEqual(expiry["anchor"] as? String, "created_at")
        XCTAssertEqual(expiry["seconds"] as? Int, 600)
        XCTAssertEqual(session["type"] as? String, "realtime")
        XCTAssertEqual(session["model"] as? String, "gpt-realtime-2")
        XCTAssertEqual(session["output_modalities"] as? [String], ["text"])
        XCTAssertEqual(session["instructions"] as? String, "stay brief")
        XCTAssertEqual(inputFormat["type"] as? String, "audio/pcm")
        XCTAssertEqual(inputFormat["rate"] as? Int, 24000)
        XCTAssertNil(audio["output"])

        let audioRealtimeClientSecrets = try jsonObject(
            realtimeClientSecretsRequestBody(
                model: " gpt-realtime-2 ",
                modalities: [" audio "],
                voice: " alloy ",
                outputAudioFormat: " g711_ulaw "
            )
        )
        let audioSession = try XCTUnwrap(audioRealtimeClientSecrets["session"] as? [String: Any])
        let audioOnly = try XCTUnwrap(audioSession["audio"] as? [String: Any])
        let audioOutput = try XCTUnwrap(audioOnly["output"] as? [String: Any])
        let outputFormat = try XCTUnwrap(audioOutput["format"] as? [String: Any])

        XCTAssertEqual(audioSession["output_modalities"] as? [String], ["audio"])
        XCTAssertEqual(outputFormat["type"] as? String, "audio/pcmu")
        XCTAssertEqual(audioOutput["voice"] as? String, "alloy")
    }

    func testDallE3RemainsGenerationOnlyWhenSelectingImageModels() throws {
        var configured = provider()
        configured.imageModel = "dall-e-3"
        configured.models = ["gpt-5-mini", "dall-e-3", "gpt-image-1"]

        XCTAssertTrue(isLikelyImageModelName("dall-e-3"))
        XCTAssertFalse(isLikelyImageEditingModelName("dall-e-3"))
        XCTAssertEqual(imageEditingModelsForProvider(configured), ["gpt-image-1"])
        XCTAssertEqual(
            modelForProviderCapability(configured, capability: .imageGeneration),
            "dall-e-3"
        )
        XCTAssertEqual(
            modelForProviderCapability(configured, capability: .imageEditing),
            "gpt-image-1"
        )
        XCTAssertEqual(
            modelCapabilityKeysForModel("dall-e-3"),
            ["capability.image-generation"]
        )

        configured.models = ["gpt-5-mini", "dall-e-3"]
        XCTAssertEqual(
            modelForProviderCapability(configured, capability: .imageEditing),
            ""
        )
    }

    func testFetchedModelListOverridesStaleConfiguredImageModel() throws {
        var configured = provider()
        configured.imageModel = "dall-e-3"
        configured.models = ["gpt-5.5", "gpt-image-1"]

        XCTAssertEqual(
            selectableModelsForProvider(configured),
            ["gpt-5.5", "gpt-image-1"]
        )
        XCTAssertEqual(imageModelsForProvider(configured), ["gpt-image-1"])
        XCTAssertEqual(
            modelForProviderCapability(configured, capability: .imageGeneration),
            "gpt-image-1"
        )
        XCTAssertEqual(
            modelForProviderCapability(configured, capability: .imageEditing),
            "gpt-image-1"
        )
    }

    func testChatModelPreferenceIgnoresDatedSnapshotTokens() throws {
        XCTAssertEqual(
            preferredChatModel(["gpt-5.5", "gpt-5-2025-08-07"]),
            "gpt-5.5"
        )
    }

    func testFetchedModelRefreshUpdatesAdvancedCapabilityDefaultsAndPreservesExplicitSelection() throws {
        var configured = provider()
        configured.model = "gpt-5.4-mini"
        configured.imageModel = "gpt-image-1"
        configured.audioSpeechModel = "tts-1"
        configured.audioTranscriptionModel = "whisper-1"
        configured.embeddingModel = "text-embedding-3-small"
        configured.moderationModel = "moderation-latest"
        configured.realtimeModel = "gpt-realtime"
        configured.models = [
            "gpt-5.4-mini",
            "gpt-image-1",
            "tts-1",
            "gpt-4o-transcribe",
            "whisper-1",
            "text-embedding-3-small",
            "moderation-latest",
            "gpt-realtime"
        ]

        applyFetchedProviderModels(&configured, models: [
            "gpt-5.5",
            "gpt-image-2",
            "gpt-4o-mini-tts",
            "gpt-4o-transcribe",
            "whisper-1",
            "text-embedding-3-large",
            "omni-moderation-latest",
            "gpt-realtime-2"
        ])

        XCTAssertEqual(configured.model, "gpt-5.5")
        XCTAssertEqual(configured.imageModel, "gpt-image-2")
        XCTAssertEqual(configured.audioSpeechModel, "gpt-4o-mini-tts")
        XCTAssertEqual(configured.audioTranscriptionModel, "whisper-1")
        XCTAssertEqual(configured.embeddingModel, "text-embedding-3-large")
        XCTAssertEqual(configured.moderationModel, "omni-moderation-latest")
        XCTAssertEqual(configured.realtimeModel, "gpt-realtime-2")
    }

    func testConfiguredModelListRepairsRemovedCapabilityDefaults() throws {
        var configured = provider()
        configured.model = "gpt-5.4-mini"
        configured.imageModel = "gpt-image-1"
        configured.audioSpeechModel = "tts-1"
        configured.audioTranscriptionModel = "whisper-1"
        configured.embeddingModel = "text-embedding-3-small"
        configured.moderationModel = "moderation-latest"
        configured.realtimeModel = "gpt-realtime"
        configured.models = [
            "gpt-5.4-mini",
            "gpt-image-1",
            "tts-1",
            "whisper-1",
            "text-embedding-3-small",
            "moderation-latest",
            "gpt-realtime"
        ]

        applyConfiguredProviderModels(&configured, models: [
            "gpt-5.5",
            "gpt-image-2",
            "gpt-4o-mini-tts",
            "gpt-4o-transcribe",
            "text-embedding-3-large",
            "omni-moderation-latest",
            "gpt-realtime-2"
        ])

        XCTAssertEqual(configured.model, "gpt-5.5")
        XCTAssertEqual(configured.imageModel, "gpt-image-2")
        XCTAssertEqual(configured.audioSpeechModel, "gpt-4o-mini-tts")
        XCTAssertEqual(configured.audioTranscriptionModel, "gpt-4o-transcribe")
        XCTAssertEqual(configured.embeddingModel, "text-embedding-3-large")
        XCTAssertEqual(configured.moderationModel, "omni-moderation-latest")
        XCTAssertEqual(configured.realtimeModel, "gpt-realtime-2")
    }

    func testOpaqueCatalogModelsRemainSelectableForDeclaredCapabilities() throws {
        let catalog = ["vendor-chat-v4", "vendor-vector-v7", "vendor-vision-v2"]
        var configured = provider()
        configured.capabilities = [
            "chat", "audio", "embeddings", "image-generation", "image-editing",
            "moderation", "realtime", "model-list"
        ]
        configured.models = catalog
        configured.imageModel = "vendor-vision-v2"
        configured.audioSpeechModel = "vendor-voice-v1"
        configured.audioTranscriptionModel = "vendor-listen-v1"
        configured.embeddingModel = "vendor-vector-v7"
        configured.moderationModel = "vendor-filter-v1"
        configured.realtimeModel = "vendor-session-v1"
        configured.models.append(contentsOf: [
            "vendor-voice-v1",
            "vendor-listen-v1",
            "vendor-filter-v1",
            "vendor-session-v1"
        ])

        XCTAssertEqual(modelsForProviderCapability(configured, capability: .embeddings), configured.models)
        XCTAssertEqual(modelForProviderCapability(configured, capability: .embeddings), "vendor-vector-v7")
        XCTAssertEqual(imageModelsForProvider(configured), configured.models)
        XCTAssertEqual(modelForProviderCapability(configured, capability: .imageGeneration), "vendor-vision-v2")
        XCTAssertEqual(modelForProviderAudioSpeech(configured), "vendor-voice-v1")
        XCTAssertEqual(modelForProviderAudioTranscription(configured), "vendor-listen-v1")
        XCTAssertEqual(modelForProviderCapability(configured, capability: .moderation), "vendor-filter-v1")
        XCTAssertEqual(modelForProviderCapability(configured, capability: .realtime), "vendor-session-v1")

        configured.embeddingModel = ""
        configured.imageModel = ""
        configured.audioSpeechModel = ""
        configured.audioTranscriptionModel = ""
        configured.moderationModel = ""
        configured.realtimeModel = ""
        XCTAssertEqual(modelForProviderCapability(configured, capability: .embeddings), "")
        XCTAssertEqual(modelForProviderCapability(configured, capability: .imageGeneration), "")
        XCTAssertEqual(modelForProviderAudioSpeech(configured), "")
        XCTAssertEqual(modelForProviderAudioTranscription(configured), "")
        XCTAssertEqual(modelForProviderCapability(configured, capability: .moderation), "")
        XCTAssertEqual(modelForProviderCapability(configured, capability: .realtime), "")
    }

    func testAudioModelResolversRejectStaleConfiguredModels() throws {
        var configured = provider()
        configured.models = ["tts-1", "whisper-1"]
        configured.audioSpeechModel = "removed-tts"
        configured.audioTranscriptionModel = "removed-transcription"

        XCTAssertEqual(modelForProviderAudioSpeech(configured), "tts-1")
        XCTAssertEqual(modelForProviderAudioTranscription(configured), "whisper-1")
    }
}

private func provider(
    baseUrl: String = "https://api.example.test/v1",
    proxyUrl: String? = nil,
    clientRequestMode: Bool? = nil,
    kind: ProviderKind = .openAICompatible
) -> ProviderConfig {
    ProviderConfig(
        id: "provider-1",
        name: "Provider",
        kind: kind,
        baseUrl: baseUrl,
        proxyUrl: proxyUrl,
        clientRequestMode: clientRequestMode,
        model: "gpt-5-mini",
        enabled: true,
        needsApiKey: false,
        createdAt: 0,
        updatedAt: 0
    )
}

private func attachment(
    id: String,
    dataUrl: String? = nil,
    url: String? = nil
) -> MessageAttachment {
    MessageAttachment(
        id: id,
        kind: "image",
        mimeType: "image/png",
        dataUrl: dataUrl,
        url: url,
        createdAt: 1
    )
}

private func jsonObject(_ data: Data) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}
