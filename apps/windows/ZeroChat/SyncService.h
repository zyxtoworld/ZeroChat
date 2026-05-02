#pragma once

#include "Models.h"
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    class SyncService
    {
    public:
        winrt::Windows::Foundation::IAsyncOperation<EncryptedSnapshotEnvelope> SyncCloudflareAsync(
            EncryptedSnapshotEnvelope envelope,
            std::wstring const& workerEndpoint,
            std::wstring const& syncToken);
    };
}
