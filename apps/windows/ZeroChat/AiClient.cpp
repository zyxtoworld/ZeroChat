#include "pch.h"
#include "AiClient.h"

#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/Windows.Web.Http.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Web::Http;
using namespace Windows::Web::Http::Headers;

namespace ZeroChat
{
    namespace
    {
        bool IsLoopbackHost(std::wstring const& host)
        {
            return host == L"localhost" || host == L"127.0.0.1" || host == L"::1" || host == L"[::1]";
        }

        Uri SafeBaseUri(std::wstring endpoint)
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
                throw hresult_invalid_argument(L"AI endpoint must use HTTPS unless it is a loopback address.");
            }

            return Uri(endpoint);
        }
    }

    IAsyncAction AiClient::StreamChatAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& proxyToken,
        std::wstring const& model,
        std::vector<ChatMessage> messages,
        TokenHandler onToken)
    {
        (void)model;
        (void)messages;

        HttpClient client;
        HttpRequestMessage request;
        auto target = SafeBaseUri(provider.baseUrl);
        if (!provider.proxyUrl.empty())
        {
            if (proxyToken.empty())
            {
                throw hresult_invalid_argument(L"Proxy token is required.");
            }

            auto proxyBase = std::wstring(SafeBaseUri(provider.proxyUrl).AbsoluteUri());
            target = Uri(proxyBase + L"/proxy");
        }

        request.Method(HttpMethod::Post());
        request.RequestUri(target);

        if (!apiKey.empty())
        {
            request.Headers().Authorization(HttpCredentialsHeaderValue(L"Bearer", apiKey));
        }

        if (!provider.proxyUrl.empty())
        {
            request.Headers().Append(L"x-zerochat-proxy-token", proxyToken);
            request.Headers().Append(L"x-zerochat-base-url", provider.baseUrl);
            request.Headers().Append(
                L"x-zerochat-provider-kind",
                provider.kind == ProviderKind::Anthropic ? L"anthropic" : L"openai-compatible");
        }

        // TODO: Build JSON body from shared/ai-provider-contract.md and stream SSE chunks.
        onToken(L"");
        co_return;
    }
}
