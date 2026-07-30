#include "pch.h"
#include "SyncService.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <initializer_list>
#include <limits>
#include <string_view>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Web.Http.Filters.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Web.Http.h>

using namespace winrt;
using namespace Windows::Data::Json;
using namespace Windows::Foundation;
using namespace Windows::Security::Cryptography;
using namespace Windows::Storage::Streams;
using namespace Windows::Web::Http;
using namespace Windows::Web::Http::Filters;
using namespace Windows::Web::Http::Headers;

namespace ZeroChat
{
    namespace
    {
        using namespace std::chrono_literals;

        constexpr wchar_t SnapshotKind[] = L"zerochat.encryptedSnapshot";
        constexpr wchar_t SnapshotCipher[] = L"AES-256-GCM";
        constexpr wchar_t SnapshotKdf[] = L"PBKDF2-SHA256";
        constexpr int SnapshotVersion = 1;
        constexpr int SnapshotKdfIterations = 600000;
        constexpr int64_t MaxJsonSafeInteger = 9007199254740991LL;
        constexpr uint32_t MaxSyncSnapshotBytes = 900000;
        constexpr uint32_t MaxSyncIncrementalHeadBytes = 16384;
        constexpr uint32_t MaxSyncErrorBodyBytes = 16384;
        constexpr auto WindowsSyncRequestTimeout = 60s;
        constexpr HRESULT SyncTimeoutHresult = HRESULT_FROM_WIN32(ERROR_TIMEOUT);

        winrt::handle& SyncOperationGate()
        {
            static winrt::handle gate{
                winrt::check_pointer(CreateEventW(nullptr, FALSE, TRUE, nullptr)) };
            return gate;
        }

        HttpClient CreateNoRedirectHttpClient()
        {
            HttpBaseProtocolFilter filter;
            filter.AllowAutoRedirect(false);
            return HttpClient(filter);
        }

        [[noreturn]] void ThrowSyncTimeout()
        {
            throw hresult_error(
                SyncTimeoutHresult,
                L"Cloud sync timed out. Check the connection and try again.");
        }

        [[noreturn]] void ThrowSyncBodyTooLarge(
            std::wstring const& label,
            uint32_t maxBytes)
        {
            throw hresult_error(
                E_FAIL,
                hstring(label + L" exceeded the " + std::to_wstring(maxBytes) + L"-byte safety limit."));
        }

        std::chrono::milliseconds RemainingSyncRequestTime(
            std::chrono::steady_clock::time_point deadline)
        {
            auto now = std::chrono::steady_clock::now();
            if (now >= deadline)
            {
                ThrowSyncTimeout();
            }

            auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
            return (std::max)(remaining, 1ms);
        }

        IAsyncAction CancelSyncRequestAfterTimeoutAsync(
            IAsyncInfo operation,
            std::chrono::milliseconds timeout)
        {
            co_await resume_after(timeout);

            if (operation && operation.Status() == AsyncStatus::Started)
            {
                operation.Cancel();
            }
        }

        IAsyncOperation<HttpResponseMessage> AwaitSyncSendAsync(
            IAsyncOperationWithProgress<HttpResponseMessage, HttpProgress> operation,
            std::chrono::steady_clock::time_point deadline)
        {
            auto watchdog = CancelSyncRequestAfterTimeoutAsync(
                operation.as<IAsyncInfo>(),
                RemainingSyncRequestTime(deadline));

            try
            {
                auto response = co_await operation;
                watchdog.Cancel();
                co_return response;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                ThrowSyncTimeout();
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        IAsyncOperation<IInputStream> AwaitSyncInputStreamAsync(
            IAsyncOperationWithProgress<IInputStream, uint64_t> operation,
            std::chrono::steady_clock::time_point deadline)
        {
            auto watchdog = CancelSyncRequestAfterTimeoutAsync(
                operation.as<IAsyncInfo>(),
                RemainingSyncRequestTime(deadline));

            try
            {
                auto input = co_await operation;
                watchdog.Cancel();
                co_return input;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                ThrowSyncTimeout();
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        IAsyncOperation<IBuffer> AwaitSyncBufferAsync(
            IAsyncOperationWithProgress<IBuffer, uint32_t> operation,
            std::chrono::steady_clock::time_point deadline)
        {
            auto watchdog = CancelSyncRequestAfterTimeoutAsync(
                operation.as<IAsyncInfo>(),
                RemainingSyncRequestTime(deadline));

            try
            {
                auto buffer = co_await operation;
                watchdog.Cancel();
                co_return buffer;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                ThrowSyncTimeout();
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        IAsyncOperation<HttpResponseMessage> SendSyncRequestWithTimeoutAsync(
            HttpClient client,
            HttpRequestMessage request,
            uint32_t maxBodyBytes,
            std::wstring label)
        {
            auto deadline = std::chrono::steady_clock::now() + WindowsSyncRequestTimeout;
            auto operation = client.SendRequestAsync(
                request,
                HttpCompletionOption::ResponseHeadersRead);
            auto response = co_await AwaitSyncSendAsync(operation, deadline);

            auto declaredLength = response.Content().Headers().ContentLength();
            if (declaredLength && declaredLength.Value() > maxBodyBytes)
            {
                response.Close();
                ThrowSyncBodyTooLarge(label, maxBodyBytes);
            }

            auto input = co_await AwaitSyncInputStreamAsync(
                response.Content().ReadAsInputStreamAsync(),
                deadline);
            std::string body;
            body.reserve((std::min)(static_cast<size_t>(maxBodyBytes), static_cast<size_t>(8192)));

            while (true)
            {
                auto buffer = co_await AwaitSyncBufferAsync(
                    input.ReadAsync(Buffer(8192), 8192, InputStreamOptions::Partial),
                    deadline);
                auto length = buffer.Length();
                if (length == 0)
                {
                    break;
                }
                if (body.size() + length > maxBodyBytes)
                {
                    input.Close();
                    ThrowSyncBodyTooLarge(label, maxBodyBytes);
                }

                com_array<uint8_t> bytes;
                CryptographicBuffer::CopyToByteArray(buffer, bytes);
                body.append(
                    reinterpret_cast<char const*>(bytes.data()),
                    bytes.size());
            }

            input.Close();
            response.Content(HttpStringContent(
                to_hstring(body),
                UnicodeEncoding::Utf8,
                L"text/plain"));
            co_return response;
        }

        void EnsureSyncTextWithinLimit(
            hstring const& text,
            uint32_t maxBytes,
            std::wstring const& label)
        {
            auto bytes = CryptographicBuffer::ConvertStringToBinary(
                text,
                BinaryStringEncoding::Utf8);
            if (bytes.Length() > maxBytes)
            {
                ThrowSyncBodyTooLarge(label, maxBytes);
            }
        }

        class SyncOperationLease final
        {
        public:
            explicit SyncOperationLease(HANDLE gate) noexcept : m_gate(gate) {}

            SyncOperationLease(SyncOperationLease const&) = delete;
            SyncOperationLease& operator=(SyncOperationLease const&) = delete;

            ~SyncOperationLease()
            {
                SetEvent(m_gate);
            }

        private:
            HANDLE m_gate;
        };

        [[noreturn]] void ThrowInvalidEnvelope()
        {
            throw hresult_invalid_argument(L"Encrypted snapshot envelope has invalid canonical format.");
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
                    ThrowInvalidEnvelope();
                }
            }

            for (auto const& key : requiredKeys)
            {
                if (!object.HasKey(hstring(key)))
                {
                    ThrowInvalidEnvelope();
                }
            }
        }

        std::wstring GetRequiredString(JsonObject const& object, hstring const& key)
        {
            if (!object.HasKey(key) ||
                object.GetNamedValue(key).ValueType() != JsonValueType::String)
            {
                ThrowInvalidEnvelope();
            }

            auto value = std::wstring(object.GetNamedString(key));
            if (value.empty())
            {
                ThrowInvalidEnvelope();
            }
            return value;
        }

        int64_t GetRequiredInt64(JsonObject const& object, hstring const& key)
        {
            if (!object.HasKey(key) ||
                object.GetNamedValue(key).ValueType() != JsonValueType::Number)
            {
                ThrowInvalidEnvelope();
            }

            auto value = object.GetNamedNumber(key);
            if (!std::isfinite(value) || value <= 0 || value > MaxJsonSafeInteger ||
                std::trunc(value) != value)
            {
                ThrowInvalidEnvelope();
            }
            return static_cast<int64_t>(value);
        }

        int GetRequiredInt(JsonObject const& object, hstring const& key)
        {
            auto value = GetRequiredInt64(object, key);
            if (value > (std::numeric_limits<int>::max)())
            {
                ThrowInvalidEnvelope();
            }
            return static_cast<int>(value);
        }

        JsonObject GetRequiredObject(JsonObject const& object, hstring const& key)
        {
            if (!object.HasKey(key) ||
                object.GetNamedValue(key).ValueType() != JsonValueType::Object)
            {
                ThrowInvalidEnvelope();
            }
            return object.GetNamedObject(key);
        }

        int Base64Digit(wchar_t value)
        {
            if (value >= L'A' && value <= L'Z')
            {
                return value - L'A';
            }
            if (value >= L'a' && value <= L'z')
            {
                return value - L'a' + 26;
            }
            if (value >= L'0' && value <= L'9')
            {
                return value - L'0' + 52;
            }
            if (value == L'+')
            {
                return 62;
            }
            if (value == L'/')
            {
                return 63;
            }
            return -1;
        }

        size_t CanonicalBase64DecodedSize(std::wstring_view value)
        {
            if (value.empty() || value.size() % 4 != 0)
            {
                ThrowInvalidEnvelope();
            }

            size_t padding = value.back() == L'=' ? 1 : 0;
            if (value.size() > 1 && value[value.size() - 2] == L'=')
            {
                padding += 1;
            }

            auto dataLength = value.size() - padding;
            for (size_t index = 0; index < dataLength; index += 1)
            {
                if (Base64Digit(value[index]) < 0)
                {
                    ThrowInvalidEnvelope();
                }
            }
            for (size_t index = dataLength; index < value.size(); index += 1)
            {
                if (value[index] != L'=')
                {
                    ThrowInvalidEnvelope();
                }
            }

            if ((padding == 1 && (Base64Digit(value[value.size() - 2]) & 0x03) != 0) ||
                (padding == 2 && (Base64Digit(value[value.size() - 3]) & 0x0f) != 0))
            {
                ThrowInvalidEnvelope();
            }

            return value.size() / 4 * 3 - padding;
        }

        std::wstring ExpectedSnapshotAad(int64_t updatedAt)
        {
            auto value = hstring(L"zerochat:vault:v1:" + std::to_wstring(updatedAt));
            auto buffer = CryptographicBuffer::ConvertStringToBinary(value, BinaryStringEncoding::Utf8);
            return std::wstring(CryptographicBuffer::EncodeToBase64String(buffer));
        }

        std::wstring SyncFailureText(HttpStatusCode status)
        {
            auto code = static_cast<uint32_t>(status);
            auto prefix = L"HTTP " + std::to_wstring(code) + L": ";

            if (code >= 300 && code <= 399)
            {
                return prefix + L"Cloud sync refused an unexpected redirect. Use the final trusted Worker endpoint.";
            }
            if (code == 401 || code == 403)
            {
                return prefix + L"Cloud sync credentials were rejected. Check the data encryption password and Worker configuration.";
            }
            if (code == 404)
            {
                return prefix + L"Cloud sync endpoint was not found. Check the Worker endpoint and deployment version.";
            }
            if (code == 408 || code == 504)
            {
                return prefix + L"Cloud sync timed out. Check the connection and try again.";
            }
            if (code == 409 || code == 428)
            {
                return prefix + L"Cloud data changed on another device. Local and cloud snapshots were preserved; sync again before uploading.";
            }
            if (code == 413)
            {
                return prefix + L"Cloud sync data is too large for the configured service.";
            }
            if (code == 429)
            {
                return prefix + L"Cloud sync is rate-limited. Wait a moment and retry.";
            }
            if (code >= 500 && code <= 599)
            {
                return prefix + L"Cloud sync service is temporarily unavailable. Try again later.";
            }
            return prefix + L"Cloud sync request was rejected. Check the Worker version and sync settings.";
        }

        IAsyncAction ThrowSyncHttpFailureAsync(HttpResponseMessage response)
        {
            co_await response.Content().ReadAsStringAsync();
            throw hresult_error(E_FAIL, SyncFailureText(response.StatusCode()));
        }

        bool IsStrongSnapshotEtag(std::wstring_view value)
        {
            if (value.size() < 2 || value.front() != L'"' || value.back() != L'"')
            {
                return false;
            }

            for (size_t index = 1; index + 1 < value.size(); index += 1)
            {
                auto character = static_cast<uint32_t>(value[index]);
                if (character != 0x21 &&
                    (character < 0x23 || character > 0x7e) &&
                    (character < 0x80 || character > 0xff))
                {
                    return false;
                }
            }
            return true;
        }

        std::wstring RequireStrongSnapshotEtag(HttpResponseMessage const& response)
        {
            auto headers = response.Headers();
            if (!headers.HasKey(L"ETag"))
            {
                throw hresult_error(
                    E_FAIL,
                    L"Cloud snapshot response is missing a strong ETag. Local and cloud snapshots were preserved; update the Worker before syncing.");
            }

            auto etag = std::wstring(headers.Lookup(L"ETag"));
            if (!IsStrongSnapshotEtag(etag))
            {
                throw hresult_error(
                    E_FAIL,
                    L"Cloud snapshot response has an invalid or weak ETag. Local and cloud snapshots were preserved; update the Worker before syncing.");
            }
            return etag;
        }

        void ValidateEnvelope(EncryptedSnapshotEnvelope const& envelope)
        {
            if (envelope.kind != SnapshotKind ||
                envelope.version != SnapshotVersion ||
                envelope.encryptedAt <= 0 ||
                envelope.encryptedAt > MaxJsonSafeInteger ||
                envelope.updatedAt <= 0 ||
                envelope.updatedAt > MaxJsonSafeInteger ||
                envelope.crypto.cipher != SnapshotCipher ||
                envelope.crypto.kdf != SnapshotKdf ||
                envelope.crypto.iterations != SnapshotKdfIterations ||
                envelope.crypto.salt.empty() ||
                envelope.crypto.iv.empty() ||
                envelope.crypto.aad.empty() ||
                envelope.payload.empty())
            {
                ThrowInvalidEnvelope();
            }

            if (CanonicalBase64DecodedSize(envelope.crypto.salt) != 16 ||
                CanonicalBase64DecodedSize(envelope.crypto.iv) != 12 ||
                envelope.crypto.aad != ExpectedSnapshotAad(envelope.updatedAt) ||
                CanonicalBase64DecodedSize(envelope.crypto.aad) == 0 ||
                CanonicalBase64DecodedSize(envelope.payload) <= 16)
            {
                ThrowInvalidEnvelope();
            }
        }

        bool IsLoopbackHost(std::wstring const& host)
        {
            return host == L"localhost" || host == L"127.0.0.1" || host == L"::1" || host == L"[::1]";
        }

        std::wstring NormalizedWorkerEndpoint(std::wstring endpoint)
        {
            while (!endpoint.empty() && endpoint.back() == L'/')
            {
                endpoint.pop_back();
            }

            auto uri = Uri(endpoint);
            auto scheme = std::wstring(uri.SchemeName());
            auto host = std::wstring(uri.Host());
            auto isSafeScheme = scheme == L"https" || (scheme == L"http" && IsLoopbackHost(host));

            if (!isSafeScheme ||
                !uri.UserName().empty() ||
                !uri.Password().empty() ||
                !uri.Query().empty() ||
                !uri.Fragment().empty())
            {
                throw hresult_invalid_argument(L"Cloudflare Worker endpoint must use HTTPS unless it is a loopback address.");
            }

            return endpoint;
        }

        IAsyncAction EnsureNoIncrementalHeadAsync(HttpClient client, std::wstring endpoint)
        {
            HttpRequestMessage request(HttpMethod::Get(), Uri(endpoint + L"/sync/head"));
            auto response = co_await SendSyncRequestWithTimeoutAsync(
                client,
                request,
                MaxSyncIncrementalHeadBytes,
                L"Cloud incremental head response");
            auto status = static_cast<uint32_t>(response.StatusCode());

            if (response.IsSuccessStatusCode())
            {
                co_await response.Content().ReadAsStringAsync();
                throw hresult_error(
                    E_FAIL,
                    L"Cloudflare already has newer sync data. Use the latest app or clear cloud data before syncing here.");
            }

            if (status != 404 && status != 405 && status != 501)
            {
                co_await ThrowSyncHttpFailureAsync(response);
            }

            co_await response.Content().ReadAsStringAsync();
        }

        EnvelopeCrypto CryptoFromJson(JsonObject const& object)
        {
            RequireObjectShape(
                object,
                { L"cipher", L"kdf", L"iterations", L"salt", L"iv", L"aad" },
                { L"cipher", L"kdf", L"iterations", L"salt", L"iv", L"aad" });

            EnvelopeCrypto crypto;
            crypto.cipher = GetRequiredString(object, L"cipher");
            crypto.kdf = GetRequiredString(object, L"kdf");
            crypto.iterations = GetRequiredInt(object, L"iterations");
            crypto.salt = GetRequiredString(object, L"salt");
            crypto.iv = GetRequiredString(object, L"iv");
            crypto.aad = GetRequiredString(object, L"aad");
            return crypto;
        }

        JsonObject CryptoToJson(EnvelopeCrypto const& crypto)
        {
            JsonObject object;
            object.Insert(L"cipher", JsonValue::CreateStringValue(crypto.cipher));
            object.Insert(L"kdf", JsonValue::CreateStringValue(crypto.kdf));
            object.Insert(L"iterations", JsonValue::CreateNumberValue(crypto.iterations));
            object.Insert(L"salt", JsonValue::CreateStringValue(crypto.salt));
            object.Insert(L"iv", JsonValue::CreateStringValue(crypto.iv));
            object.Insert(L"aad", JsonValue::CreateStringValue(crypto.aad));
            return object;
        }

        EncryptedSnapshotEnvelope EnvelopeFromJson(hstring const& text)
        {
            JsonObject root{ nullptr };
            if (!JsonObject::TryParse(text, root))
            {
                ThrowInvalidEnvelope();
            }

            RequireObjectShape(
                root,
                { L"kind", L"version", L"encryptedAt", L"updatedAt", L"crypto", L"payload" },
                { L"kind", L"version", L"encryptedAt", L"updatedAt", L"crypto", L"payload" });

            EncryptedSnapshotEnvelope envelope;
            envelope.kind = GetRequiredString(root, L"kind");
            envelope.version = GetRequiredInt(root, L"version");
            envelope.encryptedAt = GetRequiredInt64(root, L"encryptedAt");
            envelope.updatedAt = GetRequiredInt64(root, L"updatedAt");
            envelope.crypto = CryptoFromJson(GetRequiredObject(root, L"crypto"));
            envelope.payload = GetRequiredString(root, L"payload");

            ValidateEnvelope(envelope);
            return envelope;
        }

        hstring EnvelopeToJson(EncryptedSnapshotEnvelope const& envelope)
        {
            ValidateEnvelope(envelope);

            JsonObject root;
            root.Insert(L"kind", JsonValue::CreateStringValue(envelope.kind));
            root.Insert(L"version", JsonValue::CreateNumberValue(envelope.version));
            root.Insert(L"encryptedAt", JsonValue::CreateNumberValue(static_cast<double>(envelope.encryptedAt)));
            root.Insert(L"updatedAt", JsonValue::CreateNumberValue(static_cast<double>(envelope.updatedAt)));
            root.Insert(L"crypto", CryptoToJson(envelope.crypto));
            root.Insert(L"payload", JsonValue::CreateStringValue(envelope.payload));
            return root.Stringify();
        }
    }

    IAsyncAction SyncService::SyncCloudflareAsync(
        EncryptedSnapshotEnvelope envelope,
        std::wstring const& workerEndpoint,
        std::wstring const& accessKey,
        SnapshotEnvelopeHandler onSynced,
        FirstSyncStrategy firstSyncStrategy,
        bool hasCompletedSync,
        bool hasLocalUserContent)
    {
        if (accessKey.empty())
        {
            throw hresult_invalid_argument(L"Cloudflare access key is required.");
        }

        auto envelopeJson = EnvelopeToJson(envelope);
        EnsureSyncTextWithinLimit(
            envelopeJson,
            MaxSyncSnapshotBytes,
            L"Encrypted sync snapshot");
        auto endpoint = NormalizedWorkerEndpoint(workerEndpoint);
        EncryptedSnapshotEnvelope syncedEnvelope = envelope;
        {
            auto& operationGate = SyncOperationGate();
            co_await winrt::resume_on_signal(operationGate.get());
            SyncOperationLease operationLease(operationGate.get());

            auto client = CreateNoRedirectHttpClient();
            client.DefaultRequestHeaders().Authorization(
                HttpCredentialsHeaderValue(L"Bearer", accessKey));

            co_await EnsureNoIncrementalHeadAsync(client, endpoint);

            auto snapshotEndpoint = Uri(endpoint + L"/snapshot");
            HttpRequestMessage readRequest(HttpMethod::Get(), snapshotEndpoint);
            auto response = co_await SendSyncRequestWithTimeoutAsync(
                client,
                readRequest,
                MaxSyncSnapshotBytes,
                L"Cloud sync snapshot response");
            bool shouldPublishLocal = true;
            bool remoteSnapshotExists = false;
            std::wstring remoteSnapshotEtag;

            if (response.IsSuccessStatusCode())
            {
                remoteSnapshotEtag = RequireStrongSnapshotEtag(response);
                remoteSnapshotExists = true;
                auto remoteJson = co_await response.Content().ReadAsStringAsync();
                auto remote = EnvelopeFromJson(remoteJson);
                if (!hasCompletedSync)
                {
                    if (firstSyncStrategy == FirstSyncStrategy::Merge)
                    {
                        throw hresult_error(
                            E_NOTIMPL,
                            L"Encrypted snapshots cannot be merged safely in the Windows sync transport. Choose local or cloud before syncing.");
                    }

                    if (firstSyncStrategy == FirstSyncStrategy::UseRemote)
                    {
                        syncedEnvelope = remote;
                        shouldPublishLocal = false;
                    }

                    if (firstSyncStrategy == FirstSyncStrategy::Ask)
                    {
                        if (!hasLocalUserContent)
                        {
                            syncedEnvelope = remote;
                            shouldPublishLocal = false;
                        }
                        else
                        {
                            throw hresult_error(
                                E_FAIL,
                                L"Local and cloud both have data. Choose local, cloud, or merge before syncing.");
                        }
                    }
                }

                if (hasCompletedSync && remote.updatedAt > envelope.updatedAt)
                {
                    syncedEnvelope = remote;
                    shouldPublishLocal = false;
                }
            }
            else if (static_cast<uint32_t>(response.StatusCode()) != 404)
            {
                co_await ThrowSyncHttpFailureAsync(response);
            }
            else
            {
                co_await response.Content().ReadAsStringAsync();
            }

            if (shouldPublishLocal)
            {
                HttpRequestMessage writeRequest(HttpMethod::Put(), snapshotEndpoint);
                if (remoteSnapshotExists)
                {
                    writeRequest.Headers().Append(L"If-Match", remoteSnapshotEtag);
                }
                else
                {
                    writeRequest.Headers().Append(L"If-None-Match", L"*");
                }
                writeRequest.Content(HttpStringContent(
                    envelopeJson,
                    UnicodeEncoding::Utf8,
                    L"application/json"));

                auto write = co_await SendSyncRequestWithTimeoutAsync(
                    client,
                    writeRequest,
                    MaxSyncErrorBodyBytes,
                    L"Cloud sync write response");
                if (!write.IsSuccessStatusCode())
                {
                    co_await ThrowSyncHttpFailureAsync(write);
                }
                co_await write.Content().ReadAsStringAsync();
            }
        }

        if (onSynced)
        {
            onSynced(syncedEnvelope);
        }
        co_return;
    }

    IAsyncAction SyncService::ClearCloudflareAsync(
        std::wstring const& workerEndpoint,
        std::wstring const& accessKey)
    {
        if (accessKey.empty())
        {
            throw hresult_invalid_argument(L"Cloudflare access key is required.");
        }

        auto endpoint = NormalizedWorkerEndpoint(workerEndpoint);
        auto& operationGate = SyncOperationGate();
        co_await winrt::resume_on_signal(operationGate.get());
        SyncOperationLease operationLease(operationGate.get());

        auto client = CreateNoRedirectHttpClient();
        client.DefaultRequestHeaders().Authorization(
            HttpCredentialsHeaderValue(L"Bearer", accessKey));

        HttpRequestMessage bulkRequest(HttpMethod::Delete(), Uri(endpoint + L"/sync/clear"));
        auto bulk = co_await SendSyncRequestWithTimeoutAsync(
            client,
            bulkRequest,
            MaxSyncErrorBodyBytes,
            L"Cloud clear response");

        if (bulk.IsSuccessStatusCode())
        {
            co_await bulk.Content().ReadAsStringAsync();
            co_return;
        }

        auto status = static_cast<uint32_t>(bulk.StatusCode());
        if (status != 404 && status != 405 && status != 501)
        {
            co_await ThrowSyncHttpFailureAsync(bulk);
        }

        co_await bulk.Content().ReadAsStringAsync();

        for (auto const& path : { L"/sync/head", L"/snapshot" })
        {
            HttpRequestMessage request(HttpMethod::Delete(), Uri(endpoint + path));
            auto response = co_await SendSyncRequestWithTimeoutAsync(
                client,
                request,
                MaxSyncErrorBodyBytes,
                L"Cloud fallback clear response");
            auto code = static_cast<uint32_t>(response.StatusCode());

            if (response.IsSuccessStatusCode() || code == 404)
            {
                co_await response.Content().ReadAsStringAsync();
                continue;
            }

            if (!response.IsSuccessStatusCode())
            {
                co_await ThrowSyncHttpFailureAsync(response);
            }
        }

        co_return;
    }
}
