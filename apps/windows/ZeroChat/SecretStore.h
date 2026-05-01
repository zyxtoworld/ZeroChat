#pragma once

#include <string>

namespace ZeroChat
{
    class SecretStore
    {
    public:
        void SetProviderKey(std::wstring const& providerId, std::wstring const& apiKey);
        std::wstring GetProviderKey(std::wstring const& providerId);
        void SetSyncToken(std::wstring const& token);
        std::wstring GetSyncToken();
        void ClearAll();
    };
}
