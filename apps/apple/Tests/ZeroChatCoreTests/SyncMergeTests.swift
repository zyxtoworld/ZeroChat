import XCTest
@testable import ZeroChatCore

final class SyncMergeTests: XCTestCase {
    func testFirstSyncUsesCrossPlatformFieldMergeAndUTF16Ordering() throws {
        let remoteProvider = provider(
            name: "remote",
            model: "remote-primary",
            imageModel: "remote-image",
            models: ["remote-list"],
            capabilities: ["remote-cap"],
            custom: true,
            createdAt: 5,
            updatedAt: 10
        )
        let localProvider = provider(
            name: "local",
            model: "local-primary",
            imageModel: nil,
            models: ["local-list"],
            capabilities: ["local-cap"],
            custom: false,
            createdAt: 8,
            updatedAt: 20
        )
        let remote = vault(
            provider: remoteProvider,
            conversations: [
                conversation(id: "same", content: "remote-newer", updatedAt: 300),
                conversation(id: "\u{E000}", content: "remote-private-use", updatedAt: 100),
            ],
            skills: [skill(id: "\u{E000}", updatedAt: 100)],
            settings: SkillSettings(autoMatch: false, contextBudget: 3600, maxAutoSkills: 7),
            preferences: Preferences(
                firstRunDone: true,
                theme: "dark",
                language: "system",
                compactMode: true,
                chatContextMessageLimit: 24,
                activeConversationId: "\u{10000}",
                dismissedDangerWarnings: ["remote", "shared"],
                dismissedFeatureHints: ["remote-hint"]
            ),
            secrets: ["remote-only": "remote", "shared": "remote"],
            updatedAt: 300
        )
        let local = vault(
            provider: localProvider,
            conversations: [
                conversation(id: "same", content: "local-older", updatedAt: 200),
                conversation(id: "\u{10000}", content: "local-non-bmp", updatedAt: 100),
            ],
            skills: [skill(id: "\u{10000}", updatedAt: 100)],
            settings: SkillSettings(),
            preferences: Preferences(
                firstRunDone: false,
                theme: "system",
                language: "zh-CN",
                compactMode: false,
                activeConversationId: "missing",
                dismissedDangerWarnings: ["shared", " local "],
                dismissedFeatureHints: ["local-hint"]
            ),
            secrets: ["local-only": "local", "shared": "local"],
            updatedAt: 200
        )

        let merged = mergeFirstSyncVault(remote: remote, local: local)
        let mergedProvider = try XCTUnwrap(merged.data.providers.first)
        XCTAssertEqual(mergedProvider.name, "local")
        XCTAssertEqual(mergedProvider.model, "local-primary")
        XCTAssertEqual(mergedProvider.imageModel, "remote-image")
        XCTAssertEqual(
            mergedProvider.models,
            ["local-list", "remote-list", "local-primary", "remote-primary", "remote-image"]
        )
        XCTAssertEqual(mergedProvider.capabilities, ["local-cap", "remote-cap"])
        XCTAssertEqual(mergedProvider.custom, true)
        XCTAssertEqual(mergedProvider.createdAt, 5)
        XCTAssertEqual(mergedProvider.updatedAt, 20)

        XCTAssertEqual(merged.data.conversations.map(\.id), ["same", "\u{10000}", "\u{E000}"])
        XCTAssertEqual(merged.data.conversations[0].messages.first?.content, "remote-newer")
        XCTAssertEqual(merged.data.skills?.map(\.id), ["\u{10000}", "\u{E000}"])
        XCTAssertEqual(merged.data.skillSettings?.autoMatch, false)
        XCTAssertEqual(merged.data.skillSettings?.contextBudget, 3600)
        XCTAssertEqual(merged.data.skillSettings?.maxAutoSkills, 7)

        XCTAssertTrue(merged.data.preferences.firstRunDone)
        XCTAssertEqual(merged.data.preferences.theme, "dark")
        XCTAssertEqual(merged.data.preferences.language, "zh-CN")
        XCTAssertTrue(merged.data.preferences.compactMode)
        XCTAssertNil(merged.data.preferences.chatContextMessageLimit)
        XCTAssertEqual(merged.data.preferences.activeConversationId, "\u{10000}")
        XCTAssertEqual(
            merged.data.preferences.dismissedDangerWarnings,
            ["remote", "shared", "local"]
        )
        XCTAssertEqual(
            merged.data.preferences.dismissedFeatureHints,
            ["remote-hint", "local-hint"]
        )
        XCTAssertEqual(
            merged.secrets.providerKeys,
            ["remote-only": "remote", "local-only": "local", "shared": "local"]
        )
        XCTAssertTrue(merged.data.sync.encryptionEnabled)
    }

    func testFirstSyncPreservesOlderConfiguredCapabilityModelsWhenNewerProviderOmitsThem() {
        let remoteProvider = provider(
            name: "remote",
            model: "remote-primary",
            imageModel: nil,
            models: [],
            capabilities: [],
            custom: false,
            createdAt: 1,
            updatedAt: 20
        )
        let localProvider = ProviderConfig(
            id: remoteProvider.id,
            name: "local",
            kind: .openAICompatible,
            baseUrl: "https://example.test/v1",
            model: "local-primary",
            audioSpeechModel: "tts-local",
            audioTranscriptionModel: "transcribe-local",
            embeddingModel: "embedding-local",
            moderationModel: "moderation-local",
            realtimeModel: "realtime-local",
            enabled: true,
            needsApiKey: true,
            createdAt: 1,
            updatedAt: 10
        )

        let merged = mergeFirstSyncVault(
            remote: SyncVault(data: AppSnapshot(providers: [remoteProvider], updatedAt: 20)),
            local: SyncVault(data: AppSnapshot(providers: [localProvider], updatedAt: 10))
        )
        let mergedProvider = merged.data.providers[0]

        XCTAssertEqual(mergedProvider.audioSpeechModel, "tts-local")
        XCTAssertEqual(mergedProvider.audioTranscriptionModel, "transcribe-local")
        XCTAssertEqual(mergedProvider.embeddingModel, "embedding-local")
        XCTAssertEqual(mergedProvider.moderationModel, "moderation-local")
        XCTAssertEqual(mergedProvider.realtimeModel, "realtime-local")
    }

    func testCloudflareConflictMergePreservesConcurrentDeletionsFromTheSharedBase() throws {
        let deleted = conversation(id: "deleted", content: "same", updatedAt: 10)
        let retained = conversation(id: "retained", content: "base", updatedAt: 10)
        let base = SyncVault(
            data: AppSnapshot(
                providers: [],
                conversations: [deleted, retained],
                sync: SyncConfig(mode: "cloudflare", autoSync: true, encryptionEnabled: true),
                updatedAt: 10
            )
        )

        var remote = base
        remote.data.conversations[1].messages[0].content = "remote change"
        remote.data.conversations[1].updatedAt = 30
        remote.data.updatedAt = 30

        var local = base
        local.data.conversations.removeAll { $0.id == deleted.id }
        local.data.updatedAt = 20

        let merged = try mergeGistVaults(base: base, remote: remote, local: local)

        XCTAssertEqual(merged.data.conversations.map(\.id), ["retained"])
        XCTAssertEqual(
            merged.data.conversations.first?.messages.first?.content,
            "remote change"
        )
    }
}

private func provider(
    name: String,
    model: String,
    imageModel: String?,
    models: [String],
    capabilities: [String],
    custom: Bool,
    createdAt: Int64,
    updatedAt: Int64
) -> ProviderConfig {
    ProviderConfig(
        id: "provider",
        name: name,
        kind: .openAICompatible,
        baseUrl: "https://example.test/v1",
        model: model,
        imageModel: imageModel,
        models: models,
        capabilities: capabilities,
        enabled: true,
        needsApiKey: true,
        custom: custom,
        createdAt: createdAt,
        updatedAt: updatedAt
    )
}

private func conversation(id: String, content: String, updatedAt: Int64) -> Conversation {
    Conversation(
        id: id,
        title: id,
        providerId: "provider",
        model: "model",
        messages: [
            ChatMessage(id: "message-\(id)", role: .user, content: content, createdAt: updatedAt),
        ],
        createdAt: 1,
        updatedAt: updatedAt
    )
}

private func skill(id: String, updatedAt: Int64) -> UserSkill {
    UserSkill(
        id: id,
        name: id,
        createdAt: 1,
        updatedAt: updatedAt
    )
}

private func vault(
    provider: ProviderConfig,
    conversations: [Conversation],
    skills: [UserSkill],
    settings: SkillSettings,
    preferences: Preferences,
    secrets: [String: String],
    updatedAt: Int64
) -> SyncVault {
    SyncVault(
        data: AppSnapshot(
            providers: [provider],
            conversations: conversations,
            skills: skills,
            skillSettings: settings,
            sync: SyncConfig(mode: "gist", autoSync: true, encryptionEnabled: false),
            preferences: preferences,
            updatedAt: updatedAt
        ),
        secrets: ProviderSecrets(providerKeys: secrets)
    )
}
