#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>
namespace ZeroChat
{
    enum class ProviderKind
    {
        OpenAICompatible,
        OpenAIResponses,
        Anthropic
    };

    enum class MessageRole
    {
        System,
        User,
        Assistant
    };

    struct ModelMetadata
    {
        std::wstring id;
        std::wstring displayName;
        std::optional<int64_t> contextWindowTokens;
        std::optional<int64_t> maxInputTokens;
        std::optional<int64_t> maxOutputTokens;
        std::vector<std::wstring> capabilities;
        std::wstring source;
        std::optional<int64_t> verifiedAt;
    };

    struct ConversationContextCompaction
    {
        std::wstring source;
        std::wstring summary;
        std::wstring itemsJson;
        std::wstring compactedThroughMessageId;
        std::wstring model;
        std::optional<int64_t> inputTokens;
        int64_t createdAt{ 0 };
    };

    struct ProviderConfig
    {
        std::wstring id;
        std::wstring name;
        ProviderKind kind{ ProviderKind::OpenAICompatible };
        std::wstring baseUrl;
        std::wstring proxyUrl;
        bool clientRequestMode{ false };
        std::wstring model;
        std::wstring imageModel;
        std::wstring audioSpeechModel;
        std::wstring audioTranscriptionModel;
        std::wstring embeddingModel;
        std::wstring moderationModel;
        std::wstring realtimeModel;
        std::vector<std::wstring> models;
        std::map<std::wstring, ModelMetadata> modelMetadata;
        std::vector<std::wstring> capabilities;
        bool enabled{ true };
        bool needsApiKey{ true };
        bool custom{ false };
        int64_t createdAt{ 0 };
        int64_t updatedAt{ 0 };
    };

    struct MessageAttachment
    {
        std::wstring id;
        std::wstring kind{ L"image" };
        std::wstring purpose;
        std::wstring mimeType{ L"image/png" };
        std::wstring dataUrl;
        std::wstring url;
        std::wstring alt;
        std::wstring model;
        int64_t createdAt{ 0 };
    };

    struct GeneratedImage
    {
        std::wstring dataUrl;
        std::wstring url;
        std::wstring mimeType{ L"image/png" };
        std::wstring revisedPrompt;
    };

    struct ImageUpload
    {
        std::vector<uint8_t> bytes;
        std::wstring fileName{ L"image.png" };
        std::wstring mimeType{ L"image/png" };
    };

    struct AudioUpload
    {
        std::vector<uint8_t> bytes;
        std::wstring fileName{ L"audio.webm" };
        std::wstring mimeType{ L"audio/webm" };
    };

    struct QueuedTextRequest
    {
        std::wstring providerId;
        std::wstring model;
        std::optional<std::wstring> promptMessageId;
    };

    struct OfflineReplayClaim
    {
        std::wstring claimId;
        std::wstring owner;
    };

    struct ChatMessage
    {
        std::wstring id;
        MessageRole role{ MessageRole::User };
        std::wstring content;
        int64_t createdAt{ 0 };
        std::wstring status{ L"done" };
        std::wstring error;
        std::vector<MessageAttachment> attachments;
        QueuedTextRequest queuedTextRequest;
        std::optional<OfflineReplayClaim> offlineReplayClaim;
    };

    struct Conversation
    {
        std::wstring id;
        std::wstring title;
        std::wstring providerId;
        std::wstring model;
        std::vector<ChatMessage> messages;
        std::optional<ConversationContextCompaction> contextCompaction;
        int64_t createdAt{ 0 };
        int64_t updatedAt{ 0 };
    };

    struct SyncConfig
    {
        std::wstring mode{ L"local" };
        bool autoSync{ false };
        bool encryptionEnabled{ true };
        std::wstring gistId;
        std::wstring gistFile{ L"zerochat-sync.json" };
        std::wstring workerEndpoint;
        int64_t lastSyncAt{ 0 };
        std::wstring lastSyncStatus;
    };

    struct Preferences
    {
        bool firstRunDone{ false };
        std::wstring theme{ L"system" };
        std::wstring language{ L"system" };
        bool compactMode{ false };
        int chatContextMessageLimit{ 24 };
        std::wstring activeConversationId;
        std::vector<std::wstring> dismissedDangerWarnings;
        std::vector<std::wstring> dismissedFeatureHints;
    };

    struct UserSkillChunk
    {
        std::wstring id;
        std::wstring heading;
        std::wstring content;
        std::wstring contentRef;
        std::wstring contentPreview;
        std::vector<std::wstring> keywords;
        int tokenEstimate{ 0 };
    };

    struct UserSkill
    {
        std::wstring id;
        std::wstring name;
        std::wstring description;
        std::wstring fileName;
        std::wstring contentType{ L"text" };
        int sourceSize{ 0 };
        std::wstring contentHash;
        std::vector<std::wstring> keywords;
        std::vector<UserSkillChunk> chunks;
        bool fixed{ false };
        bool enabled{ true };
        bool autoMatch{ true };
        int64_t createdAt{ 0 };
        int64_t updatedAt{ 0 };
    };

    struct SkillSettings
    {
        bool autoMatch{ true };
        int contextBudget{ 2400 };
        int maxAutoSkills{ 3 };
    };

    struct AppSnapshot
    {
        int version{ 1 };
        std::vector<ProviderConfig> providers;
        std::vector<Conversation> conversations;
        std::vector<UserSkill> skills;
        SkillSettings skillSettings;
        SyncConfig sync;
        Preferences preferences;
        int64_t updatedAt{ 0 };
    };

    struct EnvelopeCrypto
    {
        std::wstring cipher{ L"AES-256-GCM" };
        std::wstring kdf{ L"PBKDF2-SHA256" };
        int iterations{ 600000 };
        std::wstring salt;
        std::wstring iv;
        std::wstring aad;
    };

    struct EncryptedSnapshotEnvelope
    {
        std::wstring kind{ L"zerochat.encryptedSnapshot" };
        int version{ 1 };
        int64_t encryptedAt{ 0 };
        int64_t updatedAt{ 0 };
        EnvelopeCrypto crypto;
        std::wstring payload;
    };

    struct ObjectEnvelopeCrypto
    {
        std::wstring cipher{ L"AES-256-GCM" };
        std::wstring kdf{ L"PBKDF2-SHA256" };
        int iterations{ 600000 };
        std::wstring salt;
        std::wstring iv;
        std::wstring aad;
        std::wstring compression{ L"none" };
    };

    struct EncryptedObjectEnvelope
    {
        std::wstring kind{ L"zerochat.encryptedObject" };
        int version{ 1 };
        std::wstring objectType;
        int64_t encryptedAt{ 0 };
        int64_t updatedAt{ 0 };
        ObjectEnvelopeCrypto crypto;
        std::wstring payload;
    };

    struct IncrementalSyncHead
    {
        std::wstring kind{ L"zerochat.incrementalHead" };
        int version{ 1 };
        std::wstring manifestKey;
        int64_t updatedAt{ 0 };
    };
}
