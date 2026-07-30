#pragma once

#include "Models.h"
#include <functional>
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    using SnapshotEnvelopeHandler = std::function<void(EncryptedSnapshotEnvelope const&)>;

    enum class FirstSyncStrategy
    {
        Ask,
        UseLocal,
        UseRemote,
        Merge,
    };

    class SyncService
    {
    public:
        winrt::Windows::Foundation::IAsyncAction SyncCloudflareAsync(
            EncryptedSnapshotEnvelope envelope,
            std::wstring const& workerEndpoint,
            std::wstring const& accessKey,
            SnapshotEnvelopeHandler onSynced,
            FirstSyncStrategy firstSyncStrategy = FirstSyncStrategy::Ask,
            bool hasCompletedSync = false,
            bool hasLocalUserContent = true);

        winrt::Windows::Foundation::IAsyncAction ClearCloudflareAsync(
            std::wstring const& workerEndpoint,
            std::wstring const& accessKey);
    };
}
