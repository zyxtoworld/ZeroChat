#pragma once

#include <optional>
#include <string>
#include <vector>

namespace ZeroChat
{
    enum class SecretClearScope
    {
        None,
        Provider,
        All,
    };

    enum class SecretMigrationState
    {
        Pending,
        LockerWritten,
        Complete,
    };

    struct SecretEntry
    {
        std::wstring name;
        std::wstring value;
    };

    struct SecretMutation
    {
        std::wstring name;
        std::optional<std::wstring> value;
    };

    struct SecretStoreResult
    {
        std::optional<std::wstring> revision;
        SecretMigrationState migrationState{ SecretMigrationState::Pending };
        std::vector<SecretEntry> entries;
    };

    class SecretStoreConflict final
    {
    };

    class SecretStore
    {
    public:
        SecretStoreResult Probe();
        SecretStoreResult Read(std::vector<std::wstring> const& names);
        SecretStoreResult Mutate(
            std::vector<SecretMutation> const& changes,
            std::optional<std::wstring> const& expectedRevision,
            SecretClearScope clearScope,
            std::optional<SecretMigrationState> migrationState);
    };
}
