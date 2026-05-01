#pragma once

#include "Models.h"
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    class StorageService
    {
    public:
        winrt::Windows::Foundation::IAsyncOperation<AppSnapshot> LoadAsync();
        winrt::Windows::Foundation::IAsyncAction SaveAsync(AppSnapshot const& snapshot);
        winrt::Windows::Foundation::IAsyncAction ClearAsync();

    private:
        std::wstring SnapshotFileName() const { return L"snapshot.json"; }
    };
}
