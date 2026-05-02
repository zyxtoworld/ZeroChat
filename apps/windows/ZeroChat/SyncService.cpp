#include "pch.h"
#include "SyncService.h"

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

        Uri SnapshotEndpoint(std::wstring endpoint)
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

            return Uri(endpoint + L"/snapshot");
        }
    }

    IAsyncOperation<EncryptedSnapshotEnvelope> SyncService::SyncCloudflareAsync(
        EncryptedSnapshotEnvelope envelope,
        std::wstring const& workerEndpoint,
        std::wstring const& syncToken)
    {
        HttpClient client;
        if (syncToken.empty())
        {
            throw hresult_invalid_argument(L"Sync token is required.");
        }

        client.DefaultRequestHeaders().Authorization(
            HttpCredentialsHeaderValue(L"Bearer", syncToken));

        auto response = co_await client.GetAsync(SnapshotEndpoint(workerEndpoint));

        if (response.IsSuccessStatusCode())
        {
            auto remoteJson = co_await response.Content().ReadAsStringAsync();
            (void)remoteJson;
            // TODO: Parse encrypted envelope and compare updatedAt.
        }

        // TODO: Serialize encrypted envelope and PUT when local data is newer.
        co_return envelope;
    }
}
