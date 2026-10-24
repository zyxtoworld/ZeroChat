#include "pch.h"
#include "AiClient.h"
#include "AiClientProtocol.h"

#include <algorithm>
#include <chrono>
#include <cwctype>
#include <functional>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Web.Http.Filters.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Web.Http.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Storage::Streams;
using namespace Windows::Web::Http;
using namespace Windows::Web::Http::Filters;
using namespace Windows::Web::Http::Headers;

namespace ZeroChat
{
    namespace
    {
        using namespace std::chrono_literals;

        constexpr auto WindowsAiModelListTimeout = 30s;
        constexpr auto WindowsAiChatRequestTimeout = 60s;
        constexpr auto WindowsAiImageRequestTimeout = 180s;
        constexpr auto WindowsAiCapabilityRequestTimeout = 60s;
        constexpr auto WindowsAiStreamIdleTimeout = 90s;
        constexpr uint64_t WindowsAiErrorResponseMaxBytes = 16'384;
        constexpr uint64_t WindowsAiTextResponseMaxBytes = 8'000'000;
        constexpr uint64_t WindowsAiImageResponseMaxBytes = 32'000'000;
        constexpr uint64_t WindowsGeneratedImageDownloadMaxBytes = 20'000'000;
        constexpr uint64_t WindowsAiAudioResponseMaxBytes = 32'000'000;
        constexpr uint64_t WindowsAiStreamResponseMaxBytes = 8'000'000;
        constexpr HRESULT ProviderTimeoutHresult = HRESULT_FROM_WIN32(ERROR_TIMEOUT);
        constexpr HRESULT ProviderEmptyResponseHresult =
            MAKE_HRESULT(SEVERITY_ERROR, FACILITY_ITF, 0x201);
        constexpr uint32_t WindowsAiGenerationAutoRetries = 3;

        HttpClient CreateCredentialBoundHttpClient()
        {
            HttpBaseProtocolFilter filter;
            filter.AllowAutoRedirect(false);
            filter.CookieUsageBehavior(HttpCookieUsageBehavior::NoCookies);
            return HttpClient(filter);
        }

        IBuffer BufferFromBytes(std::vector<uint8_t> const& bytes)
        {
            DataWriter writer;
            if (!bytes.empty())
            {
                writer.WriteBytes(winrt::array_view<uint8_t const>(
                    bytes.data(),
                    bytes.data() + bytes.size()));
            }
            return writer.DetachBuffer();
        }

        HttpBufferContent UploadContent(ImageUpload const& upload)
        {
            HttpBufferContent content(BufferFromBytes(upload.bytes));
            content.Headers().ContentType(HttpMediaTypeHeaderValue(upload.mimeType));
            return content;
        }

        HttpBufferContent MultipartContent(std::vector<uint8_t> const& bytes, std::wstring const& boundary)
        {
            HttpBufferContent content(BufferFromBytes(bytes));
            content.Headers().ContentType(HttpMediaTypeHeaderValue(L"multipart/form-data"));
            content.Headers().ContentType().Parameters().Append(HttpNameValueHeaderValue(L"boundary", boundary));
            return content;
        }

        std::wstring TrimUploadValue(std::wstring value)
        {
            while (!value.empty() && std::iswspace(value.front()))
            {
                value.erase(value.begin());
            }

            while (!value.empty() && std::iswspace(value.back()))
            {
                value.pop_back();
            }

            return value;
        }

        std::wstring ImageMimeTypeFromFileName(std::wstring const& fileName)
        {
            auto dot = fileName.find_last_of(L'.');
            auto extension = dot == std::wstring::npos ? std::wstring{} : fileName.substr(dot + 1);
            for (auto& character : extension)
            {
                character = static_cast<wchar_t>(std::towlower(character));
            }

            if (extension == L"jpg" || extension == L"jpeg")
            {
                return L"image/jpeg";
            }
            if (extension == L"webp")
            {
                return L"image/webp";
            }

            return L"image/png";
        }

        ImageUpload NormalizeImageUpload(ImageUpload upload, std::wstring const& fallbackName)
        {
            auto fileName = TrimUploadValue(upload.fileName);
            upload.fileName = fileName.empty() ? fallbackName : fileName;

            auto mimeType = TrimUploadValue(upload.mimeType);
            upload.mimeType = mimeType.empty() ? ImageMimeTypeFromFileName(upload.fileName) : mimeType;
            return upload;
        }

        IAsyncAction CancelAfterAsync(
            IAsyncInfo operation,
            std::chrono::seconds timeout)
        {
            co_await resume_after(timeout);

            if (operation && operation.Status() == AsyncStatus::Started)
            {
                operation.Cancel();
            }
        }

        IAsyncOperation<HttpResponseMessage> SendRequestWithTimeoutAsync(
            HttpClient client,
            HttpRequestMessage request,
            std::chrono::seconds timeout,
            hstring timeoutMessage,
            HttpCompletionOption completionOption = HttpCompletionOption::ResponseHeadersRead)
        {
            auto operation = client.SendRequestAsync(request, completionOption);
            auto watchdog = CancelAfterAsync(operation.as<IAsyncInfo>(), timeout);

            try
            {
                auto response = co_await operation;
                watchdog.Cancel();
                co_return response;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                throw hresult_error(ProviderTimeoutHresult, timeoutMessage);
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        IAsyncOperation<IInputStream> ReadStreamWithTimeoutAsync(
            IHttpContent content,
            std::chrono::seconds timeout,
            hstring timeoutMessage)
        {
            auto operation = content.ReadAsInputStreamAsync();
            auto watchdog = CancelAfterAsync(operation.as<IAsyncInfo>(), timeout);

            try
            {
                auto stream = co_await operation;
                watchdog.Cancel();
                co_return stream;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                throw hresult_error(ProviderTimeoutHresult, timeoutMessage);
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        IAsyncOperation<uint32_t> LoadChunkWithTimeoutAsync(
            DataReader reader,
            uint32_t byteCount,
            std::chrono::seconds timeout,
            hstring timeoutMessage)
        {
            auto operation = reader.LoadAsync(byteCount);
            auto watchdog = CancelAfterAsync(operation.as<IAsyncInfo>(), timeout);

            try
            {
                auto loaded = co_await operation;
                watchdog.Cancel();
                co_return loaded;
            }
            catch (hresult_canceled const&)
            {
                watchdog.Cancel();
                throw hresult_error(ProviderTimeoutHresult, timeoutMessage);
            }
            catch (...)
            {
                watchdog.Cancel();
                throw;
            }
        }

        hstring ProviderResponseLimitMessage(hstring const& label, uint64_t maxBytes)
        {
            return hstring{
                std::wstring(label.c_str()) +
                L" exceeded the " +
                std::to_wstring(maxBytes) +
                L"-byte safety limit."
            };
        }

        uint64_t AccumulateProviderResponseBytes(
            uint64_t currentBytes,
            uint64_t nextBytes,
            uint64_t maxBytes,
            hstring const& label)
        {
            if (nextBytes > maxBytes || currentBytes > maxBytes - nextBytes)
            {
                throw hresult_error(
                    E_INVALIDARG,
                    ProviderResponseLimitMessage(label, maxBytes));
            }

            return currentBytes + nextBytes;
        }

        void EnsureProviderContentLengthWithinLimit(
            IHttpContent const& content,
            uint64_t maxBytes,
            hstring const& label)
        {
            auto declaredLength = content.Headers().ContentLength();
            if (declaredLength && declaredLength.Value() > maxBytes)
            {
                throw hresult_error(
                    E_INVALIDARG,
                    ProviderResponseLimitMessage(label, maxBytes));
            }
        }

        void CloseProviderDataReader(DataReader& reader) noexcept
        {
            try
            {
                reader.Close();
            }
            catch (...)
            {
            }
        }

        IAsyncOperation<IBuffer> ReadBufferBoundedWithTimeoutAsync(
            IHttpContent content,
            std::chrono::seconds timeout,
            hstring timeoutMessage,
            uint64_t maxBytes,
            hstring label)
        {
            EnsureProviderContentLengthWithinLimit(content, maxBytes, label);
            auto stream = co_await ReadStreamWithTimeoutAsync(content, timeout, timeoutMessage);
            DataReader reader(stream);
            reader.InputStreamOptions(InputStreamOptions::Partial);
            std::vector<uint8_t> bytes;
            auto declaredLength = content.Headers().ContentLength();
            if (declaredLength)
            {
                bytes.reserve(static_cast<size_t>(declaredLength.Value()));
            }
            uint64_t totalBytes = 0;
            auto closeReader = [&reader]() noexcept
            {
                CloseProviderDataReader(reader);
            };

            try
            {
                while (true)
                {
                    auto loaded = co_await LoadChunkWithTimeoutAsync(
                        reader,
                        8192,
                        timeout,
                        timeoutMessage);
                    if (loaded == 0)
                    {
                        break;
                    }

                    totalBytes = AccumulateProviderResponseBytes(
                        totalBytes,
                        loaded,
                        maxBytes,
                        label);

                    auto offset = bytes.size();
                    bytes.resize(offset + loaded);
                    reader.ReadBytes(winrt::array_view<uint8_t>(
                        bytes.data() + offset,
                        bytes.data() + bytes.size()));
                }

                closeReader();
                co_return BufferFromBytes(bytes);
            }
            catch (...)
            {
                closeReader();
                throw;
            }
        }

        std::vector<uint8_t> BytesFromBuffer(IBuffer const& buffer)
        {
            std::vector<uint8_t> bytes(buffer.Length());
            if (!bytes.empty())
            {
                auto reader = DataReader::FromBuffer(buffer);
                reader.ReadBytes(winrt::array_view<uint8_t>(
                    bytes.data(),
                    bytes.data() + bytes.size()));
            }
            return bytes;
        }

        std::optional<std::wstring> GeneratedImageMimeType(std::vector<uint8_t> const& bytes)
        {
            static constexpr uint8_t PngSignature[] = { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a };
            static constexpr uint8_t JpegSignature[] = { 0xff, 0xd8, 0xff };
            if (bytes.size() >= std::size(PngSignature) &&
                std::equal(std::begin(PngSignature), std::end(PngSignature), bytes.begin()))
            {
                return L"image/png";
            }
            if (bytes.size() >= std::size(JpegSignature) &&
                std::equal(std::begin(JpegSignature), std::end(JpegSignature), bytes.begin()))
            {
                return L"image/jpeg";
            }
            if (bytes.size() >= 12 &&
                std::equal(bytes.begin(), bytes.begin() + 4, reinterpret_cast<uint8_t const*>("RIFF")) &&
                std::equal(bytes.begin() + 8, bytes.begin() + 12, reinterpret_cast<uint8_t const*>("WEBP")))
            {
                return L"image/webp";
            }
            return std::nullopt;
        }

        IAsyncAction MaterializeGeneratedImageAsync(
            HttpClient client,
            GeneratedImage& image)
        {
            if (!image.dataUrl.empty())
            {
                co_return;
            }

            auto source = SafeRemoteImageAttachmentUrl(image.url);
            if (!source)
            {
                throw hresult_error(E_FAIL, L"Image generation returned no usable image.");
            }

            HttpRequestMessage request;
            request.Method(HttpMethod::Get());
            request.RequestUri(Uri(*source));
            request.Headers().Accept().Append(HttpMediaTypeWithQualityHeaderValue(L"image/png"));
            request.Headers().Accept().Append(HttpMediaTypeWithQualityHeaderValue(L"image/jpeg"));
            request.Headers().Accept().Append(HttpMediaTypeWithQualityHeaderValue(L"image/webp"));
            auto response = co_await SendRequestWithTimeoutAsync(
                client,
                request,
                WindowsAiImageRequestTimeout,
                L"Generated image download timed out.");
            if (!response.IsSuccessStatusCode())
            {
                throw hresult_error(
                    E_FAIL,
                    hstring{
                        L"Generated image download failed: HTTP " +
                        std::to_wstring(static_cast<uint32_t>(response.StatusCode())) });
            }
            auto finalUrl = SafeRemoteImageAttachmentUrl(
                std::wstring(response.RequestMessage().RequestUri().AbsoluteUri()));
            if (!finalUrl || *finalUrl != *source)
            {
                throw hresult_error(E_FAIL, L"Image generation returned no usable image.");
            }

            auto buffer = co_await ReadBufferBoundedWithTimeoutAsync(
                response.Content(),
                WindowsAiImageRequestTimeout,
                L"Generated image download timed out.",
                WindowsGeneratedImageDownloadMaxBytes,
                L"Generated image download");
            auto bytes = BytesFromBuffer(buffer);
            auto mimeType = GeneratedImageMimeType(bytes);
            if (!mimeType)
            {
                throw hresult_error(E_FAIL, L"Image generation returned no usable image.");
            }

            image.dataUrl = L"data:" + *mimeType + L";base64," + Base64Encode(bytes);
            image.url.clear();
            image.mimeType = std::move(*mimeType);
            co_return;
        }

        hstring TextFromBuffer(IBuffer const& buffer)
        {
            auto bytes = BytesFromBuffer(buffer);
            return to_hstring(std::string(bytes.begin(), bytes.end()));
        }

        IAsyncOperation<hstring> ReadTextBoundedWithTimeoutAsync(
            IHttpContent content,
            std::chrono::seconds timeout,
            hstring timeoutMessage,
            uint64_t maxBytes,
            hstring label)
        {
            auto buffer = co_await ReadBufferBoundedWithTimeoutAsync(
                content,
                timeout,
                timeoutMessage,
                maxBytes,
                label);
            co_return TextFromBuffer(buffer);
        }

        std::chrono::milliseconds GenerationAutoRetryDelay(uint32_t retryIndex)
        {
            switch (retryIndex)
            {
            case 0:
                return 400ms;
            case 1:
                return 900ms;
            default:
                return 1600ms;
            }
        }

        std::wstring Lowercase(std::wstring value)
        {
            for (auto& character : value)
            {
                character = static_cast<wchar_t>(std::towlower(character));
            }
            return value;
        }

        bool Contains(std::wstring const& text, std::wstring_view marker)
        {
            return text.find(marker) != std::wstring::npos;
        }

        bool StartsWith(std::wstring const& text, std::wstring_view marker)
        {
            return text.rfind(marker, 0) == 0;
        }

        bool ContainsAny(std::wstring const& text, std::initializer_list<std::wstring_view> markers)
        {
            for (auto marker : markers)
            {
                if (Contains(text, marker))
                {
                    return true;
                }
            }
            return false;
        }

        bool IsRetryableGenerationError(
            hresult_error const& error,
            uint32_t httpStatus)
        {
            if (error.code() == ProviderTimeoutHresult ||
                error.code() == ProviderEmptyResponseHresult)
            {
                return true;
            }

            if (error.code() == E_INVALIDARG || error.code() == E_ABORT)
            {
                return false;
            }

            if (httpStatus != 0)
            {
                return httpStatus == 408 ||
                    httpStatus == 409 ||
                    httpStatus == 425 ||
                    httpStatus == 429 ||
                    httpStatus == 500 ||
                    httpStatus == 502 ||
                    httpStatus == 503 ||
                    httpStatus == 504;
            }

            auto message = Lowercase(std::wstring(error.message().c_str()));
            for (auto marker : {
                L"timeout",
                L"timed out",
                L"network",
                L"connection reset",
                L"connection refused",
                L"failed to connect",
                L"temporarily unavailable",
                L"temporary failure",
                L"socket",
                L"unavailable",
                L"too many requests",
                L"rate limit",
            })
            {
                if (Contains(message, marker))
                {
                    return true;
                }
            }

            return false;
        }

        std::wstring FailureTextWithStatus(HttpStatusCode status, hstring const& body)
        {
            auto code = static_cast<uint32_t>(status);
            auto text = Lowercase(std::wstring(body.c_str()));

            if (code >= 300 && code <= 399)
            {
                return L"The AI request refused an unexpected redirect. Use the final trusted provider or proxy endpoint.";
            }

            if (code == 401 || code == 403 || ContainsAny(text, {
                L"api key is invalid",
                L"authentication",
                L"forbidden",
                L"incorrect api key",
                L"invalid api key",
                L"permission_denied",
                L"unauthorized",
            }))
            {
                return L"API key is invalid. Check that it was copied completely.";
            }

            if (code == 402 || ContainsAny(text, {
                L"balance",
                L"billing",
                L"credit",
                L"insufficient_quota",
                L"quota",
                L"充值",
                L"余额",
                L"额度",
            }))
            {
                return L"API balance is insufficient. Add credit and try again.";
            }

            if (code == 408 || code == 504 || ContainsAny(text, {
                L"deadline exceeded",
                L"network connection failed",
                L"network request failed",
                L"timed out",
                L"timeout",
            }))
            {
                return L"Network connection failed. Check your connection and try again.";
            }

            if (code == 429 || ContainsAny(text, {
                L"rate limit",
                L"rate_limit",
                L"requests per",
                L"too many requests",
                L"请求太频繁",
            }))
            {
                return L"Too many requests. Wait a moment and retry.";
            }

            if ((code >= 500 && code <= 599) || ContainsAny(text, {
                L"bad gateway",
                L"gateway timeout",
                L"overloaded",
                L"server error",
                L"service unavailable",
                L"temporarily unavailable",
            }))
            {
                return L"The provider is temporarily unavailable. Try again later.";
            }

            return L"The provider could not complete the request. Try again later.";
        }

        std::wstring FailureTextWithHttpStatus(HttpStatusCode status, hstring const& body)
        {
            return L"HTTP " +
                std::to_wstring(static_cast<uint32_t>(status)) +
                L": " +
                FailureTextWithStatus(status, body);
        }

        std::wstring Trim(std::wstring value)
        {
            while (!value.empty() && std::iswspace(value.front()))
            {
                value.erase(value.begin());
            }

            while (!value.empty() && std::iswspace(value.back()))
            {
                value.pop_back();
            }

            return value;
        }

        bool AudioBytesHaveKnownSignature(std::vector<uint8_t> const& bytes)
        {
            auto startsWith = [&bytes](std::initializer_list<uint8_t> values)
            {
                return bytes.size() >= values.size() &&
                    std::equal(values.begin(), values.end(), bytes.begin());
            };

            return startsWith({ 0x49, 0x44, 0x33 }) ||
                startsWith({ 0x52, 0x49, 0x46, 0x46 }) ||
                startsWith({ 0x4f, 0x67, 0x67, 0x53 }) ||
                startsWith({ 0x66, 0x4c, 0x61, 0x43 }) ||
                (bytes.size() > 1 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0) ||
                (bytes.size() > 7 && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70);
        }

        bool AudioBytesLookLikeText(std::vector<uint8_t> const& bytes)
        {
            auto sampleEnd = bytes.begin() + std::min<size_t>(bytes.size(), 96);
            auto firstContentByte = std::find_if(
                bytes.begin(),
                sampleEnd,
                [](uint8_t byte)
                {
                    return byte != 0x09 && byte != 0x0a && byte != 0x0d && byte != 0x20;
                });

            if (firstContentByte != sampleEnd &&
                (*firstContentByte == 0x7b || *firstContentByte == 0x5b || *firstContentByte == 0x3c))
            {
                return true;
            }

            return std::all_of(
                bytes.begin(),
                sampleEnd,
                [](uint8_t byte)
                {
                    return byte == 0x09 ||
                        byte == 0x0a ||
                        byte == 0x0d ||
                        (byte >= 0x20 && byte <= 0x7e);
                });
        }

        bool ProviderAudioResponseLooksValid(
            std::vector<uint8_t> const& bytes,
            hstring const& contentType)
        {
            if (bytes.empty() || AudioBytesLookLikeText(bytes))
            {
                return false;
            }

            auto normalizedContentType = Lowercase(Trim(std::wstring(contentType.c_str())));
            if (StartsWith(normalizedContentType, L"audio/") ||
                Contains(normalizedContentType, L"octet-stream"))
            {
                return true;
            }

            if (AudioBytesHaveKnownSignature(bytes))
            {
                return true;
            }

            return !ContainsAny(normalizedContentType, {
                L"json",
                L"text/",
                L"html",
                L"xml",
            });
        }

        std::wstring TrimStart(std::wstring value)
        {
            while (!value.empty() && std::iswspace(value.front()))
            {
                value.erase(value.begin());
            }

            return value;
        }

        std::wstring JoinEventData(std::vector<std::wstring> const& eventData)
        {
            std::wstring data;

            for (auto const& line : eventData)
            {
                if (!data.empty())
                {
                    data.append(L"\n");
                }
                data.append(line);
            }

            return Trim(data);
        }

        bool ProcessSseEvent(
            std::vector<std::wstring>& eventData,
            TokenHandler const& onToken,
            bool& emittedToken)
        {
            auto data = JoinEventData(eventData);
            eventData.clear();

            if (data.empty())
            {
                return true;
            }

            if (data == L"[DONE]")
            {
                return false;
            }

            auto delta = ChatDeltaFromSseData(data);
            if (!delta.empty())
            {
                if (!Trim(delta).empty())
                {
                    emittedToken = true;
                }
                if (onToken)
                {
                    onToken(delta);
                }
            }

            return true;
        }

        bool ProcessSseLine(
            std::wstring const& line,
            std::vector<std::wstring>& eventData,
            TokenHandler const& onToken,
            bool& emittedToken)
        {
            if (Trim(line).empty())
            {
                return ProcessSseEvent(eventData, onToken, emittedToken);
            }

            if (StartsWith(line, L"data:"))
            {
                eventData.push_back(TrimStart(line.substr(5)));
            }
            else if (StartsWith(line, L":") ||
                StartsWith(line, L"event:") ||
                StartsWith(line, L"id:") ||
                StartsWith(line, L"retry:"))
            {
            }
            else if (StartsWith(line, L"{") || StartsWith(line, L"["))
            {
                eventData.push_back(line);
            }

            return true;
        }

        std::vector<std::wstring> ResponsesImageModels(
            ProviderConfig const& provider,
            std::wstring const& responsesModel,
            std::wstring const& imageModel)
        {
            auto primary = Trim(responsesModel);
            std::vector<std::wstring> ordered;
            if (primary.empty())
            {
                ordered = { provider.model, imageModel };
            }
            else
            {
                ordered = { primary, imageModel, provider.model };
            }

            std::vector<std::wstring> models;
            for (auto const& model : ordered)
            {
                auto candidate = Trim(model);
                if (!candidate.empty() &&
                    std::find(models.begin(), models.end(), candidate) == models.end())
                {
                    models.push_back(candidate);
                }
            }

            return models;
        }

        void EnsureCapabilityCanCall(
            ProviderConfig const& provider,
            std::wstring const& apiKey,
            std::wstring const& model)
        {
            EnsureProviderCanCall(provider, apiKey, model);
            if (provider.kind == ProviderKind::Anthropic)
            {
                throw hresult_invalid_argument(L"This provider protocol does not support that capability.");
            }
        }

        bool ShouldTryResponsesImageFallbackFromStatus(uint32_t status)
        {
            return status == 404 || status == 405 || status == 501 ||
                (status >= 500 && status <= 599);
        }

        bool ShouldTryNextResponsesImageModel(uint32_t status)
        {
            return status == 400 || status == 422;
        }

        IAsyncAction ReadSseWithTimeoutAsync(
            IHttpContent content,
            TokenHandler onToken,
            bool& emittedToken)
        {
            EnsureProviderContentLengthWithinLimit(
                content,
                WindowsAiStreamResponseMaxBytes,
                L"AI provider stream response");
            auto stream = co_await ReadStreamWithTimeoutAsync(
                content,
                WindowsAiStreamIdleTimeout,
                L"AI streaming response timed out.");
            DataReader reader(stream);
            reader.InputStreamOptions(InputStreamOptions::Partial);

            std::string pending;
            std::vector<std::wstring> eventData;
            uint64_t totalBytes = 0;
            auto closeReader = [&reader]() noexcept
            {
                CloseProviderDataReader(reader);
            };

            try
            {
                while (true)
                {
                    auto loaded = co_await LoadChunkWithTimeoutAsync(
                        reader,
                        4096,
                        WindowsAiStreamIdleTimeout,
                        L"AI streaming response timed out.");
                    if (loaded == 0)
                    {
                        break;
                    }

                    totalBytes = AccumulateProviderResponseBytes(
                        totalBytes,
                        loaded,
                        WindowsAiStreamResponseMaxBytes,
                        L"AI provider stream response");

                    std::vector<uint8_t> bytes(loaded);
                    reader.ReadBytes(winrt::array_view<uint8_t>(
                        bytes.data(),
                        bytes.data() + bytes.size()));
                    pending.append(reinterpret_cast<char const*>(bytes.data()), bytes.size());

                    size_t newline = 0;
                    while ((newline = pending.find('\n')) != std::string::npos)
                    {
                        auto rawLine = pending.substr(0, newline);
                        pending.erase(0, newline + 1);
                        if (!rawLine.empty() && rawLine.back() == '\r')
                        {
                            rawLine.pop_back();
                        }

                        if (!ProcessSseLine(
                            std::wstring(to_hstring(rawLine).c_str()),
                            eventData,
                            onToken,
                            emittedToken))
                        {
                            closeReader();
                            co_return;
                        }
                    }
                }

                if (!pending.empty() &&
                    !ProcessSseLine(
                        std::wstring(to_hstring(pending).c_str()),
                        eventData,
                        onToken,
                        emittedToken))
                {
                    closeReader();
                    co_return;
                }

                if (!eventData.empty())
                {
                    ProcessSseEvent(eventData, onToken, emittedToken);
                }

                closeReader();
            }
            catch (...)
            {
                closeReader();
                throw;
            }
        }

        struct ResponsesWebSocketState
        {
            winrt::handle signal{ winrt::check_pointer(CreateEventW(nullptr, FALSE, FALSE, nullptr)) };
            std::mutex mutex;
            std::deque<std::wstring> messages;
            std::exception_ptr failure;
            bool closed{ false };
        };

        winrt::Windows::Foundation::IAsyncAction SendWebSocketTextAsync(
            winrt::Windows::Networking::Sockets::MessageWebSocket const& socket,
            std::wstring const& value)
        {
            winrt::Windows::Storage::Streams::DataWriter writer(socket.OutputStream());
            writer.UnicodeEncoding(winrt::Windows::Storage::Streams::UnicodeEncoding::Utf8);
            writer.WriteString(value);
            co_await writer.StoreAsync();
            writer.DetachStream();
        }

        std::wstring ResponseWebSocketEndpoint(ProviderConfig const& provider)
        {
            auto endpoint = ProviderEndpoint(provider, L"/responses").AbsoluteUri().c_str();
            std::wstring value(endpoint);
            if (ProviderUsesProxy(provider))
            {
                if (value.ends_with(L"/proxy"))
                {
                    value.resize(value.size() - 6);
                }
                value += L"/proxy/ws";
            }
            else if (value.starts_with(L"https://"))
            {
                value.replace(0, 8, L"wss://");
            }
            return value;
        }

        winrt::hstring ResponsesWebSocketCreateMessage(
            ProviderConfig const& provider,
            std::wstring const& model,
            std::vector<ChatMessage> const& messages,
            int contextMessageLimit)
        {
            auto body = winrt::Windows::Data::Json::JsonObject::Parse(
                BuildRequestBody(provider, model, messages, contextMessageLimit, true));
            body.Remove(L"stream");
            body.Insert(L"type", winrt::Windows::Data::Json::JsonValue::CreateStringValue(L"response.create"));
            return body.Stringify();
        }

        winrt::hstring ResponsesWebSocketAuthorizationMessage(
            ProviderConfig const& provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken)
        {
            winrt::Windows::Data::Json::JsonObject body;
            body.Insert(L"type", winrt::Windows::Data::Json::JsonValue::CreateStringValue(L"zerochat.proxy.authorize"));
            body.Insert(L"accessKey", winrt::Windows::Data::Json::JsonValue::CreateStringValue(proxyToken));
            body.Insert(L"providerKind", winrt::Windows::Data::Json::JsonValue::CreateStringValue(L"openai-responses"));
            body.Insert(L"baseUrl", winrt::Windows::Data::Json::JsonValue::CreateStringValue(provider.baseUrl));
            if (ProviderNeedsClientKey(provider))
            {
                body.Insert(L"apiKey", winrt::Windows::Data::Json::JsonValue::CreateStringValue(apiKey));
            }
            return body.Stringify();
        }

        winrt::Windows::Foundation::IAsyncOperation<bool> TryStreamResponsesWebSocketAsync(
            ProviderConfig provider,
            std::wstring apiKey,
            std::wstring proxyToken,
            std::wstring model,
            std::vector<ChatMessage> messages,
            int contextMessageLimit,
            TokenHandler onToken)
        {
            if (provider.kind != ProviderKind::OpenAIResponses)
            {
                co_return false;
            }

            bool emittedToken = false;
            auto state = std::make_shared<ResponsesWebSocketState>();
            winrt::Windows::Networking::Sockets::MessageWebSocket socket;
            socket.Control().MessageType(
                winrt::Windows::Networking::Sockets::SocketMessageType::Utf8);
            socket.SetRequestHeader(L"OpenAI-Beta", L"responses_websockets=2026-02-06");
            const bool proxy = ProviderUsesProxy(provider);
            if (!proxy && ProviderNeedsClientKey(provider))
            {
                socket.SetRequestHeader(L"Authorization", L"Bearer " + apiKey);
            }

            auto messageToken = socket.MessageReceived([state](auto const&, auto const& args)
            {
                try
                {
                    auto reader = args.GetDataReader();
                    reader.UnicodeEncoding(
                        winrt::Windows::Storage::Streams::UnicodeEncoding::Utf8);
                    auto text = reader.ReadString(reader.UnconsumedBufferLength());
                    {
                        std::lock_guard lock(state->mutex);
                        state->messages.push_back(text.c_str());
                    }
                    SetEvent(state->signal.get());
                }
                catch (...)
                {
                    std::lock_guard lock(state->mutex);
                    state->failure = std::current_exception();
                    SetEvent(state->signal.get());
                }
            });
            auto closedToken = socket.Closed([state](auto const&, auto const&)
            {
                {
                    std::lock_guard lock(state->mutex);
                    state->closed = true;
                }
                SetEvent(state->signal.get());
            });

            try
            {
                co_await socket.ConnectAsync(
                    winrt::Windows::Foundation::Uri{ ResponseWebSocketEndpoint(provider) });

                if (proxy)
                {
                    co_await SendWebSocketTextAsync(
                        socket,
                        ResponsesWebSocketAuthorizationMessage(provider, apiKey, proxyToken).c_str());
                }

                bool requestSent = false;
                bool ready = !proxy;
                if (ready)
                {
                    co_await SendWebSocketTextAsync(
                        socket,
                        ResponsesWebSocketCreateMessage(
                            provider,
                            model,
                            messages,
                            contextMessageLimit).c_str());
                    requestSent = true;
                }
                std::wstring received;
                while (true)
                {
                    co_await winrt::resume_on_signal(state->signal.get());
                    std::wstring message;
                    std::exception_ptr failure;
                    bool closed = false;
                    {
                        std::lock_guard lock(state->mutex);
                        if (!state->messages.empty())
                        {
                            message = std::move(state->messages.front());
                            state->messages.pop_front();
                        }
                        failure = state->failure;
                        closed = state->closed;
                    }

                    if (failure)
                    {
                        std::rethrow_exception(failure);
                    }
                    if (message.empty())
                    {
                        if (!ready || closed)
                        {
                            co_return !emittedToken;
                        }
                        continue;
                    }

                    auto event = winrt::Windows::Data::Json::JsonObject::Parse(message);
                    auto type = event.GetNamedString(L"type", L"");
                    if (!ready)
                    {
                        if (type == L"zerochat.proxy.ready")
                        {
                            ready = true;
                            co_await SendWebSocketTextAsync(
                                socket,
                                ResponsesWebSocketCreateMessage(
                                    provider,
                                    model,
                                    messages,
                                    contextMessageLimit).c_str());
                            requestSent = true;
                        }
                        else
                        {
                            co_return !emittedToken;
                        }
                        continue;
                    }

                    if (!requestSent)
                    {
                        co_await SendWebSocketTextAsync(
                            socket,
                            ResponsesWebSocketCreateMessage(
                                provider,
                                model,
                                messages,
                                contextMessageLimit).c_str());
                        requestSent = true;
                        continue;
                    }

                    if (type == L"response.output_text.delta")
                    {
                        auto delta = event.GetNamedString(L"delta", L"");
                        if (!delta.empty())
                        {
                            emittedToken = true;
                            received += delta.c_str();
                            onToken(delta.c_str());
                        }
                    }
                    else if (type == L"response.completed")
                    {
                        if (!emittedToken)
                        {
                            co_return false;
                        }
                        co_return true;
                    }
                    else if (type == L"response.failed" || type == L"response.incomplete" || type == L"error")
                    {
                        if (!emittedToken)
                        {
                            co_return false;
                        }
                        throw hresult_error(E_FAIL, L"Responses WebSocket stream failed.");
                    }
                }
            }
            catch (...)
            {
                if (!emittedToken)
                {
                    co_return false;
                }
                throw;
            }
            socket.MessageReceived(messageToken);
            socket.Closed(closedToken);
        }

        IAsyncOperation<hstring> SendAndReadImageRequestAsync(
            HttpClient client,
            std::function<HttpRequestMessage()> makeRequest,
            std::chrono::seconds requestTimeout,
            std::chrono::seconds readTimeout,
            hstring requestTimeoutMessage,
            hstring readTimeoutMessage,
            uint32_t& failureStatus)
        {
            failureStatus = 0;
            auto request = makeRequest();
            auto response = co_await SendRequestWithTimeoutAsync(
                client,
                request,
                requestTimeout,
                requestTimeoutMessage);
            auto success = response.IsSuccessStatusCode();
            if (!success)
            {
                failureStatus = static_cast<uint32_t>(response.StatusCode());
            }
            auto text = co_await ReadTextBoundedWithTimeoutAsync(
                response.Content(),
                readTimeout,
                readTimeoutMessage,
                success
                    ? WindowsAiImageResponseMaxBytes
                    : WindowsAiErrorResponseMaxBytes,
                success
                    ? L"AI image response"
                    : L"AI provider error response");

            if (!success)
            {
                throw hresult_error(
                    E_FAIL,
                    hstring{ FailureTextWithHttpStatus(response.StatusCode(), text) });
            }

            co_return text;
        }

        IAsyncOperation<hstring> SendAndReadCapabilityAsync(
            HttpClient client,
            HttpRequestMessage request,
            hstring requestTimeoutMessage,
            hstring readTimeoutMessage)
        {
            auto response = co_await SendRequestWithTimeoutAsync(
                client,
                request,
                WindowsAiCapabilityRequestTimeout,
                requestTimeoutMessage);
            auto success = response.IsSuccessStatusCode();
            auto text = co_await ReadTextBoundedWithTimeoutAsync(
                response.Content(),
                WindowsAiCapabilityRequestTimeout,
                readTimeoutMessage,
                success
                    ? WindowsAiTextResponseMaxBytes
                    : WindowsAiErrorResponseMaxBytes,
                success
                    ? L"AI capability response"
                    : L"AI provider error response");

            if (!success)
            {
                throw hresult_error(
                    E_FAIL,
                    hstring{ FailureTextWithHttpStatus(response.StatusCode(), text) });
            }

            co_return text;
        }
    }

    IAsyncAction AiClient::StreamChatAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::vector<ChatMessage> messages,
        int contextMessageLimit,
        TokenHandler onToken)
    {
        EnsureProviderCanCall(provider, apiKey, model);
        auto client = CreateCredentialBoundHttpClient();
        auto makeRequest = [provider, apiKey, proxyToken, model, messages, contextMessageLimit]()
        {
            HttpRequestMessage request;
            auto target = !ProviderUsesProxy(provider)
                ? ProviderEndpoint(
                    provider,
                provider.kind == ProviderKind::Anthropic
                        ? L"/messages"
                    : provider.kind == ProviderKind::OpenAIResponses
                        ? L"/responses"
                        : L"/chat/completions")
                : ProviderEndpoint(provider, L"/proxy");

            request.Method(HttpMethod::Post());
            request.RequestUri(target);
            ApplyAuthHeaders(request, provider, apiKey);
            ApplyProxyHeaders(request, provider, proxyToken, L"chat");
            request.Headers().Accept().Append(HttpMediaTypeWithQualityHeaderValue(L"text/event-stream"));
            request.Content(HttpStringContent(
                BuildRequestBody(provider, model, messages, contextMessageLimit, true),
                winrt::Windows::Storage::Streams::UnicodeEncoding::Utf8,
                L"application/json"));
            return request;
        };

        uint32_t retryIndex = 0;

        while (true)
        {
            bool emittedToken = false;
            uint32_t failureStatus = 0;

            try
            {
                auto request = makeRequest();
                auto response = co_await SendRequestWithTimeoutAsync(
                    client,
                    request,
                    WindowsAiChatRequestTimeout,
                    L"AI request timed out.",
                    HttpCompletionOption::ResponseHeadersRead);

                if (!response.IsSuccessStatusCode())
                {
                    failureStatus = static_cast<uint32_t>(response.StatusCode());
                    auto text = co_await ReadTextBoundedWithTimeoutAsync(
                        response.Content(),
                        WindowsAiStreamIdleTimeout,
                        L"AI streaming response timed out.",
                        WindowsAiErrorResponseMaxBytes,
                        L"AI provider error response");
                    throw hresult_error(
                        E_FAIL,
                        hstring{ FailureTextWithStatus(response.StatusCode(), text) });
                }

                co_await ReadSseWithTimeoutAsync(response.Content(), onToken, emittedToken);
                if (!emittedToken)
                {
                    throw hresult_error(
                        ProviderEmptyResponseHresult,
                        L"The provider returned an empty response.");
                }
                co_return;
            }
            catch (hresult_error const& error)
            {
                if (emittedToken ||
                    retryIndex >= WindowsAiGenerationAutoRetries ||
                    !IsRetryableGenerationError(error, failureStatus))
                {
                    throw;
                }
            }

            co_await resume_after(GenerationAutoRetryDelay(retryIndex));
            ++retryIndex;
        }

        co_return;
    }

    IAsyncAction AiClient::ListModelsAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        ModelsHandler onModels)
    {
        if (ProviderNeedsClientKey(provider) && apiKey.empty())
        {
            throw hresult_invalid_argument(L"API Key is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Get());
        request.RequestUri(ProviderEndpoint(provider, L"/models"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"models");

        auto response = co_await SendRequestWithTimeoutAsync(
            client,
            request,
            WindowsAiModelListTimeout,
            L"Model list request timed out.");
        auto success = response.IsSuccessStatusCode();
        auto text = co_await ReadTextBoundedWithTimeoutAsync(
            response.Content(),
            WindowsAiModelListTimeout,
            L"Model list read timed out.",
            success
                ? WindowsAiTextResponseMaxBytes
                : WindowsAiErrorResponseMaxBytes,
            success
                ? L"AI model list response"
                : L"AI provider error response");

        if (!success)
        {
            throw hresult_error(
                E_FAIL,
                hstring{ FailureTextWithStatus(response.StatusCode(), text) });
        }

        if (onModels)
        {
            onModels(ParseModels(std::wstring(text.c_str())));
        }
        co_return;
    }

    IAsyncAction AiClient::GenerateImageAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::wstring const& prompt,
        ImageHandler onImage,
        std::wstring const& size,
        std::wstring const& responsesModel)
    {
        EnsureProviderCanCall(provider, apiKey, model);
        if (provider.kind == ProviderKind::Anthropic)
        {
            throw hresult_invalid_argument(L"This provider protocol does not support image generation.");
        }
        if (prompt.empty())
        {
            throw hresult_invalid_argument(L"Prompt is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        auto makeRequest = [provider, apiKey, proxyToken, model, prompt, size]()
        {
            HttpRequestMessage request;
            request.Method(HttpMethod::Post());
            request.RequestUri(ProviderEndpoint(provider, L"/images/generations"));
            ApplyAuthHeaders(request, provider, apiKey);
            ApplyProxyHeaders(request, provider, proxyToken, L"image-generations");
            request.Content(HttpStringContent(
                BuildImageGenerationBody(model, prompt, size),
                UnicodeEncoding::Utf8,
                L"application/json"));
            return request;
        };

        uint32_t failureStatus = 0;
        try
        {
            auto text = co_await SendAndReadImageRequestAsync(
                client,
                makeRequest,
                WindowsAiImageRequestTimeout,
                WindowsAiImageRequestTimeout,
                L"Image generation request timed out.",
                L"Image generation response read timed out.",
                failureStatus);

            if (onImage)
            {
                auto generatedImage = ParseGeneratedImage(std::wstring(text.c_str()));
                co_await MaterializeGeneratedImageAsync(client, generatedImage);
                onImage(generatedImage);
            }
            co_return;
        }
        catch (hresult_error const&)
        {
            if (!ShouldTryResponsesImageFallbackFromStatus(failureStatus))
            {
                throw;
            }
        }

        auto responseModels = ResponsesImageModels(provider, responsesModel, model);
        if (responseModels.empty())
        {
            throw hresult_invalid_argument(L"Model is required.");
        }

        HRESULT lastErrorCode = E_FAIL;
        hstring lastErrorMessage = L"Model is required.";
        for (auto const& responseModel : responseModels)
        {
            failureStatus = 0;
            auto makeResponsesRequest = [provider, apiKey, proxyToken, prompt, size, responseModel]()
            {
                HttpRequestMessage request;
                request.Method(HttpMethod::Post());
                request.RequestUri(ProviderEndpoint(provider, L"/responses"));
                ApplyAuthHeaders(request, provider, apiKey);
                ApplyProxyHeaders(request, provider, proxyToken, L"image-responses");
                request.Content(HttpStringContent(
                    BuildResponsesImageGenerationBody(responseModel, prompt, size),
                    UnicodeEncoding::Utf8,
                    L"application/json"));
                return request;
            };

            try
            {
                auto text = co_await SendAndReadImageRequestAsync(
                    client,
                    makeResponsesRequest,
                    WindowsAiImageRequestTimeout,
                    WindowsAiImageRequestTimeout,
                    L"Responses image generation request timed out.",
                    L"Responses image generation response read timed out.",
                    failureStatus);

                if (onImage)
                {
                    auto generatedImage = ParseGeneratedImage(std::wstring(text.c_str()));
                    co_await MaterializeGeneratedImageAsync(client, generatedImage);
                    onImage(generatedImage);
                }
                co_return;
            }
            catch (hresult_error const& error)
            {
                lastErrorCode = error.code();
                lastErrorMessage = error.message();
                if (!ShouldTryNextResponsesImageModel(failureStatus))
                {
                    throw;
                }
            }
        }

        throw hresult_error(lastErrorCode, lastErrorMessage);
    }

    IAsyncAction AiClient::EditImageAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::wstring const& prompt,
        ImageUpload image,
        ImageHandler onImage,
        std::optional<ImageUpload> mask,
        std::wstring const& size,
        std::wstring const& responsesModel)
    {
        EnsureProviderCanCall(provider, apiKey, model);
        if (provider.kind == ProviderKind::Anthropic)
        {
            throw hresult_invalid_argument(L"This provider protocol does not support image editing.");
        }
        if (IsLikelyImageModel(model) && !IsLikelyImageEditingModel(model))
        {
            throw hresult_invalid_argument(L"This image model does not support editing.");
        }
        if (prompt.empty())
        {
            throw hresult_invalid_argument(L"Prompt is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        auto makeRequest = [provider, apiKey, proxyToken, model, prompt, image, mask, size]()
        {
            auto imageUpload = NormalizeImageUpload(image, L"image.png");
            HttpMultipartFormDataContent form;
            form.Add(HttpStringContent(model), L"model");
            form.Add(HttpStringContent(prompt), L"prompt");
            form.Add(HttpStringContent(L"1"), L"n");
            form.Add(HttpStringContent(size), L"size");
            form.Add(HttpStringContent(L"b64_json"), L"response_format");
            form.Add(UploadContent(imageUpload), L"image", imageUpload.fileName);
            if (mask)
            {
                auto maskUpload = NormalizeImageUpload(*mask, L"mask.png");
                form.Add(UploadContent(maskUpload), L"mask", maskUpload.fileName);
            }

            HttpRequestMessage request;
            request.Method(HttpMethod::Post());
            request.RequestUri(ProviderEndpoint(provider, L"/images/edits"));
            ApplyAuthHeaders(request, provider, apiKey);
            ApplyProxyHeaders(request, provider, proxyToken, L"image-edits");
            request.Content(form);
            return request;
        };

        uint32_t failureStatus = 0;
        try
        {
            auto text = co_await SendAndReadImageRequestAsync(
                client,
                makeRequest,
                WindowsAiImageRequestTimeout,
                WindowsAiImageRequestTimeout,
                L"Image edit request timed out.",
                L"Image edit response read timed out.",
                failureStatus);

            if (onImage)
            {
                auto generatedImage = ParseGeneratedImage(std::wstring(text.c_str()));
                co_await MaterializeGeneratedImageAsync(client, generatedImage);
                onImage(generatedImage);
            }
            co_return;
        }
        catch (hresult_error const&)
        {
            if (mask || !ShouldTryResponsesImageFallbackFromStatus(failureStatus))
            {
                throw;
            }
        }

        auto responseModels = ResponsesImageModels(provider, responsesModel, model);
        if (responseModels.empty())
        {
            throw hresult_invalid_argument(L"Model is required.");
        }

        HRESULT lastErrorCode = E_FAIL;
        hstring lastErrorMessage = L"Model is required.";
        for (auto const& responseModel : responseModels)
        {
            failureStatus = 0;
            auto makeResponsesRequest = [provider, apiKey, proxyToken, prompt, image, size, responseModel]()
            {
                HttpRequestMessage request;
                request.Method(HttpMethod::Post());
                request.RequestUri(ProviderEndpoint(provider, L"/responses"));
                ApplyAuthHeaders(request, provider, apiKey);
                ApplyProxyHeaders(request, provider, proxyToken, L"image-responses");
                request.Content(HttpStringContent(
                    BuildResponsesImageEditBody(responseModel, prompt, image, size),
                    UnicodeEncoding::Utf8,
                    L"application/json"));
                return request;
            };

            try
            {
                auto text = co_await SendAndReadImageRequestAsync(
                    client,
                    makeResponsesRequest,
                    WindowsAiImageRequestTimeout,
                    WindowsAiImageRequestTimeout,
                    L"Responses image edit request timed out.",
                    L"Responses image edit response read timed out.",
                    failureStatus);

                if (onImage)
                {
                    auto generatedImage = ParseGeneratedImage(std::wstring(text.c_str()));
                    co_await MaterializeGeneratedImageAsync(client, generatedImage);
                    onImage(generatedImage);
                }
                co_return;
            }
            catch (hresult_error const& error)
            {
                lastErrorCode = error.code();
                lastErrorMessage = error.message();
                if (!ShouldTryNextResponsesImageModel(failureStatus))
                {
                    throw;
                }
            }
        }

        throw hresult_error(lastErrorCode, lastErrorMessage);
    }

    IAsyncAction AiClient::CreateSpeechAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::wstring const& input,
        BinaryHandler onAudio,
        std::wstring const& voice,
        std::wstring const& responseFormat,
        std::optional<double> speed)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);
        auto textInput = Trim(input);
        if (textInput.empty())
        {
            throw hresult_invalid_argument(L"Audio speech input is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/audio/speech"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"audio-speech");
        request.Content(HttpStringContent(
            BuildAudioSpeechBody(model, textInput, voice, responseFormat, speed),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto response = co_await SendRequestWithTimeoutAsync(
            client,
            request,
            WindowsAiCapabilityRequestTimeout,
            L"Audio speech request timed out.");
        auto success = response.IsSuccessStatusCode();
        auto contentTypeHeader = response.Content().Headers().ContentType();
        auto contentType = contentTypeHeader ? contentTypeHeader.MediaType() : hstring{};
        auto buffer = co_await ReadBufferBoundedWithTimeoutAsync(
            response.Content(),
            WindowsAiCapabilityRequestTimeout,
            L"Audio speech response read timed out.",
            success
                ? WindowsAiAudioResponseMaxBytes
                : WindowsAiErrorResponseMaxBytes,
            success
                ? L"AI audio speech response"
                : L"AI provider error response");
        auto bytes = BytesFromBuffer(buffer);

        if (!success)
        {
            std::string raw(bytes.begin(), bytes.end());
            throw hresult_error(
                E_FAIL,
                hstring{ FailureTextWithHttpStatus(response.StatusCode(), to_hstring(raw)) });
        }

        if (!ProviderAudioResponseLooksValid(bytes, contentType))
        {
            throw hresult_error(E_INVALIDARG, L"AI audio speech response was not valid audio.");
        }

        if (onAudio)
        {
            onAudio(bytes);
        }
        co_return;
    }

    IAsyncAction AiClient::TranscribeAudioAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        AudioUpload audio,
        TextHandler onText,
        std::wstring const& prompt,
        std::wstring const& language,
        std::wstring const& responseFormat,
        std::optional<double> temperature)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);
        if (audio.bytes.empty())
        {
            throw hresult_invalid_argument(L"Audio transcription file is required.");
        }

        auto boundary = L"ZeroChatAudioTranscription";
        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/audio/transcriptions"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"audio-transcriptions");
        request.Content(MultipartContent(
            BuildAudioTranscriptionBody(
                boundary,
                model,
                audio,
                prompt,
                language,
                responseFormat,
                temperature),
            boundary));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Audio transcription request timed out.",
            L"Audio transcription response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }

    IAsyncAction AiClient::CreateEmbeddingAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::wstring const& input,
        TextHandler onText)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);
        auto textInput = Trim(input);
        if (textInput.empty())
        {
            throw hresult_invalid_argument(L"Embedding input is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/embeddings"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"embeddings");
        request.Content(HttpStringContent(
            BuildEmbeddingsBody(model, textInput),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Embeddings request timed out.",
            L"Embeddings response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }

    IAsyncAction AiClient::CreateEmbeddingsAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::vector<std::wstring> input,
        TextHandler onText)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);
        std::vector<std::wstring> normalizedInput;
        for (auto const& item : input)
        {
            auto value = Trim(item);
            if (!value.empty())
            {
                normalizedInput.push_back(value);
            }
        }
        if (normalizedInput.empty())
        {
            throw hresult_invalid_argument(L"Embedding input is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/embeddings"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"embeddings");
        request.Content(HttpStringContent(
            BuildEmbeddingsBody(model, normalizedInput),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Embeddings request timed out.",
            L"Embeddings response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }

    IAsyncAction AiClient::ModerateTextAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::wstring const& input,
        TextHandler onText)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);
        auto textInput = Trim(input);
        if (textInput.empty())
        {
            throw hresult_invalid_argument(L"Moderation input is required.");
        }

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/moderations"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"moderations");
        request.Content(HttpStringContent(
            BuildModerationsBody(model, textInput),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Moderation request timed out.",
            L"Moderation response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }

    IAsyncAction AiClient::CreateRealtimeSessionAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::vector<std::wstring> modalities,
        TextHandler onText,
        std::wstring const& instructions,
        std::wstring const& voice,
        std::wstring const& inputAudioFormat,
        std::wstring const& outputAudioFormat)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/realtime"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"realtime");
        request.Content(HttpStringContent(
            BuildRealtimeBody(model, modalities, instructions, voice, inputAudioFormat, outputAudioFormat),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Realtime request timed out.",
            L"Realtime response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }

    IAsyncAction AiClient::CreateRealtimeClientSecretAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::vector<std::wstring> modalities,
        TextHandler onText,
        std::wstring const& instructions,
        std::wstring const& voice,
        std::wstring const& inputAudioFormat,
        std::wstring const& outputAudioFormat)
    {
        EnsureCapabilityCanCall(provider, apiKey, model);

        auto client = CreateCredentialBoundHttpClient();
        HttpRequestMessage request;
        request.Method(HttpMethod::Post());
        request.RequestUri(ProviderEndpoint(provider, L"/realtime/client_secrets"));
        ApplyAuthHeaders(request, provider, apiKey);
        ApplyProxyHeaders(request, provider, proxyToken, L"realtime-client-secrets");
        request.Content(HttpStringContent(
            BuildRealtimeClientSecretsBody(
                model,
                modalities,
                instructions,
                voice,
                inputAudioFormat,
                outputAudioFormat),
            UnicodeEncoding::Utf8,
            L"application/json"));

        auto text = co_await SendAndReadCapabilityAsync(
            client,
            request,
            L"Realtime client secret request timed out.",
            L"Realtime client secret response read timed out.");

        if (onText)
        {
            onText(std::wstring(text.c_str()));
        }
        co_return;
    }
}
