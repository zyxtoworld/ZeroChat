import Foundation
public indirect enum JSONValue: Codable, Sendable, Equatable {
    case array([JSONValue])
    case boolean(Bool)
    case number(Double)
    case object([String: JSONValue])
    case string(String)
    case null

    private struct CodingKey: Swift.CodingKey {
        var stringValue: String
        var intValue: Int?

        init?(stringValue: String) {
            self.stringValue = stringValue
            intValue = nil
        }

        init?(intValue: Int) {
            stringValue = String(intValue)
            self.intValue = intValue
        }
    }

    public init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: CodingKey.self) {
            var values: [String: JSONValue] = [:]
            for key in container.allKeys {
                values[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
            }
            self = .object(values)
            return
        }
        if var container = try? decoder.unkeyedContainer() {
            var values: [JSONValue] = []
            while !container.isAtEnd {
                values.append(try container.decode(JSONValue.self))
            }
            self = .array(values)
            return
        }
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .array(values):
            var container = encoder.unkeyedContainer()
            for value in values {
                try container.encode(value)
            }
        case let .boolean(value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case let .number(value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case let .object(values):
            var container = encoder.container(keyedBy: CodingKey.self)
            for (key, value) in values {
                try container.encode(value, forKey: CodingKey(stringValue: key)!)
            }
        case let .string(value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .null:
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        }
    }
}

public struct ConversationContextCompaction: Codable, Sendable, Equatable {
    public var source: String
    public var summary: String?
    public var items: [JSONValue]?
    public var compactedThroughMessageId: String
    public var model: String
    public var inputTokens: Int64?
    public var createdAt: Int64
}


public enum ProviderKind: String, Codable, Sendable {
    case openAICompatible = "openai-compatible"
    case openAIResponses = "openai-responses"
    case anthropic
}

public enum MessageRole: String, Codable, Sendable {
    case system
    case user
    case assistant
}

public struct ProviderConfig: Codable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var kind: ProviderKind
    public var baseUrl: String
    public var proxyUrl: String?
    public var clientRequestMode: Bool?
    public var model: String
    public var imageModel: String?
    public var audioSpeechModel: String?
    public var audioTranscriptionModel: String?
    public var embeddingModel: String?
    public var moderationModel: String?
    public var realtimeModel: String?
    public var models: [String]?
    public var modelMetadata: [String: ModelMetadata]?
    public var capabilities: [String]?
    public var enabled: Bool
    public var needsApiKey: Bool
    public var custom: Bool?
    public var createdAt: Int64
    public var updatedAt: Int64

    public init(
        id: String,
        name: String,
        kind: ProviderKind,
        baseUrl: String,
        proxyUrl: String? = nil,
        clientRequestMode: Bool? = nil,
        model: String,
        imageModel: String? = nil,
        audioSpeechModel: String? = nil,
        audioTranscriptionModel: String? = nil,
        embeddingModel: String? = nil,
        moderationModel: String? = nil,
        realtimeModel: String? = nil,
        models: [String]? = nil,
        modelMetadata: [String: ModelMetadata]? = nil,
        capabilities: [String]? = nil,
        enabled: Bool,
        needsApiKey: Bool,
        custom: Bool? = nil,
        createdAt: Int64,
        updatedAt: Int64
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.baseUrl = baseUrl
        self.proxyUrl = proxyUrl
        self.clientRequestMode = clientRequestMode
        self.model = model
        self.imageModel = imageModel
        self.audioSpeechModel = audioSpeechModel
        self.audioTranscriptionModel = audioTranscriptionModel
        self.embeddingModel = embeddingModel
        self.moderationModel = moderationModel
        self.realtimeModel = realtimeModel
        self.models = models
        self.modelMetadata = modelMetadata
        self.capabilities = capabilities
        self.enabled = enabled
        self.needsApiKey = needsApiKey
        self.custom = custom
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct MessageAttachment: Codable, Identifiable, Sendable {
    public var id: String
    public var kind: String
    public var purpose: String?
    public var mimeType: String
    public var dataUrl: String?
    public var url: String?
    public var alt: String?
    public var model: String?
    public var createdAt: Int64

    public init(
        id: String,
        kind: String,
        purpose: String? = nil,
        mimeType: String,
        dataUrl: String? = nil,
        url: String? = nil,
        alt: String? = nil,
        model: String? = nil,
        createdAt: Int64
    ) {
        self.id = id
        self.kind = kind
        self.purpose = purpose
        self.mimeType = mimeType
        self.dataUrl = dataUrl
        self.url = url
        self.alt = alt
        self.model = model
        self.createdAt = createdAt
    }
}

public struct OfflineReplayClaim: Codable, Sendable, Equatable {
    public var claimId: String
    public var owner: String

    public init(claimId: String, owner: String) {
        self.claimId = claimId
        self.owner = owner
    }
}

public struct ChatMessage: Codable, Identifiable, Sendable {
    public var id: String
    public var role: MessageRole
    public var content: String
    public var createdAt: Int64
    public var status: String?
    public var error: String?
    public var attachments: [MessageAttachment]?
    public var queuedTextRequest: QueuedTextRequest?
    public var offlineReplayClaim: OfflineReplayClaim?

    public init(
        id: String,
        role: MessageRole,
        content: String,
        createdAt: Int64,
        status: String? = "done",
        error: String? = nil,
        attachments: [MessageAttachment]? = nil,
        queuedTextRequest: QueuedTextRequest? = nil,
        offlineReplayClaim: OfflineReplayClaim? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.status = status
        self.error = error
        self.attachments = attachments
        self.queuedTextRequest = queuedTextRequest
        self.offlineReplayClaim = offlineReplayClaim
    }
}

public struct QueuedTextRequest: Codable, Sendable, Equatable {
    public var providerId: String
    public var model: String
    public var promptMessageId: String?

    public init(providerId: String, model: String, promptMessageId: String? = nil) {
        self.providerId = providerId
        self.model = model
        self.promptMessageId = promptMessageId
    }
}

public struct Conversation: Codable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var providerId: String
    public var model: String
    public var messages: [ChatMessage]
    public var contextCompaction: ConversationContextCompaction?
    public var createdAt: Int64
    public var updatedAt: Int64

    public init(
        id: String,
        title: String,
        providerId: String,
        model: String,
        messages: [ChatMessage],
        contextCompaction: ConversationContextCompaction? = nil,
        createdAt: Int64,
        updatedAt: Int64
    ) {
        self.id = id
        self.title = title
        self.providerId = providerId
        self.model = model
        self.messages = messages
        self.contextCompaction = contextCompaction
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct SyncConfig: Codable, Sendable {
    public var mode: String
    public var autoSync: Bool
    public var encryptionEnabled: Bool
    public var gistId: String?
    public var gistFile: String?
    public var workerEndpoint: String?
    public var lastSyncAt: Int64?
    public var lastSyncStatus: String?

    public init(
        mode: String = "local",
        autoSync: Bool = false,
        encryptionEnabled: Bool = true,
        gistId: String? = nil,
        gistFile: String? = "zerochat-sync.json",
        workerEndpoint: String? = nil,
        lastSyncAt: Int64? = nil,
        lastSyncStatus: String? = nil
    ) {
        self.mode = mode
        self.autoSync = autoSync
        self.encryptionEnabled = encryptionEnabled
        self.gistId = gistId
        self.gistFile = gistFile
        self.workerEndpoint = workerEndpoint
        self.lastSyncAt = lastSyncAt
        self.lastSyncStatus = lastSyncStatus
    }
}

public struct Preferences: Codable, Sendable {
    public var firstRunDone: Bool
    public var theme: String
    public var language: String
    public var compactMode: Bool
    public var chatContextMessageLimit: Int?
    public var activeConversationId: String?
    public var dismissedDangerWarnings: [String]?
    public var dismissedFeatureHints: [String]?

    public init(
        firstRunDone: Bool = false,
        theme: String = "system",
        language: String = "system",
        compactMode: Bool = false,
        chatContextMessageLimit: Int? = nil,
        activeConversationId: String? = nil,
        dismissedDangerWarnings: [String]? = nil,
        dismissedFeatureHints: [String]? = nil
    ) {
        self.firstRunDone = firstRunDone
        self.theme = theme
        self.language = language
        self.compactMode = compactMode
        self.chatContextMessageLimit = chatContextMessageLimit
        self.activeConversationId = activeConversationId
        self.dismissedDangerWarnings = dismissedDangerWarnings
        self.dismissedFeatureHints = dismissedFeatureHints
    }
}

public struct UserSkillChunk: Codable, Identifiable, Sendable {
    public var id: String
    public var heading: String
    public var content: String
    public var contentRef: String?
    public var contentPreview: String?
    public var keywords: [String]
    public var tokenEstimate: Int

    public init(
        id: String,
        heading: String,
        content: String = "",
        contentRef: String? = nil,
        contentPreview: String? = nil,
        keywords: [String] = [],
        tokenEstimate: Int
    ) {
        self.id = id
        self.heading = heading
        self.content = content
        self.contentRef = contentRef
        self.contentPreview = contentPreview
        self.keywords = keywords
        self.tokenEstimate = tokenEstimate
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case heading
        case content
        case contentRef
        case contentPreview
        case keywords
        case tokenEstimate
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        heading = try container.decode(String.self, forKey: .heading)
        content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        contentRef = try container.decodeIfPresent(String.self, forKey: .contentRef)
        contentPreview = try container.decodeIfPresent(String.self, forKey: .contentPreview)
        keywords = try container.decodeIfPresent([String].self, forKey: .keywords) ?? []
        tokenEstimate = try container.decode(Int.self, forKey: .tokenEstimate)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(heading, forKey: .heading)
        if !content.isEmpty {
            try container.encode(content, forKey: .content)
        }
        try container.encodeIfPresent(contentRef, forKey: .contentRef)
        try container.encodeIfPresent(contentPreview, forKey: .contentPreview)
        try container.encode(keywords, forKey: .keywords)
        try container.encode(tokenEstimate, forKey: .tokenEstimate)
    }
}

public struct UserSkill: Codable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var description: String
    public var fileName: String?
    public var contentType: String
    public var sourceSize: Int
    public var contentHash: String
    public var keywords: [String]
    public var chunks: [UserSkillChunk]
    public var fixed: Bool
    public var enabled: Bool
    public var autoMatch: Bool
    public var createdAt: Int64
    public var updatedAt: Int64

    public init(
        id: String,
        name: String,
        description: String = "",
        fileName: String? = nil,
        contentType: String = "text",
        sourceSize: Int = 0,
        contentHash: String = "",
        keywords: [String] = [],
        chunks: [UserSkillChunk] = [],
        fixed: Bool = false,
        enabled: Bool = true,
        autoMatch: Bool = true,
        createdAt: Int64,
        updatedAt: Int64
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.fileName = fileName
        self.contentType = contentType
        self.sourceSize = sourceSize
        self.contentHash = contentHash
        self.keywords = keywords
        self.chunks = chunks
        self.fixed = fixed
        self.enabled = enabled
        self.autoMatch = autoMatch
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct SkillSettings: Codable, Sendable {
    public var autoMatch: Bool
    public var contextBudget: Int
    public var maxAutoSkills: Int

    public init(
        autoMatch: Bool = true,
        contextBudget: Int = 2400,
        maxAutoSkills: Int = 3
    ) {
        self.autoMatch = autoMatch
        self.contextBudget = contextBudget
        self.maxAutoSkills = maxAutoSkills
    }
}

public struct AppSnapshot: Codable, Sendable {
    public var version: Int
    public var providers: [ProviderConfig]
    public var conversations: [Conversation]
    public var skills: [UserSkill]?
    public var skillSettings: SkillSettings?
    public var sync: SyncConfig
    public var preferences: Preferences
    public var updatedAt: Int64

    public init(
        version: Int = 1,
        providers: [ProviderConfig] = [],
        conversations: [Conversation] = [],
        skills: [UserSkill]? = nil,
        skillSettings: SkillSettings? = nil,
        sync: SyncConfig = SyncConfig(),
        preferences: Preferences = Preferences(),
        updatedAt: Int64
    ) {
        self.version = version
        self.providers = providers
        self.conversations = conversations
        self.skills = skills
        self.skillSettings = skillSettings
        self.sync = sync
        self.preferences = preferences
        self.updatedAt = updatedAt
    }
}

public struct ProviderSecrets: Codable, Sendable {
    public var providerKeys: [String: String]

    public init(providerKeys: [String: String] = [:]) {
        self.providerKeys = providerKeys
    }
}

public struct SyncVault: Codable, Sendable {
    public var data: AppSnapshot
    public var secrets: ProviderSecrets

    public init(
        data: AppSnapshot,
        secrets: ProviderSecrets = ProviderSecrets()
    ) {
        self.data = data
        self.secrets = secrets
    }
}

public struct EncryptedSnapshotEnvelope: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var encryptedAt: Int64
    public var updatedAt: Int64
    public var crypto: EnvelopeCrypto
    public var payload: String
}

public struct EnvelopeCrypto: Codable, Sendable {
    public var cipher: String
    public var kdf: String
    public var iterations: Int
    public var salt: String
    public var iv: String
    public var aad: String
}

public struct EncryptedObjectEnvelope: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var objectType: String
    public var encryptedAt: Int64
    public var updatedAt: Int64
    public var crypto: ObjectEnvelopeCrypto
    public var payload: String
}

public struct ObjectEnvelopeCrypto: Codable, Sendable {
    public var cipher: String
    public var kdf: String
    public var iterations: Int
    public var salt: String
    public var iv: String
    public var aad: String
    public var compression: String
}

public struct IncrementalSyncHead: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var manifestKey: String
    public var updatedAt: Int64
}

public struct IncrementalChunkRef: Codable, Sendable {
    public var conversationId: String
    public var index: Int
    public var key: String
    public var objectType: String
    public var fingerprint: String
    public var messageCount: Int
    public var updatedAt: Int64
}

public struct IncrementalSkillRef: Codable, Sendable {
    public var skillId: String
    public var chunkId: String
    public var key: String
    public var objectType: String
    public var fingerprint: String
    public var updatedAt: Int64
}

public struct IncrementalAttachmentRef: Codable, Sendable {
    public var conversationId: String
    public var messageId: String
    public var attachmentId: String
    public var index: Int
    public var chunkCount: Int
    public var key: String
    public var objectType: String
    public var fingerprint: String
    public var updatedAt: Int64
}

public struct IncrementalManifest: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var updatedAt: Int64
    public var data: AppSnapshot
    public var secrets: ProviderSecrets
    public var chunks: [IncrementalChunkRef]
    public var skillChunks: [IncrementalSkillRef]?
    public var attachmentChunks: [IncrementalAttachmentRef]? = nil
}

public struct ConversationChunk: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var conversationId: String
    public var index: Int
    public var messages: [ChatMessage]
    public var updatedAt: Int64
    public var fingerprint: String
}

public struct SkillContentChunk: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var skillId: String
    public var chunkId: String
    public var content: String
    public var updatedAt: Int64
    public var fingerprint: String
}

public struct AttachmentContentChunk: Codable, Sendable {
    public var kind: String
    public var version: Int
    public var conversationId: String
    public var messageId: String
    public var attachmentId: String
    public var index: Int
    public var chunkCount: Int
    public var content: String
    public var updatedAt: Int64
    public var fingerprint: String
}
