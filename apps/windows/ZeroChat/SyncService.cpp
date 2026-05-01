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
    IAsyncOperation<AppSnapshot> SyncService::SyncCloudflareAsync(
        AppSnapshot snapshot,
        std::wstring const& syncToken)
    {
        HttpClient client;
        client.DefaultRequestHeaders().Authorization(
            HttpCredentialsHeaderValue(L"Bearer", syncToken));

        auto endpoint = snapshot.sync.workerEndpoint;
        if (!endpoint.ends_with(L"/snapshot"))
        {
            endpoint += L"/snapshot";
        }

        auto response = co_await client.GetAsync(Uri(endpoint));

        if (response.IsSuccessStatusCode())
        {
            auto remoteJson = co_await response.Content().ReadAsStringAsync();
            (void)remoteJson;
            // TODO: Parse remote snapshot and compare updatedAt.
        }

        // TODO: Serialize snapshot and PUT when local data is newer.
        co_return snapshot;
    }
}
