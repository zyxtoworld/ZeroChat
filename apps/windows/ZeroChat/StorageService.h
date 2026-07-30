#pragma once

#include "Models.h"
#include <functional>
#include <winrt/Windows.Foundation.h>

namespace ZeroChat
{
    using SnapshotHandler = std::function<void(AppSnapshot const&)>;

    class StorageService
    {
    public:
        winrt::Windows::Foundation::IAsyncAction LoadAsync(SnapshotHandler onLoaded);
        winrt::Windows::Foundation::IAsyncAction SaveAsync(AppSnapshot const& snapshot);
        winrt::Windows::Foundation::IAsyncAction ClearAsync();

    private:
        std::wstring SnapshotFileName() const { return L"snapshot.v1.json"; }
        std::wstring SnapshotTempFileName() const { return L"snapshot.v1.json.tmp"; }
    };
}
