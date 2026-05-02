#pragma once

#include "Models.h"
#include <functional>
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    using TokenHandler = std::function<void(std::wstring const&)>;

    class AiClient
    {
    public:
        winrt::Windows::Foundation::IAsyncAction StreamChatAsync(
            ProviderConfig provider,
            std::wstring const& apiKey,
            std::wstring const& proxyToken,
            std::wstring const& model,
            std::vector<ChatMessage> messages,
            TokenHandler onToken);
    };
}
