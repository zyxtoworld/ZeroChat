#include "pch.h"
#include "SecretStore.h"

#include <winrt/Windows.Security.Credentials.h>

using namespace winrt;
using namespace Windows::Security::Credentials;

namespace ZeroChat
{
    namespace
    {
        constexpr wchar_t ResourceName[] = L"ZeroChat";

        std::wstring ProviderUserName(std::wstring const& providerId)
        {
            return L"provider:" + providerId;
        }
    }

    void SecretStore::SetProviderKey(std::wstring const& providerId, std::wstring const& apiKey)
    {
        PasswordVault vault;
        vault.Add(PasswordCredential(ResourceName, ProviderUserName(providerId), apiKey));
    }

    std::wstring SecretStore::GetProviderKey(std::wstring const& providerId)
    {
        PasswordVault vault;
        auto credential = vault.Retrieve(ResourceName, ProviderUserName(providerId));
        credential.RetrievePassword();
        return credential.Password().c_str();
    }

    void SecretStore::SetSyncToken(std::wstring const& token)
    {
        PasswordVault vault;
        vault.Add(PasswordCredential(ResourceName, L"sync-token", token));
    }

    std::wstring SecretStore::GetSyncToken()
    {
        PasswordVault vault;
        auto credential = vault.Retrieve(ResourceName, L"sync-token");
        credential.RetrievePassword();
        return credential.Password().c_str();
    }

    void SecretStore::ClearAll()
    {
        PasswordVault vault;
        for (auto const& credential : vault.RetrieveAll())
        {
            if (credential.Resource() == ResourceName)
            {
                vault.Remove(credential);
            }
        }
    }
}
