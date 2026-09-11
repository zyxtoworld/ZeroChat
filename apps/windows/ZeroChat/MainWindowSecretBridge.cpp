#include "pch.h"
#include "MainWindow.xaml.h"
#include "SecretStore.h"

#include <set>
#include <string>
#include <vector>

namespace winrt::ZeroChat::implementation
{
    namespace
    {
        constexpr wchar_t SecretRequestKind[] = L"zerochat.secret.request.v1";
        constexpr wchar_t SecretResponseKind[] = L"zerochat.secret.response.v1";
        constexpr uint32_t MaxSecretItems = 256;
        constexpr size_t MaxSecretValueBytes = 16 * 1024;
        constexpr size_t MaxSecretJsonBytes = 1024 * 1024;

        struct SecretRequestError final
        {
            wchar_t const* code;
        };

        [[noreturn]] void ThrowInvalidRequest()
        {
            throw SecretRequestError{ L"invalid-request" };
        }

        [[noreturn]] void ThrowSizeLimit()
        {
            throw SecretRequestError{ L"size-limit" };
        }

        size_t Utf8Size(std::wstring_view value)
        {
            if (value.empty())
            {
                return 0;
            }

            auto size = WideCharToMultiByte(
                CP_UTF8,
                WC_ERR_INVALID_CHARS,
                value.data(),
                static_cast<int>(value.size()),
                nullptr,
                0,
                nullptr,
                nullptr);
            if (size <= 0)
            {
                ThrowInvalidRequest();
            }
            return static_cast<size_t>(size);
        }

        bool IsRequestId(std::wstring const& value)
        {
            if (value.empty() || value.size() > 64)
            {
                return false;
            }

            return std::all_of(value.begin(), value.end(), [](wchar_t ch)
            {
                return (ch >= L'a' && ch <= L'z') ||
                    (ch >= L'A' && ch <= L'Z') ||
                    (ch >= L'0' && ch <= L'9') ||
                    ch == L'-';
            });
        }

        bool HasControlCharacter(std::wstring const& value)
        {
            return std::any_of(value.begin(), value.end(), [](wchar_t ch)
            {
                return ch <= 0x1f || (ch >= 0x7f && ch <= 0x9f);
            });
        }

        bool IsSecretName(std::wstring const& name)
        {
            if (name == L"github-token" || name == L"sync-passphrase")
            {
                return true;
            }

            auto separator = name.find(L':');
            if (separator == std::wstring::npos)
            {
                return false;
            }

            auto kind = name.substr(0, separator);
            auto providerId = name.substr(separator + 1);
            return (kind == L"provider" || kind == L"proxy") &&
                !providerId.empty() &&
                providerId.size() <= 256 &&
                !HasControlCharacter(providerId);
        }

        bool HasExactKeys(
            winrt::Windows::Data::Json::JsonObject const& object,
            std::initializer_list<std::wstring_view> expected)
        {
            std::set<std::wstring> actualKeys;
            for (auto const& property : object)
            {
                actualKeys.insert(std::wstring{ property.Key() });
            }

            std::set<std::wstring> expectedKeys;
            for (auto const& key : expected)
            {
                expectedKeys.emplace(key);
            }
            return actualKeys == expectedKeys;
        }

        std::wstring RequiredString(
            winrt::Windows::Data::Json::JsonObject const& object,
            std::wstring_view name)
        {
            auto value = object.GetNamedValue(winrt::hstring{ name });
            if (value.ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
            {
                ThrowInvalidRequest();
            }
            return std::wstring{ value.GetString() };
        }

        std::optional<std::wstring> NullableString(
            winrt::Windows::Data::Json::JsonObject const& object,
            std::wstring_view name)
        {
            auto value = object.GetNamedValue(winrt::hstring{ name });
            if (value.ValueType() == winrt::Windows::Data::Json::JsonValueType::Null)
            {
                return std::nullopt;
            }
            if (value.ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
            {
                ThrowInvalidRequest();
            }
            return std::wstring{ value.GetString() };
        }

        void ValidateSecretName(std::wstring const& name)
        {
            if (!IsSecretName(name))
            {
                ThrowInvalidRequest();
            }
        }

        void ValidateSecretValue(std::wstring const& value)
        {
            if (value.empty())
            {
                ThrowInvalidRequest();
            }
            if (Utf8Size(value) > MaxSecretValueBytes)
            {
                ThrowSizeLimit();
            }
        }

        std::vector<std::wstring> ParseNames(
            winrt::Windows::Data::Json::JsonObject const& request)
        {
            auto value = request.GetNamedValue(L"names");
            if (value.ValueType() != winrt::Windows::Data::Json::JsonValueType::Array)
            {
                ThrowInvalidRequest();
            }

            auto array = value.GetArray();
            if (array.Size() > MaxSecretItems)
            {
                ThrowSizeLimit();
            }

            std::set<std::wstring> unique;
            std::vector<std::wstring> names;
            names.reserve(array.Size());
            for (uint32_t index = 0; index < array.Size(); ++index)
            {
                auto item = array.GetAt(index);
                if (item.ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
                {
                    ThrowInvalidRequest();
                }

                auto name = std::wstring{ item.GetString() };
                ValidateSecretName(name);
                if (!unique.insert(name).second)
                {
                    ThrowInvalidRequest();
                }
                names.push_back(std::move(name));
            }
            return names;
        }

        std::vector<::ZeroChat::SecretMutation> ParseChanges(
            winrt::Windows::Data::Json::JsonObject const& request)
        {
            auto value = request.GetNamedValue(L"changes");
            if (value.ValueType() != winrt::Windows::Data::Json::JsonValueType::Array)
            {
                ThrowInvalidRequest();
            }

            auto array = value.GetArray();
            if (array.Size() > MaxSecretItems)
            {
                ThrowSizeLimit();
            }

            std::set<std::wstring> unique;
            std::vector<::ZeroChat::SecretMutation> changes;
            changes.reserve(array.Size());
            for (uint32_t index = 0; index < array.Size(); ++index)
            {
                auto item = array.GetAt(index);
                if (item.ValueType() != winrt::Windows::Data::Json::JsonValueType::Object)
                {
                    ThrowInvalidRequest();
                }

                auto object = item.GetObject();
                if (!HasExactKeys(object, { L"name", L"value" }))
                {
                    ThrowInvalidRequest();
                }

                auto name = RequiredString(object, L"name");
                ValidateSecretName(name);
                if (!unique.insert(name).second)
                {
                    ThrowInvalidRequest();
                }

                auto secretValue = object.GetNamedValue(L"value");
                if (secretValue.ValueType() == winrt::Windows::Data::Json::JsonValueType::Null)
                {
                    changes.push_back({ std::move(name), std::nullopt });
                    continue;
                }
                if (secretValue.ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
                {
                    ThrowInvalidRequest();
                }

                auto secret = std::wstring{ secretValue.GetString() };
                ValidateSecretValue(secret);
                changes.push_back({ std::move(name), std::move(secret) });
            }
            return changes;
        }

        ::ZeroChat::SecretClearScope ParseClearScope(std::wstring const& value)
        {
            if (value == L"none") return ::ZeroChat::SecretClearScope::None;
            if (value == L"provider") return ::ZeroChat::SecretClearScope::Provider;
            if (value == L"all") return ::ZeroChat::SecretClearScope::All;
            ThrowInvalidRequest();
        }

        std::optional<::ZeroChat::SecretMigrationState> ParseMigrationState(
            std::optional<std::wstring> const& value)
        {
            if (!value.has_value()) return std::nullopt;
            if (*value == L"pending") return ::ZeroChat::SecretMigrationState::Pending;
            if (*value == L"locker-written") return ::ZeroChat::SecretMigrationState::LockerWritten;
            if (*value == L"complete") return ::ZeroChat::SecretMigrationState::Complete;
            ThrowInvalidRequest();
        }

        std::wstring MigrationStateValue(::ZeroChat::SecretMigrationState state)
        {
            switch (state)
            {
            case ::ZeroChat::SecretMigrationState::Pending:
                return L"pending";
            case ::ZeroChat::SecretMigrationState::LockerWritten:
                return L"locker-written";
            case ::ZeroChat::SecretMigrationState::Complete:
                return L"complete";
            }
            throw SecretRequestError{ L"internal-failure" };
        }

        void InsertNullableString(
            winrt::Windows::Data::Json::JsonObject const& object,
            std::wstring_view name,
            std::optional<std::wstring> const& value)
        {
            object.Insert(
                winrt::hstring{ name },
                value.has_value()
                    ? winrt::Windows::Data::Json::JsonValue::CreateStringValue(*value)
                    : winrt::Windows::Data::Json::JsonValue::CreateNullValue());
        }

        winrt::Windows::Data::Json::JsonObject MetadataResponse(
            std::wstring const& id,
            std::wstring const& op,
            ::ZeroChat::SecretStoreResult const& result)
        {
            winrt::Windows::Data::Json::JsonObject response;
            response.Insert(L"kind", winrt::Windows::Data::Json::JsonValue::CreateStringValue(SecretResponseKind));
            response.Insert(L"id", winrt::Windows::Data::Json::JsonValue::CreateStringValue(id));
            response.Insert(L"ok", winrt::Windows::Data::Json::JsonValue::CreateBooleanValue(true));
            response.Insert(L"op", winrt::Windows::Data::Json::JsonValue::CreateStringValue(op));
            InsertNullableString(response, L"revision", result.revision);
            response.Insert(
                L"migrationState",
                winrt::Windows::Data::Json::JsonValue::CreateStringValue(
                    MigrationStateValue(result.migrationState)));
            return response;
        }
    }

    bool MainWindow::TryHandleSecretWebMessage(
        hstring const& json,
        WebViewSessionToken const& webViewSession)
    {
        if (!IsCurrentWebViewSession(webViewSession))
        {
            return false;
        }

        if (Utf8Size(std::wstring_view{ json }) > MaxSecretJsonBytes)
        {
            return false;
        }

        winrt::Windows::Data::Json::JsonObject request{ nullptr };
        if (!winrt::Windows::Data::Json::JsonObject::TryParse(json, request))
        {
            return false;
        }

        hstring kind;
        if (!request.HasKey(L"kind") ||
            request.GetNamedValue(L"kind").ValueType() != winrt::Windows::Data::Json::JsonValueType::String)
        {
            return false;
        }
        kind = request.GetNamedString(L"kind");
        if (kind != SecretRequestKind)
        {
            return false;
        }

        std::wstring id;
        if (request.HasKey(L"id") &&
            request.GetNamedValue(L"id").ValueType() == winrt::Windows::Data::Json::JsonValueType::String)
        {
            id = std::wstring{ request.GetNamedString(L"id") };
        }
        if (!IsRequestId(id))
        {
            return true;
        }

        ProcessSecretWebMessageAsync(json, hstring{ id }, webViewSession);
        return true;
    }

    winrt::Windows::Foundation::IAsyncAction MainWindow::ProcessSecretWebMessageAsync(
        hstring json,
        hstring requestId,
        WebViewSessionToken webViewSession)
    {
        auto weakThis = get_weak();
        winrt::Microsoft::UI::Dispatching::DispatcherQueue dispatcherQueue{ nullptr };
        try
        {
            dispatcherQueue = DispatcherQueue();
            co_await winrt::resume_background();
        }
        catch (...)
        {
            co_return;
        }

        if (!webViewSession || !webViewSession->load(std::memory_order_acquire))
        {
            co_return;
        }

        winrt::Windows::Data::Json::JsonObject request{ nullptr };
        if (!winrt::Windows::Data::Json::JsonObject::TryParse(json, request))
        {
            co_return;
        }
        auto id = std::wstring{ requestId };
        hstring responseJson;

        auto postJson = [&](winrt::Windows::Data::Json::JsonObject const& payload) -> bool
        {
            try
            {
                auto serialized = payload.Stringify();
                if (Utf8Size(std::wstring_view{ serialized }) > MaxSecretJsonBytes)
                {
                    return false;
                }
                responseJson = serialized;
                return true;
            }
            catch (...)
            {
                return false;
            }
        };
        auto postError = [&](std::wstring_view code)
        {
            winrt::Windows::Data::Json::JsonObject response;
            response.Insert(L"kind", winrt::Windows::Data::Json::JsonValue::CreateStringValue(SecretResponseKind));
            response.Insert(L"id", winrt::Windows::Data::Json::JsonValue::CreateStringValue(id));
            response.Insert(L"ok", winrt::Windows::Data::Json::JsonValue::CreateBooleanValue(false));
            response.Insert(L"code", winrt::Windows::Data::Json::JsonValue::CreateStringValue(winrt::hstring{ code }));
            postJson(response);
        };

        bool storageOperationStarted = false;
        try
        {
            auto op = RequiredString(request, L"op");
            ::ZeroChat::SecretStore store;
            ::ZeroChat::SecretStoreResult result;

            if (op == L"probe")
            {
                if (!HasExactKeys(request, { L"kind", L"id", L"op" }))
                {
                    ThrowInvalidRequest();
                }
                storageOperationStarted = true;
                result = store.Probe();
            }
            else if (op == L"read")
            {
                if (!HasExactKeys(request, { L"kind", L"id", L"op", L"names" }))
                {
                    ThrowInvalidRequest();
                }
                auto names = ParseNames(request);
                storageOperationStarted = true;
                result = store.Read(names);
            }
            else if (op == L"mutate")
            {
                if (!HasExactKeys(request, {
                    L"kind",
                    L"id",
                    L"op",
                    L"expectedRevision",
                    L"clearScope",
                    L"changes",
                    L"migrationState",
                }))
                {
                    ThrowInvalidRequest();
                }

                auto expectedRevision = NullableString(request, L"expectedRevision");
                if (expectedRevision.has_value() && !IsRequestId(*expectedRevision))
                {
                    ThrowInvalidRequest();
                }
                auto clearScope = ParseClearScope(RequiredString(request, L"clearScope"));
                auto changes = ParseChanges(request);
                auto migrationState = ParseMigrationState(
                    NullableString(request, L"migrationState"));
                storageOperationStarted = true;
                result = store.Mutate(
                    changes,
                    expectedRevision,
                    clearScope,
                    migrationState);
            }
            else
            {
                ThrowInvalidRequest();
            }

            auto response = MetadataResponse(id, op, result);
            if (op == L"read")
            {
                winrt::Windows::Data::Json::JsonArray entries;
                for (auto const& entry : result.entries)
                {
                    winrt::Windows::Data::Json::JsonObject item;
                    item.Insert(L"name", winrt::Windows::Data::Json::JsonValue::CreateStringValue(entry.name));
                    item.Insert(L"value", winrt::Windows::Data::Json::JsonValue::CreateStringValue(entry.value));
                    entries.Append(item);
                }
                response.Insert(L"entries", entries);
            }

            if (!postJson(response))
            {
                postError(L"size-limit");
            }
        }
        catch (::ZeroChat::SecretStoreConflict const&)
        {
            postError(L"conflict");
        }
        catch (SecretRequestError const& error)
        {
            postError(error.code);
        }
        catch (winrt::hresult_error const&)
        {
            postError(storageOperationStarted ? L"storage-failure" : L"invalid-request");
        }
        catch (...)
        {
            postError(storageOperationStarted ? L"storage-failure" : L"internal-failure");
        }

        if (responseJson.empty() || !dispatcherQueue)
        {
            co_return;
        }

        try
        {
            dispatcherQueue.TryEnqueue([weakThis, responseJson, webViewSession]()
            {
                if (auto currentWindow = weakThis.get();
                    currentWindow && currentWindow->IsCurrentWebViewSession(webViewSession))
                {
                    try
                    {
                        auto webView = currentWindow->WebView();
                        auto coreWebView = webView ? webView.CoreWebView2() : nullptr;
                        if (coreWebView)
                        {
                            coreWebView.PostWebMessageAsJson(responseJson);
                        }
                    }
                    catch (...)
                    {
                    }
                }
            });
        }
        catch (...)
        {
        }
    }
}
