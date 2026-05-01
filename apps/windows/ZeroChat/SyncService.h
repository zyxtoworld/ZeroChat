#pragma once

#include "Models.h"
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    class SyncService
    {
    public:
        winrt::Windows::Foundation::IAsyncOperation<AppSnapshot> SyncCloudflareAsync(
            AppSnapshot snapshot,
            std::wstring const& syncToken);
    };
}
