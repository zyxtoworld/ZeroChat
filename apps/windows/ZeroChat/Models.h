#pragma once

#include <string>
#include <vector>

namespace ZeroChat
{
    enum class ProviderKind
    {
        OpenAICompatible,
        Anthropic
    };

    enum class MessageRole
    {
        System,
        User,
        Assistant
    };

    struct ProviderConfig
    {
        std::wstring id;
        std::wstring name;
        ProviderKind kind{ ProviderKind::OpenAICompatible };
        std::wstring baseUrl;
        std::wstring proxyUrl;
        std::wstring model;
        bool enabled{ true };
        bool needsApiKey{ true };
        int64_t createdAt{ 0 };
        int64_t updatedAt{ 0 };
    };

    struct ChatMessage
    {
        std::wstring id;
        MessageRole role{ MessageRole::User };
        std::wstring content;
        int64_t createdAt{ 0 };
        std::wstring status{ L"done" };
        std::wstring error;
    };

    struct Conversation
    {
        std::wstring id;
        std::wstring title;
        std::wstring providerId;
        std::wstring model;
        std::vector<ChatMessage> messages;
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
        bool compactMode{ false };
        std::wstring activeConversationId;
    };

    struct AppSnapshot
    {
        int version{ 1 };
        std::vector<ProviderConfig> providers;
        std::vector<Conversation> conversations;
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
}
