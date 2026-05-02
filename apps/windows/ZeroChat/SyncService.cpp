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
    IAsyncOperation<EncryptedSnapshotEnvelope> SyncService::SyncCloudflareAsync(
        EncryptedSnapshotEnvelope envelope,
        std::wstring const& workerEndpoint,
        std::wstring const& syncToken)
    {
        HttpClient client;
        client.DefaultRequestHeaders().Authorization(
            HttpCredentialsHeaderValue(L"Bearer", syncToken));

        auto endpoint = workerEndpoint;
        if (!endpoint.ends_with(L"/snapshot"))
        {
            endpoint += L"/snapshot";
        }

        auto response = co_await client.GetAsync(Uri(endpoint));

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
