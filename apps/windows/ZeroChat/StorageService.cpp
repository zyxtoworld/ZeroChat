#include "pch.h"
#include "StorageService.h"

#include <winrt/Windows.Storage.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Storage;

namespace ZeroChat
{
    IAsyncOperation<AppSnapshot> StorageService::LoadAsync()
    {
        auto folder = ApplicationData::Current().LocalFolder();

        try
        {
            auto file = co_await folder.GetFileAsync(SnapshotFileName());
            auto json = co_await FileIO::ReadTextAsync(file);
            (void)json;
            // TODO: Deserialize with the snapshot.schema.json contract.
        }
        catch (...)
        {
            // Missing local data is a normal first-run state.
        }

        AppSnapshot snapshot;
        snapshot.sync.mode = L"local";
        snapshot.sync.gistFile = L"zerochat-sync.json";
        co_return snapshot;
    }

    IAsyncAction StorageService::SaveAsync(AppSnapshot const& snapshot)
    {
        auto folder = ApplicationData::Current().LocalFolder();
        auto file = co_await folder.CreateFileAsync(
            SnapshotFileName(),
            CreationCollisionOption::ReplaceExisting);

        (void)snapshot;
        // TODO: Serialize according to shared/snapshot.schema.json.
        co_await FileIO::WriteTextAsync(file, L"{\"version\":1}");
    }

    IAsyncAction StorageService::ClearAsync()
    {
        auto folder = ApplicationData::Current().LocalFolder();

        try
        {
            auto file = co_await folder.GetFileAsync(SnapshotFileName());
            co_await file.DeleteAsync();
        }
        catch (...)
        {
        }
    }
}
