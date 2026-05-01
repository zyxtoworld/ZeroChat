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
    IAsyncAction AiClient::StreamChatAsync(
        ProviderConfig provider,
        std::wstring const& apiKey,
        std::wstring const& model,
        std::vector<ChatMessage> messages,
        TokenHandler onToken)
    {
        (void)model;
        (void)messages;

        HttpClient client;
        HttpRequestMessage request;
        auto target = provider.proxyUrl.empty() ? provider.baseUrl : provider.proxyUrl + L"/proxy";

        request.Method(HttpMethod::Post());
        request.RequestUri(Uri(target));

        if (!apiKey.empty())
        {
            request.Headers().Authorization(HttpCredentialsHeaderValue(L"Bearer", apiKey));
        }

        if (!provider.proxyUrl.empty())
        {
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
