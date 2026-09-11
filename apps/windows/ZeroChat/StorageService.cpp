#include "pch.h"
#include "StorageService.h"

#include <algorithm>
#include <cmath>
#include <exception>
#include <initializer_list>
#include <limits>
#include <optional>
#include <string_view>
#include <unordered_set>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.FileProperties.h>
#include <winrt/Windows.Storage.Streams.h>

using namespace winrt;
using namespace Windows::Data::Json;
using namespace Windows::Foundation;
using namespace Windows::Security::Cryptography;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;

namespace ZeroChat
{
    namespace
    {
        constexpr uint32_t MaxLocalSnapshotFileBytes = 64000000;

        winrt::handle& StorageOperationGate()
        {
            static winrt::handle gate{
                winrt::check_pointer(CreateEventW(nullptr, FALSE, TRUE, nullptr)) };
            return gate;
        }

        class StorageOperationLease final
        {
        public:
            explicit StorageOperationLease(HANDLE gate) noexcept : m_gate(gate) {}

            StorageOperationLease(StorageOperationLease const&) = delete;
            StorageOperationLease& operator=(StorageOperationLease const&) = delete;

            ~StorageOperationLease()
            {
                SetEvent(m_gate);
            }

        private:
            HANDLE m_gate;
        };

        [[noreturn]] void ThrowInvalidSnapshot()
        {
            throw hresult_invalid_argument(L"Snapshot JSON has invalid canonical format.");
        }

        [[noreturn]] void ThrowLocalSnapshotTooLarge()
        {
            throw hresult_invalid_argument(L"Local snapshot exceeded the 64000000-byte safety limit.");
        }

        IAsyncOperation<hstring> ReadBoundedSnapshotTextAsync(StorageFile const& file)
        {
            auto properties = co_await file.GetBasicPropertiesAsync();
            if (properties.Size() > MaxLocalSnapshotFileBytes)
            {
                ThrowLocalSnapshotTooLarge();
            }

            auto input = co_await file.OpenReadAsync();
            std::string text;
            text.reserve((std::min)(
                static_cast<size_t>(properties.Size()),
                static_cast<size_t>(16384)));

            while (true)
            {
                auto buffer = co_await input.ReadAsync(
                    Buffer(16384),
                    16384,
                    InputStreamOptions::Partial);
                auto length = buffer.Length();
                if (length == 0)
                {
                    break;
                }
                if (length > MaxLocalSnapshotFileBytes ||
                    text.size() > MaxLocalSnapshotFileBytes - length)
                {
                    input.Close();
                    ThrowLocalSnapshotTooLarge();
                }

                com_array<uint8_t> bytes;
                CryptographicBuffer::CopyToByteArray(buffer, bytes);
                text.append(
                    reinterpret_cast<char const*>(bytes.data()),
                    bytes.size());
            }

            input.Close();
            co_return to_hstring(text);
        }

        IBuffer EncodeBoundedSnapshotText(hstring const& text)
        {
            auto buffer = CryptographicBuffer::ConvertStringToBinary(
                text,
                BinaryStringEncoding::Utf8);
            if (buffer.Length() > MaxLocalSnapshotFileBytes)
            {
                ThrowLocalSnapshotTooLarge();
            }
            return buffer;
        }

        bool Contains(
            std::initializer_list<std::wstring_view> values,
            std::wstring_view candidate)
        {
            return std::find(values.begin(), values.end(), candidate) != values.end();
        }

        void RequireObjectShape(
            JsonObject const& object,
            std::initializer_list<std::wstring_view> allowedKeys,
            std::initializer_list<std::wstring_view> requiredKeys)
        {
            for (auto const& entry : object)
            {
                auto key = entry.Key();
                if (!Contains(allowedKeys, std::wstring_view(key.c_str(), key.size())) ||
                    entry.Value().ValueType() == JsonValueType::Null)
                {
                    ThrowInvalidSnapshot();
                }
            }

            for (auto const& key : requiredKeys)
            {
                if (!object.HasKey(hstring(key)))
                {
                    ThrowInvalidSnapshot();
                }
            }
        }

        JsonArray GetArray(JsonObject const& object, hstring const& key, bool required = false)
        {
            if (!object.HasKey(key))
            {
                if (required)
                {
                    ThrowInvalidSnapshot();
                }
                return nullptr;
            }
            if (object.GetNamedValue(key).ValueType() != JsonValueType::Array)
            {
                ThrowInvalidSnapshot();
            }
            return object.GetNamedArray(key);
        }

        JsonObject GetObject(JsonObject const& object, hstring const& key, bool required = false)
        {
            if (!object.HasKey(key))
            {
                if (required)
                {
                    ThrowInvalidSnapshot();
                }
                return nullptr;
            }
            if (object.GetNamedValue(key).ValueType() != JsonValueType::Object)
            {
                ThrowInvalidSnapshot();
            }
            return object.GetNamedObject(key);
        }

        AppSnapshot DefaultSnapshot()
        {
            AppSnapshot snapshot;
            snapshot.sync.mode = L"local";
            snapshot.sync.gistFile = L"zerochat-sync.json";
            return snapshot;
        }

        hstring KindToString(ProviderKind kind)
        {
            switch (kind)
            {
            case ProviderKind::Anthropic:
                return L"anthropic";
            case ProviderKind::OpenAIResponses:
                return L"openai-responses";
            case ProviderKind::OpenAICompatible:
            default:
                return L"openai-compatible";
            }
        }

        ProviderKind KindFromString(std::wstring const& value)
        {
            if (value == L"openai-compatible")
            {
                return ProviderKind::OpenAICompatible;
            }
            if (value == L"anthropic")
            {
                return ProviderKind::Anthropic;
            }
            if (value == L"openai-responses")
            {
                return ProviderKind::OpenAIResponses;
            }
            ThrowInvalidSnapshot();
        }

        hstring RoleToString(MessageRole role)
        {
            switch (role)
            {
            case MessageRole::System:
                return L"system";
            case MessageRole::Assistant:
                return L"assistant";
            case MessageRole::User:
            default:
                return L"user";
            }
        }

        MessageRole RoleFromString(std::wstring const& value)
        {
            if (value == L"user")
            {
                return MessageRole::User;
            }
            if (value == L"system")
            {
                return MessageRole::System;
            }
            if (value == L"assistant")
            {
                return MessageRole::Assistant;
            }
            ThrowInvalidSnapshot();
        }

        std::wstring GetString(JsonObject const& object, hstring const& key, std::wstring const& fallback = L"")
        {
            if (!object.HasKey(key))
            {
                return fallback;
            }
            if (object.GetNamedValue(key).ValueType() != JsonValueType::String)
            {
                ThrowInvalidSnapshot();
            }
            return std::wstring(object.GetNamedString(key));
        }

        bool GetBool(JsonObject const& object, hstring const& key, bool fallback = false)
        {
            if (!object.HasKey(key))
            {
                return fallback;
            }
            if (object.GetNamedValue(key).ValueType() != JsonValueType::Boolean)
            {
                ThrowInvalidSnapshot();
            }
            return object.GetNamedBoolean(key);
        }

        int64_t GetInt64(JsonObject const& object, hstring const& key, int64_t fallback = 0)
        {
            if (!object.HasKey(key))
            {
                return fallback;
            }
            if (object.GetNamedValue(key).ValueType() != JsonValueType::Number)
            {
                ThrowInvalidSnapshot();
            }

            constexpr double MaxSafeInteger = 9007199254740991.0;
            auto value = object.GetNamedNumber(key);
            if (!std::isfinite(value) || value < 0 || value > MaxSafeInteger ||
                std::trunc(value) != value)
            {
                ThrowInvalidSnapshot();
            }
            return static_cast<int64_t>(value);
        }

        int GetInt(JsonObject const& object, hstring const& key, int fallback = 0)
        {
            auto value = GetInt64(object, key, fallback);
            if (value > (std::numeric_limits<int>::max)())
            {
                ThrowInvalidSnapshot();
            }
            return static_cast<int>(value);
        }

        JsonArray StringArray(std::vector<std::wstring> const& values)
        {
            JsonArray array;
            for (auto const& value : values)
            {
                if (!value.empty())
                {
                    array.Append(JsonValue::CreateStringValue(value));
                }
            }
            return array;
        }

        std::vector<std::wstring> ReadStringArray(JsonObject const& object, hstring const& key)
        {
            std::vector<std::wstring> values;
            auto array = GetArray(object, key);
            if (!array)
            {
                return values;
            }

            for (uint32_t index = 0; index < array.Size(); ++index)
            {
                if (array.GetAt(index).ValueType() != JsonValueType::String)
                {
                    ThrowInvalidSnapshot();
                }
                auto value = std::wstring(array.GetStringAt(index));
                if (value.empty())
                {
                    ThrowInvalidSnapshot();
                }
                values.push_back(std::move(value));
            }
            return values;
        }

        JsonObject ProviderToJson(ProviderConfig const& provider)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(provider.id));
            object.Insert(L"name", JsonValue::CreateStringValue(provider.name));
            object.Insert(L"kind", JsonValue::CreateStringValue(KindToString(provider.kind)));
            object.Insert(L"baseUrl", JsonValue::CreateStringValue(provider.baseUrl));
            if (!provider.proxyUrl.empty())
            {
                object.Insert(L"proxyUrl", JsonValue::CreateStringValue(provider.proxyUrl));
            }
            object.Insert(L"clientRequestMode", JsonValue::CreateBooleanValue(provider.clientRequestMode));
            object.Insert(L"model", JsonValue::CreateStringValue(provider.model));
            if (!provider.imageModel.empty())
            {
                object.Insert(L"imageModel", JsonValue::CreateStringValue(provider.imageModel));
            }
            if (!provider.audioSpeechModel.empty())
            {
                object.Insert(L"audioSpeechModel", JsonValue::CreateStringValue(provider.audioSpeechModel));
            }
            if (!provider.audioTranscriptionModel.empty())
            {
                object.Insert(L"audioTranscriptionModel", JsonValue::CreateStringValue(provider.audioTranscriptionModel));
            }
            if (!provider.embeddingModel.empty())
            {
                object.Insert(L"embeddingModel", JsonValue::CreateStringValue(provider.embeddingModel));
            }
            if (!provider.moderationModel.empty())
            {
                object.Insert(L"moderationModel", JsonValue::CreateStringValue(provider.moderationModel));
            }
            if (!provider.realtimeModel.empty())
            {
                object.Insert(L"realtimeModel", JsonValue::CreateStringValue(provider.realtimeModel));
            }
            object.Insert(L"models", StringArray(provider.models));
            object.Insert(L"capabilities", StringArray(provider.capabilities));
            object.Insert(L"enabled", JsonValue::CreateBooleanValue(provider.enabled));
            object.Insert(L"needsApiKey", JsonValue::CreateBooleanValue(provider.needsApiKey));
            object.Insert(L"custom", JsonValue::CreateBooleanValue(provider.custom));
            object.Insert(L"createdAt", JsonValue::CreateNumberValue(static_cast<double>(provider.createdAt)));
            object.Insert(L"updatedAt", JsonValue::CreateNumberValue(static_cast<double>(provider.updatedAt)));
            return object;
        }

        ProviderConfig ProviderFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"name", L"kind", L"baseUrl", L"proxyUrl", L"clientRequestMode",
                  L"model", L"imageModel", L"audioSpeechModel", L"audioTranscriptionModel",
                  L"embeddingModel", L"moderationModel", L"realtimeModel", L"models",
                  L"capabilities", L"enabled", L"needsApiKey", L"custom", L"createdAt", L"updatedAt" },
                { L"id", L"name", L"kind", L"baseUrl", L"model", L"enabled",
                  L"needsApiKey", L"createdAt", L"updatedAt" });
            ProviderConfig provider;
            provider.id = GetString(object, L"id");
            provider.name = GetString(object, L"name");
            provider.kind = KindFromString(GetString(object, L"kind", L"openai-compatible"));
            provider.baseUrl = GetString(object, L"baseUrl");
            provider.proxyUrl = GetString(object, L"proxyUrl");
            provider.clientRequestMode = GetBool(object, L"clientRequestMode", false);
            provider.model = GetString(object, L"model");
            provider.imageModel = GetString(object, L"imageModel");
            provider.audioSpeechModel = GetString(object, L"audioSpeechModel");
            provider.audioTranscriptionModel = GetString(object, L"audioTranscriptionModel");
            provider.embeddingModel = GetString(object, L"embeddingModel");
            provider.moderationModel = GetString(object, L"moderationModel");
            provider.realtimeModel = GetString(object, L"realtimeModel");
            provider.models = ReadStringArray(object, L"models");
            provider.capabilities = ReadStringArray(object, L"capabilities");
            provider.enabled = GetBool(object, L"enabled", true);
            provider.needsApiKey = GetBool(object, L"needsApiKey", true);
            provider.custom = GetBool(object, L"custom", false);
            provider.createdAt = GetInt64(object, L"createdAt");
            provider.updatedAt = GetInt64(object, L"updatedAt");
            return provider;
        }

        JsonObject AttachmentToJson(MessageAttachment const& attachment)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(attachment.id));
            object.Insert(L"kind", JsonValue::CreateStringValue(attachment.kind));
            if (!attachment.purpose.empty())
            {
                object.Insert(L"purpose", JsonValue::CreateStringValue(attachment.purpose));
            }
            object.Insert(L"mimeType", JsonValue::CreateStringValue(attachment.mimeType));
            if (!attachment.dataUrl.empty())
            {
                object.Insert(L"dataUrl", JsonValue::CreateStringValue(attachment.dataUrl));
            }
            if (!attachment.url.empty())
            {
                object.Insert(L"url", JsonValue::CreateStringValue(attachment.url));
            }
            if (!attachment.alt.empty())
            {
                object.Insert(L"alt", JsonValue::CreateStringValue(attachment.alt));
            }
            if (!attachment.model.empty())
            {
                object.Insert(L"model", JsonValue::CreateStringValue(attachment.model));
            }
            object.Insert(L"createdAt", JsonValue::CreateNumberValue(static_cast<double>(attachment.createdAt)));
            return object;
        }

        MessageAttachment AttachmentFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"kind", L"purpose", L"mimeType", L"dataUrl", L"url", L"alt", L"model", L"createdAt" },
                { L"id", L"kind", L"mimeType", L"createdAt" });
            MessageAttachment attachment;
            attachment.id = GetString(object, L"id");
            attachment.kind = GetString(object, L"kind", L"image");
            attachment.purpose = GetString(object, L"purpose");
            if (object.HasKey(L"purpose") &&
                !Contains({ L"generated", L"source", L"mask" }, attachment.purpose))
            {
                ThrowInvalidSnapshot();
            }
            attachment.mimeType = GetString(object, L"mimeType", L"image/png");
            attachment.dataUrl = GetString(object, L"dataUrl");
            attachment.url = GetString(object, L"url");
            attachment.alt = GetString(object, L"alt");
            attachment.model = GetString(object, L"model");
            attachment.createdAt = GetInt64(object, L"createdAt");
            return attachment;
        }

        JsonObject MessageToJson(ChatMessage const& message)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(message.id));
            object.Insert(L"role", JsonValue::CreateStringValue(RoleToString(message.role)));
            object.Insert(L"content", JsonValue::CreateStringValue(message.content));
            object.Insert(L"createdAt", JsonValue::CreateNumberValue(static_cast<double>(message.createdAt)));
            if (!message.status.empty())
            {
                object.Insert(L"status", JsonValue::CreateStringValue(message.status));
            }
            if (!message.error.empty())
            {
                object.Insert(L"error", JsonValue::CreateStringValue(message.error));
            }
            JsonArray attachments;
            for (auto const& attachment : message.attachments)
            {
                attachments.Append(AttachmentToJson(attachment));
            }
            object.Insert(L"attachments", attachments);
            if (!message.queuedTextRequest.providerId.empty() || !message.queuedTextRequest.model.empty())
            {
                JsonObject request;
                request.Insert(L"providerId", JsonValue::CreateStringValue(message.queuedTextRequest.providerId));
                request.Insert(L"model", JsonValue::CreateStringValue(message.queuedTextRequest.model));
                if (message.queuedTextRequest.promptMessageId)
                {
                    request.Insert(L"promptMessageId", JsonValue::CreateStringValue(*message.queuedTextRequest.promptMessageId));
                }
                object.Insert(L"queuedTextRequest", request);
            }
            if (message.offlineReplayClaim)
            {
                JsonObject claim;
                claim.Insert(L"claimId", JsonValue::CreateStringValue(message.offlineReplayClaim->claimId));
                claim.Insert(L"owner", JsonValue::CreateStringValue(message.offlineReplayClaim->owner));
                object.Insert(L"offlineReplayClaim", claim);
            }
            return object;
        }

        ChatMessage MessageFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"role", L"content", L"createdAt", L"status", L"error", L"attachments", L"queuedTextRequest", L"offlineReplayClaim" },
                { L"id", L"role", L"content", L"createdAt" });
            ChatMessage message;
            message.id = GetString(object, L"id");
            message.role = RoleFromString(GetString(object, L"role", L"user"));
            message.content = GetString(object, L"content");
            message.createdAt = GetInt64(object, L"createdAt");
            message.status = GetString(object, L"status", L"done");
            message.error = GetString(object, L"error");

            auto attachments = GetArray(object, L"attachments");
            if (attachments)
            {
                for (uint32_t index = 0; index < attachments.Size(); ++index)
                {
                    if (attachments.GetAt(index).ValueType() != JsonValueType::Object)
                    {
                        ThrowInvalidSnapshot();
                    }
                    message.attachments.push_back(AttachmentFromJson(attachments.GetObjectAt(index)));
                }
            }
            auto queuedTextRequest = GetObject(object, L"queuedTextRequest");
            if (queuedTextRequest)
            {
                RequireObjectShape(
                    queuedTextRequest,
                    { L"providerId", L"model", L"promptMessageId" },
                    { L"providerId", L"model" });
                message.queuedTextRequest.providerId = GetString(queuedTextRequest, L"providerId");
                message.queuedTextRequest.model = GetString(queuedTextRequest, L"model");
                if (queuedTextRequest.HasKey(L"promptMessageId"))
                {
                    message.queuedTextRequest.promptMessageId = GetString(queuedTextRequest, L"promptMessageId");
                }
            }
            auto offlineReplayClaim = GetObject(object, L"offlineReplayClaim");
            if (offlineReplayClaim)
            {
                RequireObjectShape(
                    offlineReplayClaim,
                    { L"claimId", L"owner" },
                    { L"claimId", L"owner" });
                message.offlineReplayClaim = OfflineReplayClaim{
                    GetString(offlineReplayClaim, L"claimId"),
                    GetString(offlineReplayClaim, L"owner") };
            }
            return message;
        }

        JsonObject ConversationToJson(Conversation const& conversation)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(conversation.id));
            object.Insert(L"title", JsonValue::CreateStringValue(conversation.title));
            object.Insert(L"providerId", JsonValue::CreateStringValue(conversation.providerId));
            object.Insert(L"model", JsonValue::CreateStringValue(conversation.model));
            JsonArray messages;
            for (auto const& message : conversation.messages)
            {
                messages.Append(MessageToJson(message));
            }
            object.Insert(L"messages", messages);
            object.Insert(L"createdAt", JsonValue::CreateNumberValue(static_cast<double>(conversation.createdAt)));
            object.Insert(L"updatedAt", JsonValue::CreateNumberValue(static_cast<double>(conversation.updatedAt)));
            return object;
        }

        Conversation ConversationFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"title", L"providerId", L"model", L"messages", L"createdAt", L"updatedAt" },
                { L"id", L"title", L"providerId", L"model", L"messages", L"createdAt", L"updatedAt" });
            Conversation conversation;
            conversation.id = GetString(object, L"id");
            conversation.title = GetString(object, L"title");
            conversation.providerId = GetString(object, L"providerId");
            conversation.model = GetString(object, L"model");
            conversation.createdAt = GetInt64(object, L"createdAt");
            conversation.updatedAt = GetInt64(object, L"updatedAt");

            auto messages = GetArray(object, L"messages", true);
            for (uint32_t index = 0; index < messages.Size(); ++index)
            {
                if (messages.GetAt(index).ValueType() != JsonValueType::Object)
                {
                    ThrowInvalidSnapshot();
                }
                conversation.messages.push_back(MessageFromJson(messages.GetObjectAt(index)));
            }
            return conversation;
        }

        JsonObject SyncToJson(SyncConfig const& sync)
        {
            JsonObject object;
            object.Insert(L"mode", JsonValue::CreateStringValue(sync.mode));
            object.Insert(L"autoSync", JsonValue::CreateBooleanValue(sync.autoSync));
            object.Insert(L"encryptionEnabled", JsonValue::CreateBooleanValue(sync.encryptionEnabled));
            if (!sync.gistId.empty())
            {
                object.Insert(L"gistId", JsonValue::CreateStringValue(sync.gistId));
            }
            object.Insert(L"gistFile", JsonValue::CreateStringValue(sync.gistFile));
            if (!sync.workerEndpoint.empty())
            {
                object.Insert(L"workerEndpoint", JsonValue::CreateStringValue(sync.workerEndpoint));
            }
            if (sync.lastSyncAt > 0)
            {
                object.Insert(L"lastSyncAt", JsonValue::CreateNumberValue(static_cast<double>(sync.lastSyncAt)));
            }
            if (!sync.lastSyncStatus.empty())
            {
                object.Insert(L"lastSyncStatus", JsonValue::CreateStringValue(sync.lastSyncStatus));
            }
            return object;
        }

        SyncConfig SyncFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"mode", L"autoSync", L"encryptionEnabled", L"gistId", L"gistFile",
                  L"workerEndpoint", L"lastSyncAt", L"lastSyncStatus" },
                { L"mode", L"autoSync", L"encryptionEnabled" });
            SyncConfig sync;
            sync.mode = GetString(object, L"mode", L"local");
            sync.autoSync = GetBool(object, L"autoSync", false);
            sync.encryptionEnabled = GetBool(object, L"encryptionEnabled", true);
            sync.gistId = GetString(object, L"gistId");
            sync.gistFile = GetString(object, L"gistFile", L"zerochat-sync.json");
            sync.workerEndpoint = GetString(object, L"workerEndpoint");
            sync.lastSyncAt = GetInt64(object, L"lastSyncAt");
            sync.lastSyncStatus = GetString(object, L"lastSyncStatus");
            return sync;
        }

        JsonObject PreferencesToJson(Preferences const& preferences)
        {
            JsonObject object;
            object.Insert(L"firstRunDone", JsonValue::CreateBooleanValue(preferences.firstRunDone));
            object.Insert(L"theme", JsonValue::CreateStringValue(preferences.theme));
            object.Insert(L"language", JsonValue::CreateStringValue(preferences.language));
            object.Insert(L"compactMode", JsonValue::CreateBooleanValue(preferences.compactMode));
            object.Insert(L"chatContextMessageLimit", JsonValue::CreateNumberValue(preferences.chatContextMessageLimit));
            if (!preferences.activeConversationId.empty())
            {
                object.Insert(L"activeConversationId", JsonValue::CreateStringValue(preferences.activeConversationId));
            }
            object.Insert(L"dismissedDangerWarnings", StringArray(preferences.dismissedDangerWarnings));
            object.Insert(L"dismissedFeatureHints", StringArray(preferences.dismissedFeatureHints));
            return object;
        }

        Preferences PreferencesFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"firstRunDone", L"theme", L"language", L"compactMode",
                  L"chatContextMessageLimit", L"activeConversationId",
                  L"dismissedDangerWarnings", L"dismissedFeatureHints" },
                { L"firstRunDone", L"theme", L"language", L"compactMode" });
            Preferences preferences;
            preferences.firstRunDone = GetBool(object, L"firstRunDone", false);
            preferences.theme = GetString(object, L"theme", L"system");
            preferences.language = GetString(object, L"language", L"system");
            preferences.compactMode = GetBool(object, L"compactMode", false);
            preferences.chatContextMessageLimit = GetInt(object, L"chatContextMessageLimit", 24);
            preferences.activeConversationId = GetString(object, L"activeConversationId");
            preferences.dismissedDangerWarnings = ReadStringArray(object, L"dismissedDangerWarnings");
            preferences.dismissedFeatureHints = ReadStringArray(object, L"dismissedFeatureHints");
            return preferences;
        }

        JsonObject SkillChunkToJson(UserSkillChunk const& chunk)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(chunk.id));
            object.Insert(L"heading", JsonValue::CreateStringValue(chunk.heading));
            if (!chunk.content.empty())
            {
                object.Insert(L"content", JsonValue::CreateStringValue(chunk.content));
            }
            if (!chunk.contentRef.empty())
            {
                object.Insert(L"contentRef", JsonValue::CreateStringValue(chunk.contentRef));
            }
            if (!chunk.contentPreview.empty())
            {
                object.Insert(L"contentPreview", JsonValue::CreateStringValue(chunk.contentPreview));
            }
            object.Insert(L"keywords", StringArray(chunk.keywords));
            object.Insert(L"tokenEstimate", JsonValue::CreateNumberValue(chunk.tokenEstimate));
            return object;
        }

        UserSkillChunk SkillChunkFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"heading", L"content", L"contentRef", L"contentPreview", L"keywords", L"tokenEstimate" },
                { L"id", L"heading", L"keywords", L"tokenEstimate" });
            UserSkillChunk chunk;
            chunk.id = GetString(object, L"id");
            chunk.heading = GetString(object, L"heading");
            chunk.content = GetString(object, L"content");
            chunk.contentRef = GetString(object, L"contentRef");
            chunk.contentPreview = GetString(object, L"contentPreview");
            if ((object.HasKey(L"content") && chunk.content.empty()) ||
                (object.HasKey(L"contentRef") && chunk.contentRef.empty()))
            {
                ThrowInvalidSnapshot();
            }
            chunk.keywords = ReadStringArray(object, L"keywords");
            chunk.tokenEstimate = GetInt(object, L"tokenEstimate");
            return chunk;
        }

        JsonObject SkillToJson(UserSkill const& skill)
        {
            JsonObject object;
            object.Insert(L"id", JsonValue::CreateStringValue(skill.id));
            object.Insert(L"name", JsonValue::CreateStringValue(skill.name));
            object.Insert(L"description", JsonValue::CreateStringValue(skill.description));
            if (!skill.fileName.empty())
            {
                object.Insert(L"fileName", JsonValue::CreateStringValue(skill.fileName));
            }
            object.Insert(L"contentType", JsonValue::CreateStringValue(skill.contentType));
            object.Insert(L"sourceSize", JsonValue::CreateNumberValue(skill.sourceSize));
            object.Insert(L"contentHash", JsonValue::CreateStringValue(skill.contentHash));
            object.Insert(L"keywords", StringArray(skill.keywords));

            JsonArray chunks;
            for (auto const& chunk : skill.chunks)
            {
                chunks.Append(SkillChunkToJson(chunk));
            }
            object.Insert(L"chunks", chunks);
            object.Insert(L"fixed", JsonValue::CreateBooleanValue(skill.fixed));
            object.Insert(L"enabled", JsonValue::CreateBooleanValue(skill.enabled));
            object.Insert(L"autoMatch", JsonValue::CreateBooleanValue(skill.autoMatch));
            object.Insert(L"createdAt", JsonValue::CreateNumberValue(static_cast<double>(skill.createdAt)));
            object.Insert(L"updatedAt", JsonValue::CreateNumberValue(static_cast<double>(skill.updatedAt)));
            return object;
        }

        UserSkill SkillFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"id", L"name", L"description", L"fileName", L"contentType", L"sourceSize",
                  L"contentHash", L"keywords", L"chunks", L"fixed", L"enabled", L"autoMatch",
                  L"createdAt", L"updatedAt" },
                { L"id", L"name", L"description", L"contentType", L"sourceSize", L"contentHash",
                  L"keywords", L"chunks", L"fixed", L"enabled", L"autoMatch", L"createdAt", L"updatedAt" });
            UserSkill skill;
            skill.id = GetString(object, L"id");
            skill.name = GetString(object, L"name");
            skill.description = GetString(object, L"description");
            skill.fileName = GetString(object, L"fileName");
            skill.contentType = GetString(object, L"contentType", L"text");
            skill.sourceSize = GetInt(object, L"sourceSize");
            skill.contentHash = GetString(object, L"contentHash");
            skill.keywords = ReadStringArray(object, L"keywords");
            skill.fixed = GetBool(object, L"fixed", false);
            skill.enabled = GetBool(object, L"enabled", true);
            skill.autoMatch = GetBool(object, L"autoMatch", true);
            skill.createdAt = GetInt64(object, L"createdAt");
            skill.updatedAt = GetInt64(object, L"updatedAt");

            auto chunks = GetArray(object, L"chunks", true);
            for (uint32_t index = 0; index < chunks.Size(); ++index)
            {
                if (chunks.GetAt(index).ValueType() != JsonValueType::Object)
                {
                    ThrowInvalidSnapshot();
                }
                skill.chunks.push_back(SkillChunkFromJson(chunks.GetObjectAt(index)));
            }
            return skill;
        }

        JsonObject SkillSettingsToJson(SkillSettings const& settings)
        {
            JsonObject object;
            object.Insert(L"autoMatch", JsonValue::CreateBooleanValue(settings.autoMatch));
            object.Insert(L"contextBudget", JsonValue::CreateNumberValue(settings.contextBudget));
            object.Insert(L"maxAutoSkills", JsonValue::CreateNumberValue(settings.maxAutoSkills));
            return object;
        }

        SkillSettings SkillSettingsFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"autoMatch", L"contextBudget", L"maxAutoSkills" },
                { L"autoMatch", L"contextBudget", L"maxAutoSkills" });
            SkillSettings settings;
            settings.autoMatch = GetBool(object, L"autoMatch", true);
            settings.contextBudget = GetInt(object, L"contextBudget", 2400);
            settings.maxAutoSkills = GetInt(object, L"maxAutoSkills", 3);
            return settings;
        }

        bool IsUniqueNonEmpty(std::vector<std::wstring> const& values)
        {
            std::unordered_set<std::wstring> seen;
            for (auto const& value : values)
            {
                if (value.empty() || !seen.insert(value).second)
                {
                    return false;
                }
            }
            return true;
        }

        bool IsNonEmpty(std::vector<std::wstring> const& values)
        {
            return std::all_of(values.begin(), values.end(), [](auto const& value)
            {
                return !value.empty();
            });
        }

        bool IsCanonicalAttachment(MessageAttachment const& attachment)
        {
            return !attachment.id.empty() &&
                attachment.kind == L"image" &&
                Contains({ L"", L"generated", L"source", L"mask" }, attachment.purpose) &&
                !attachment.mimeType.empty() &&
                attachment.createdAt >= 0;
        }

        bool IsCanonicalMessage(ChatMessage const& message)
        {
            bool validRole = false;
            switch (message.role)
            {
            case MessageRole::System:
            case MessageRole::User:
            case MessageRole::Assistant:
                validRole = true;
                break;
            default:
                break;
            }

            return validRole &&
                !message.id.empty() &&
                Contains({ L"queued", L"streaming", L"done", L"error" }, message.status) &&
                message.createdAt >= 0 &&
                std::all_of(message.attachments.begin(), message.attachments.end(), IsCanonicalAttachment) &&
                ((message.queuedTextRequest.providerId.empty() &&
                    message.queuedTextRequest.model.empty() &&
                    !message.queuedTextRequest.promptMessageId) ||
                    (!message.queuedTextRequest.providerId.empty() &&
                        !message.queuedTextRequest.model.empty() &&
                        (!message.queuedTextRequest.promptMessageId ||
                            !message.queuedTextRequest.promptMessageId->empty()))) &&
                (!message.offlineReplayClaim ||
                    (!message.offlineReplayClaim->claimId.empty() && !message.offlineReplayClaim->owner.empty()));
        }

        bool IsCanonicalConversation(Conversation const& conversation)
        {
            return !conversation.id.empty() &&
                !conversation.providerId.empty() &&
                conversation.createdAt >= 0 &&
                conversation.updatedAt >= 0 &&
                std::all_of(conversation.messages.begin(), conversation.messages.end(), IsCanonicalMessage);
        }

        bool IsCanonicalProvider(ProviderConfig const& provider)
        {
            bool validKind = false;
            switch (provider.kind)
            {
            case ProviderKind::OpenAICompatible:
            case ProviderKind::OpenAIResponses:
            case ProviderKind::Anthropic:
                validKind = true;
                break;
            default:
                break;
            }

            return validKind &&
                !provider.id.empty() &&
                !provider.name.empty() &&
                !provider.baseUrl.empty() &&
                IsUniqueNonEmpty(provider.models) &&
                IsUniqueNonEmpty(provider.capabilities) &&
                std::all_of(provider.capabilities.begin(), provider.capabilities.end(), [](auto const& capability)
                {
                    return Contains(
                        { L"chat", L"vision", L"tools", L"image-generation", L"image-editing",
                          L"audio", L"realtime", L"embeddings", L"moderation", L"video", L"model-list" },
                        capability);
                }) &&
                provider.createdAt >= 0 &&
                provider.updatedAt >= 0;
        }

        bool IsCanonicalSkillChunk(UserSkillChunk const& chunk)
        {
            return !chunk.id.empty() &&
                (!chunk.content.empty() || !chunk.contentRef.empty()) &&
                IsNonEmpty(chunk.keywords) &&
                chunk.tokenEstimate >= 1;
        }

        bool IsCanonicalSkill(UserSkill const& skill)
        {
            return !skill.id.empty() &&
                !skill.name.empty() &&
                Contains({ L"markdown", L"text", L"json" }, skill.contentType) &&
                skill.sourceSize >= 0 &&
                !skill.contentHash.empty() &&
                IsNonEmpty(skill.keywords) &&
                !skill.chunks.empty() &&
                std::all_of(skill.chunks.begin(), skill.chunks.end(), IsCanonicalSkillChunk) &&
                skill.createdAt >= 0 &&
                skill.updatedAt >= 0;
        }

        bool IsCanonicalSnapshot(AppSnapshot const& snapshot)
        {
            auto const& settings = snapshot.skillSettings;
            auto const& sync = snapshot.sync;
            auto const& preferences = snapshot.preferences;

            return snapshot.version == 1 &&
                snapshot.updatedAt >= 0 &&
                std::all_of(snapshot.providers.begin(), snapshot.providers.end(), IsCanonicalProvider) &&
                std::all_of(snapshot.conversations.begin(), snapshot.conversations.end(), IsCanonicalConversation) &&
                std::all_of(snapshot.skills.begin(), snapshot.skills.end(), IsCanonicalSkill) &&
                settings.contextBudget >= 600 && settings.contextBudget <= 8000 &&
                settings.maxAutoSkills >= 1 && settings.maxAutoSkills <= 8 &&
                Contains({ L"local", L"gist", L"cloudflare" }, sync.mode) &&
                sync.lastSyncAt >= 0 &&
                Contains({ L"system", L"light", L"dark" }, preferences.theme) &&
                Contains(
                    { L"system", L"zh-CN", L"en-US", L"es-ES", L"hi-IN", L"ar-SA",
                      L"pt-BR", L"ru-RU", L"ja-JP", L"ko-KR", L"fr-FR" },
                    preferences.language) &&
                preferences.chatContextMessageLimit >= 4 &&
                preferences.chatContextMessageLimit <= 200 &&
                IsUniqueNonEmpty(preferences.dismissedDangerWarnings) &&
                IsUniqueNonEmpty(preferences.dismissedFeatureHints);
        }

        hstring SerializeSnapshot(AppSnapshot const& snapshot)
        {
            if (!IsCanonicalSnapshot(snapshot))
            {
                ThrowInvalidSnapshot();
            }
            JsonObject root;
            root.Insert(L"version", JsonValue::CreateNumberValue(snapshot.version));

            JsonArray providers;
            for (auto const& provider : snapshot.providers)
            {
                providers.Append(ProviderToJson(provider));
            }
            root.Insert(L"providers", providers);

            JsonArray conversations;
            for (auto const& conversation : snapshot.conversations)
            {
                conversations.Append(ConversationToJson(conversation));
            }
            root.Insert(L"conversations", conversations);
            JsonArray skills;
            for (auto const& skill : snapshot.skills)
            {
                skills.Append(SkillToJson(skill));
            }
            root.Insert(L"skills", skills);
            root.Insert(L"skillSettings", SkillSettingsToJson(snapshot.skillSettings));
            root.Insert(L"sync", SyncToJson(snapshot.sync));
            root.Insert(L"preferences", PreferencesToJson(snapshot.preferences));
            root.Insert(L"updatedAt", JsonValue::CreateNumberValue(static_cast<double>(snapshot.updatedAt)));
            return root.Stringify();
        }

        AppSnapshot DeserializeSnapshot(hstring const& json)
        {
            JsonObject root{ nullptr };
            if (!JsonObject::TryParse(json, root))
            {
                ThrowInvalidSnapshot();
            }

            RequireObjectShape(
                root,
                { L"version", L"providers", L"conversations", L"skills", L"skillSettings",
                  L"sync", L"preferences", L"updatedAt" },
                { L"version", L"providers", L"conversations", L"skills", L"skillSettings",
                  L"sync", L"preferences", L"updatedAt" });

            AppSnapshot snapshot;
            snapshot.version = GetInt(root, L"version", 1);

            auto providers = GetArray(root, L"providers", true);
            for (uint32_t index = 0; index < providers.Size(); ++index)
            {
                if (providers.GetAt(index).ValueType() != JsonValueType::Object)
                {
                    ThrowInvalidSnapshot();
                }
                snapshot.providers.push_back(ProviderFromJson(providers.GetObjectAt(index)));
            }

            auto conversations = GetArray(root, L"conversations", true);
            for (uint32_t index = 0; index < conversations.Size(); ++index)
            {
                if (conversations.GetAt(index).ValueType() != JsonValueType::Object)
                {
                    ThrowInvalidSnapshot();
                }
                snapshot.conversations.push_back(ConversationFromJson(conversations.GetObjectAt(index)));
            }

            auto skills = GetArray(root, L"skills", true);
            for (uint32_t index = 0; index < skills.Size(); ++index)
            {
                if (skills.GetAt(index).ValueType() != JsonValueType::Object)
                {
                    ThrowInvalidSnapshot();
                }
                snapshot.skills.push_back(SkillFromJson(skills.GetObjectAt(index)));
            }

            snapshot.skillSettings = SkillSettingsFromJson(GetObject(root, L"skillSettings", true));
            snapshot.sync = SyncFromJson(GetObject(root, L"sync", true));
            snapshot.preferences = PreferencesFromJson(GetObject(root, L"preferences", true));

            snapshot.updatedAt = GetInt64(root, L"updatedAt");
            if (!IsCanonicalSnapshot(snapshot))
            {
                ThrowInvalidSnapshot();
            }
            return snapshot;
        }
    }

    IAsyncAction StorageService::LoadAsync(SnapshotHandler onLoaded)
    {
        AppSnapshot snapshot = DefaultSnapshot();
        {
            auto& operationGate = StorageOperationGate();
            co_await winrt::resume_on_signal(operationGate.get());
            StorageOperationLease operationLease(operationGate.get());

            auto folder = ApplicationData::Current().LocalFolder();
            auto primaryItem = co_await folder.TryGetItemAsync(SnapshotFileName());
            auto tempItem = co_await folder.TryGetItemAsync(SnapshotTempFileName());
            StorageFile primaryFile{ nullptr };
            StorageFile tempFile{ nullptr };
            std::optional<AppSnapshot> primarySnapshot;
            std::optional<AppSnapshot> tempSnapshot;
            std::exception_ptr primaryFailure;
            std::exception_ptr tempFailure;

            if (primaryItem)
            {
                try
                {
                    primaryFile = primaryItem.as<StorageFile>();
                    auto json = co_await ReadBoundedSnapshotTextAsync(primaryFile);
                    primarySnapshot = DeserializeSnapshot(json);
                }
                catch (hresult_error const&)
                {
                    primaryFailure = std::current_exception();
                }
            }

            if (tempItem)
            {
                try
                {
                    tempFile = tempItem.as<StorageFile>();
                    auto json = co_await ReadBoundedSnapshotTextAsync(tempFile);
                    tempSnapshot = DeserializeSnapshot(json);
                }
                catch (hresult_error const&)
                {
                    tempFailure = std::current_exception();
                }
            }

            if (tempSnapshot &&
                (!primarySnapshot || tempSnapshot->updatedAt >= primarySnapshot->updatedAt))
            {
                snapshot = std::move(*tempSnapshot);
                try
                {
                    co_await tempFile.RenameAsync(
                        SnapshotFileName(),
                        NameCollisionOption::ReplaceExisting);
                }
                catch (hresult_error const&)
                {
                    // The validated in-memory snapshot remains usable; retry promotion next launch.
                }
            }
            else if (primarySnapshot)
            {
                snapshot = std::move(*primarySnapshot);
                if (tempFile)
                {
                    try
                    {
                        co_await tempFile.DeleteAsync();
                    }
                    catch (hresult_error const&)
                    {
                        // A later save replaces stale temporary data.
                    }
                }
            }
            else if (primaryFailure)
            {
                std::rethrow_exception(primaryFailure);
            }
            else if (tempFailure)
            {
                std::rethrow_exception(tempFailure);
            }
        }

        if (onLoaded)
        {
            onLoaded(snapshot);
        }
    }

    IAsyncAction StorageService::SaveAsync(AppSnapshot const& snapshot)
    {
        auto& operationGate = StorageOperationGate();
        co_await winrt::resume_on_signal(operationGate.get());
        StorageOperationLease operationLease(operationGate.get());

        auto folder = ApplicationData::Current().LocalFolder();
        auto json = SerializeSnapshot(snapshot);
        auto encoded = EncodeBoundedSnapshotText(json);
        auto tempFile = co_await folder.CreateFileAsync(
            SnapshotTempFileName(),
            CreationCollisionOption::ReplaceExisting);
        co_await FileIO::WriteBufferAsync(tempFile, encoded);

        auto currentItem = co_await folder.TryGetItemAsync(SnapshotFileName());
        if (currentItem)
        {
            co_await tempFile.MoveAndReplaceAsync(currentItem.as<StorageFile>());
        }
        else
        {
            co_await tempFile.RenameAsync(SnapshotFileName(), NameCollisionOption::FailIfExists);
        }
    }

    IAsyncAction StorageService::ClearAsync()
    {
        auto& operationGate = StorageOperationGate();
        co_await winrt::resume_on_signal(operationGate.get());
        StorageOperationLease operationLease(operationGate.get());

        auto folder = ApplicationData::Current().LocalFolder();
        auto tempItem = co_await folder.TryGetItemAsync(SnapshotTempFileName());
        if (tempItem)
        {
            co_await tempItem.DeleteAsync();
        }

        auto item = co_await folder.TryGetItemAsync(SnapshotFileName());
        if (item)
        {
            co_await item.DeleteAsync();
        }
    }
}
