import Foundation
import XCTest
@testable import ZeroChatCore

final class SyncVaultValidationTests: XCTestCase {
    func testCanonicalVaultPreservesAdvancedProviderModels() throws {
        let decoded = try decodeValidatedSyncVault(try JSONEncoder().encode(canonicalVault()), decoder: JSONDecoder())
        let provider = try XCTUnwrap(decoded.data.providers.first)

        XCTAssertEqual(provider.audioSpeechModel, "gpt-4o-mini-tts")
        XCTAssertEqual(provider.audioTranscriptionModel, "gpt-4o-transcribe")
        XCTAssertEqual(provider.embeddingModel, "text-embedding-3-large")
        XCTAssertEqual(provider.moderationModel, "omni-moderation-latest")
        XCTAssertEqual(provider.realtimeModel, "gpt-realtime-2")
        XCTAssertEqual(
            decoded.data.conversations.first?.messages.first?.queuedTextRequest,
            QueuedTextRequest(providerId: "openai", model: "gpt-5.5")
        )
        XCTAssertEqual(
            decoded.data.conversations.first?.messages.first?.offlineReplayClaim,
            OfflineReplayClaim(claimId: "claim-1", owner: "tab-1")
        )

        let normalized = normalizeOfficialProviderContracts(decoded.data).snapshot.providers[0]
        XCTAssertEqual(normalized.audioSpeechModel, "gpt-4o-mini-tts")
        XCTAssertEqual(normalized.audioTranscriptionModel, "gpt-4o-transcribe")
        XCTAssertEqual(normalized.embeddingModel, "text-embedding-3-large")
        XCTAssertEqual(normalized.moderationModel, "omni-moderation-latest")
        XCTAssertEqual(normalized.realtimeModel, "gpt-realtime-2")
    }

    func testCanonicalVaultRoundTripsQueuedPromptMessageId() throws {
        var vault = canonicalVault()
        vault.data.conversations[0].messages[0].queuedTextRequest = QueuedTextRequest(
            providerId: "openai",
            model: "gpt-5.5",
            promptMessageId: "message-prompt"
        )

        let decoded = try decodeValidatedSyncVault(
            try JSONEncoder().encode(vault),
            decoder: JSONDecoder()
        )

        XCTAssertEqual(
            decoded.data.conversations[0].messages[0].queuedTextRequest,
            vault.data.conversations[0].messages[0].queuedTextRequest
        )
        XCTAssertEqual(
            decoded.data.conversations[0].messages[0].queuedTextRequest?.promptMessageId,
            "message-prompt"
        )
    }

    func testCanonicalVaultRejectsEmptyQueuedPromptMessageId() throws {
        let value = try mutateFirstMessage(canonicalVault()) { message in
            message["queuedTextRequest"] = [
                "providerId": "openai",
                "model": "gpt-5.5",
                "promptMessageId": ""
            ]
        }

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsQueuedRequestMissingProviderOrModel() throws {
        for request in [
            ["providerId": "openai"],
            ["model": "gpt-5.5"]
        ] {
            let value = try mutateFirstMessage(canonicalVault()) { message in
                message["queuedTextRequest"] = request
            }

            XCTAssertThrowsError(try decode(value))
        }
    }

    func testCanonicalVaultRejectsMissingCurrentField() throws {
        var value = try jsonObject(canonicalVault())
        var data = try XCTUnwrap(value["data"] as? [String: Any])
        data.removeValue(forKey: "preferences")
        value["data"] = data

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsUnknownField() throws {
        var value = try jsonObject(canonicalVault())
        var data = try XCTUnwrap(value["data"] as? [String: Any])
        var providers = try XCTUnwrap(data["providers"] as? [[String: Any]])
        providers[0]["unexpected"] = true
        data["providers"] = providers
        value["data"] = data

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsInvalidNestedMessageStatus() throws {
        var value = try jsonObject(canonicalVault())
        var data = try XCTUnwrap(value["data"] as? [String: Any])
        data["conversations"] = [[
            "id": "conversation",
            "title": "Conversation",
            "providerId": "openai",
            "model": "gpt-5.5",
            "messages": [[
                "id": "message",
                "role": "assistant",
                "content": "hello",
                "createdAt": 1,
                "status": "invalid"
            ]],
            "createdAt": 1,
            "updatedAt": 1
        ]]
        value["data"] = data

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsDuplicateProviderModelsAndUnknownCapabilities() throws {
        var duplicateModels = try jsonObject(canonicalVault())
        var duplicateData = try XCTUnwrap(duplicateModels["data"] as? [String: Any])
        var duplicateProviders = try XCTUnwrap(duplicateData["providers"] as? [[String: Any]])
        duplicateProviders[0]["models"] = ["gpt-5.5", "gpt-5.5"]
        duplicateData["providers"] = duplicateProviders
        duplicateModels["data"] = duplicateData

        var unknownCapability = try jsonObject(canonicalVault())
        var capabilityData = try XCTUnwrap(unknownCapability["data"] as? [String: Any])
        var capabilityProviders = try XCTUnwrap(capabilityData["providers"] as? [[String: Any]])
        capabilityProviders[0]["capabilities"] = ["chat", "unknown-capability"]
        capabilityData["providers"] = capabilityProviders
        unknownCapability["data"] = capabilityData

        XCTAssertThrowsError(try decode(duplicateModels))
        XCTAssertThrowsError(try decode(unknownCapability))
    }

    func testCanonicalVaultRejectsOfflineReplayClaimMissingRequiredField() throws {
        let value = try mutateFirstMessage(canonicalVault()) { message in
            message["offlineReplayClaim"] = ["claimId": "claim-1"]
        }

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsOfflineReplayClaimUnknownField() throws {
        let value = try mutateFirstMessage(canonicalVault()) { message in
            message["offlineReplayClaim"] = [
                "claimId": "claim-1",
                "owner": "tab-1",
                "unexpected": true
            ]
        }

        XCTAssertThrowsError(try decode(value))
    }

    func testCanonicalVaultRejectsOfflineReplayClaimEmptyOwner() throws {
        let value = try mutateFirstMessage(canonicalVault()) { message in
            message["offlineReplayClaim"] = ["claimId": "claim-1", "owner": ""]
        }

        XCTAssertThrowsError(try decode(value))
    }

    func testCapabilitySelectionUsesExplicitProviderModels() {
        let provider = canonicalVault().data.providers[0]

        XCTAssertEqual(modelForProviderAudioSpeech(provider), "gpt-4o-mini-tts")
        XCTAssertEqual(modelForProviderAudioTranscription(provider), "gpt-4o-transcribe")
        XCTAssertEqual(
            modelForProviderCapability(provider, capability: .embeddings),
            "text-embedding-3-large"
        )
        XCTAssertEqual(
            modelForProviderCapability(provider, capability: .moderation),
            "omni-moderation-latest"
        )
        XCTAssertEqual(
            modelForProviderCapability(provider, capability: .realtime),
            "gpt-realtime-2"
        )
    }

    private func canonicalVault() -> SyncVault {
        let provider = ProviderConfig(
            id: "openai",
            name: "OpenAI",
            kind: .openAIResponses,
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-5.5",
            imageModel: "gpt-image-2",
            audioSpeechModel: "gpt-4o-mini-tts",
            audioTranscriptionModel: "gpt-4o-transcribe",
            embeddingModel: "text-embedding-3-large",
            moderationModel: "omni-moderation-latest",
            realtimeModel: "gpt-realtime-2",
            models: [
                "gpt-5.5", "gpt-image-2", "gpt-4o-mini-tts", "gpt-4o-transcribe",
                "text-embedding-3-large", "omni-moderation-latest", "gpt-realtime-2"
            ],
            capabilities: ["chat", "image-generation", "audio", "embeddings", "moderation", "realtime"],
            enabled: true,
            needsApiKey: true,
            createdAt: 1,
            updatedAt: 1
        )
        let snapshot = AppSnapshot(
            providers: [provider],
            conversations: [
                Conversation(
                    id: "conversation-queued",
                    title: "Queued",
                    providerId: provider.id,
                    model: provider.model,
                    messages: [
                        ChatMessage(
                            id: "message-queued",
                            role: .assistant,
                            content: "Queued offline",
                            createdAt: 1,
                            status: "queued",
                            queuedTextRequest: QueuedTextRequest(
                                providerId: provider.id,
                                model: provider.model
                            ),
                            offlineReplayClaim: OfflineReplayClaim(
                                claimId: "claim-1",
                                owner: "tab-1"
                            )
                        )
                    ],
                    createdAt: 1,
                    updatedAt: 1
                )
            ],
            skills: [],
            skillSettings: SkillSettings(),
            sync: SyncConfig(),
            preferences: Preferences(chatContextMessageLimit: 24),
            updatedAt: 1
        )
        return SyncVault(data: snapshot)
    }

    func testOfficialNormalizationPreservesValidAdvancedProviderModels() {
        var snapshot = canonicalVault().data
        snapshot.providers[0].audioSpeechModel = "tts-1-hd"
        snapshot.providers[0].audioTranscriptionModel = "whisper-1"
        snapshot.providers[0].embeddingModel = "text-embedding-3-small"
        snapshot.providers[0].moderationModel = "omni-moderation-custom"
        snapshot.providers[0].realtimeModel = "gpt-realtime-custom"

        let normalized = normalizeOfficialProviderContracts(snapshot).snapshot.providers[0]

        XCTAssertEqual(normalized.audioSpeechModel, "tts-1-hd")
        XCTAssertEqual(normalized.audioTranscriptionModel, "whisper-1")
        XCTAssertEqual(normalized.embeddingModel, "text-embedding-3-small")
        XCTAssertEqual(normalized.moderationModel, "omni-moderation-custom")
        XCTAssertEqual(normalized.realtimeModel, "gpt-realtime-custom")
        XCTAssertTrue(normalized.models?.contains("tts-1-hd") == true)
        XCTAssertTrue(normalized.models?.contains("whisper-1") == true)
        XCTAssertTrue(normalized.models?.contains("text-embedding-3-small") == true)
        XCTAssertTrue(normalized.models?.contains("omni-moderation-custom") == true)
        XCTAssertTrue(normalized.models?.contains("gpt-realtime-custom") == true)
    }

    private func jsonObject(_ vault: SyncVault) throws -> [String: Any] {
        let data = try JSONEncoder().encode(vault)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func decode(_ value: [String: Any]) throws -> SyncVault {
        let data = try JSONSerialization.data(withJSONObject: value)
        return try decodeValidatedSyncVault(data, decoder: JSONDecoder())
    }

    private func mutateFirstMessage(
        _ vault: SyncVault,
        mutation: (inout [String: Any]) -> Void
    ) throws -> [String: Any] {
        var value = try jsonObject(vault)
        var data = try XCTUnwrap(value["data"] as? [String: Any])
        var conversations = try XCTUnwrap(data["conversations"] as? [[String: Any]])
        var messages = try XCTUnwrap(conversations[0]["messages"] as? [[String: Any]])
        mutation(&messages[0])
        conversations[0]["messages"] = messages
        data["conversations"] = conversations
        value["data"] = data
        return value
    }
}
