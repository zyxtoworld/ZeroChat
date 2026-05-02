import Foundation

public enum ProviderKind: String, Codable, Sendable {
    case openAICompatible = "openai-compatible"
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
    public var model: String
    public var enabled: Bool
    public var needsApiKey: Bool
    public var createdAt: Int64
    public var updatedAt: Int64
}

public struct ChatMessage: Codable, Identifiable, Sendable {
    public var id: String
    public var role: MessageRole
    public var content: String
    public var createdAt: Int64
    public var status: String?
    public var error: String?
}

public struct Conversation: Codable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var providerId: String
    public var model: String
    public var messages: [ChatMessage]
    public var createdAt: Int64
    public var updatedAt: Int64
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
}

public struct Preferences: Codable, Sendable {
    public var firstRunDone: Bool
    public var theme: String
    public var compactMode: Bool
    public var activeConversationId: String?
    public var dismissedDangerWarnings: [String]?
}

public struct AppSnapshot: Codable, Sendable {
    public var version: Int
    public var providers: [ProviderConfig]
    public var conversations: [Conversation]
    public var sync: SyncConfig
    public var preferences: Preferences
    public var updatedAt: Int64
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
