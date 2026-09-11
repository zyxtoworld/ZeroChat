#include "pch.h"
#include "SecretStore.h"

#include <map>
#include <memory>
#include <mutex>
#include <sddl.h>
#include <winrt/Windows.Security.Credentials.h>

using namespace winrt;
using namespace Windows::Security::Credentials;

namespace ZeroChat
{
    namespace
    {
        constexpr wchar_t ResourceName[] = L"ZeroChat";
        constexpr wchar_t RevisionAccount[] = L"meta:revision";
        constexpr wchar_t MigrationAccount[] = L"meta:migration";
        constexpr wchar_t CommitAccountPrefix[] = L"meta:commit:";
        constexpr wchar_t TransactionAccountPrefix[] = L"txn:";
        constexpr wchar_t CommitValue[] = L"complete-v2";
        constexpr wchar_t SecretStoreMutexPrefix[] = L"Global\\ZeroChat.SecretStore.v2.";

        struct LocalFreeDeleter final
        {
            void operator()(void* value) const noexcept
            {
                if (value)
                {
                    static_cast<void>(LocalFree(value));
                }
            }
        };

        using LocalAllocation = std::unique_ptr<void, LocalFreeDeleter>;

        struct StoredSnapshot
        {
            std::optional<std::wstring> revision;
            std::optional<std::wstring> transaction;
            SecretMigrationState migrationState{ SecretMigrationState::Pending };
            std::map<std::wstring, std::wstring> entries;
        };

        std::mutex& SecretStoreGate()
        {
            static std::mutex gate;
            return gate;
        }

        std::wstring CurrentUserSid()
        {
            HANDLE rawToken{};
            check_bool(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken));
            winrt::handle token{ rawToken };

            DWORD tokenInformationBytes{};
            if (GetTokenInformation(token.get(), TokenUser, nullptr, 0, &tokenInformationBytes))
            {
                throw hresult_error(E_UNEXPECTED);
            }

            auto const sizeError = GetLastError();
            if (sizeError != ERROR_INSUFFICIENT_BUFFER)
            {
                throw hresult_error(HRESULT_FROM_WIN32(sizeError));
            }
            if (tokenInformationBytes < sizeof(TOKEN_USER))
            {
                throw hresult_error(E_UNEXPECTED);
            }

            std::vector<std::byte> tokenInformation(tokenInformationBytes);
            check_bool(GetTokenInformation(
                token.get(),
                TokenUser,
                tokenInformation.data(),
                tokenInformationBytes,
                &tokenInformationBytes));

            auto const tokenUser = reinterpret_cast<TOKEN_USER const*>(tokenInformation.data());
            if (!IsValidSid(tokenUser->User.Sid))
            {
                throw hresult_error(E_UNEXPECTED);
            }

            PWSTR rawSid{};
            check_bool(ConvertSidToStringSidW(tokenUser->User.Sid, &rawSid));
            LocalAllocation sid{ rawSid };
            return std::wstring{ rawSid };
        }

        class CrossProcessSecretStoreLock final
        {
        public:
            CrossProcessSecretStoreLock()
            {
                auto const sid = CurrentUserSid();
                auto const mutexName = std::wstring{ SecretStoreMutexPrefix } + sid;
                auto const securityDescriptorText =
                    std::wstring{ L"D:P(A;;GA;;;" } + sid + L")(A;;GA;;;SY)";

                PSECURITY_DESCRIPTOR rawSecurityDescriptor{};
                check_bool(ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    securityDescriptorText.c_str(),
                    SDDL_REVISION_1,
                    &rawSecurityDescriptor,
                    nullptr));
                LocalAllocation securityDescriptor{ rawSecurityDescriptor };
                SECURITY_ATTRIBUTES securityAttributes{
                    sizeof(SECURITY_ATTRIBUTES),
                    securityDescriptor.get(),
                    FALSE,
                };

                m_mutex = CreateMutexW(&securityAttributes, FALSE, mutexName.c_str());
                if (!m_mutex)
                {
                    throw hresult_error(HRESULT_FROM_WIN32(GetLastError()));
                }

                auto const waitResult = WaitForSingleObject(m_mutex, INFINITE);
                if (waitResult != WAIT_OBJECT_0 && waitResult != WAIT_ABANDONED)
                {
                    auto const lastError = GetLastError();
                    CloseHandle(m_mutex);
                    m_mutex = nullptr;
                    throw hresult_error(
                        lastError == ERROR_SUCCESS
                            ? E_FAIL
                            : HRESULT_FROM_WIN32(lastError));
                }
            }

            ~CrossProcessSecretStoreLock()
            {
                if (m_mutex)
                {
                    ReleaseMutex(m_mutex);
                    CloseHandle(m_mutex);
                }
            }

            CrossProcessSecretStoreLock(CrossProcessSecretStoreLock const&) = delete;
            CrossProcessSecretStoreLock& operator=(CrossProcessSecretStoreLock const&) = delete;

        private:
            HANDLE m_mutex{};
        };

        bool IsCredentialNotFound(hresult_error const& error)
        {
            return error.code() == HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
        }

        std::vector<PasswordCredential> AllCredentials(PasswordVault const& vault)
        {
            std::vector<PasswordCredential> credentials;

            try
            {
                for (auto const& credential : vault.RetrieveAll())
                {
                    credentials.push_back(credential);
                }
            }
            catch (hresult_error const& error)
            {
                if (!IsCredentialNotFound(error))
                {
                    throw;
                }
            }
            return credentials;
        }

        bool StartsWith(std::wstring const& value, std::wstring_view prefix)
        {
            return value.rfind(prefix, 0) == 0;
        }

        bool IsProviderSecretName(std::wstring const& name)
        {
            return StartsWith(name, L"provider:") || StartsWith(name, L"proxy:");
        }

        bool IsUserSecretName(std::wstring const& name)
        {
            return IsProviderSecretName(name) ||
                name == L"github-token" ||
                name == L"sync-passphrase";
        }

        bool MatchesClearScope(std::wstring const& name, SecretClearScope scope)
        {
            if (scope == SecretClearScope::Provider)
            {
                return IsProviderSecretName(name);
            }
            if (scope == SecretClearScope::All)
            {
                return IsUserSecretName(name);
            }
            return false;
        }

        std::vector<PasswordCredential> FindCredentials(
            PasswordVault const& vault,
            std::wstring const& account)
        {
            std::vector<PasswordCredential> matches;

            for (auto const& credential : AllCredentials(vault))
            {
                if (credential.Resource() == ResourceName && credential.UserName() == account)
                {
                    matches.push_back(credential);
                }
            }

            return matches;
        }

        std::wstring ReadPassword(PasswordCredential const& credential)
        {
            credential.RetrievePassword();
            return std::wstring{ credential.Password() };
        }

        std::optional<std::wstring> ReadCredential(
            PasswordVault const& vault,
            std::wstring const& account)
        {
            auto matches = FindCredentials(vault, account);
            if (matches.empty())
            {
                return std::nullopt;
            }

            std::optional<std::wstring> value;
            for (auto const& credential : matches)
            {
                auto current = ReadPassword(credential);
                if (value.has_value() && *value != current)
                {
                    throw hresult_error(E_UNEXPECTED);
                }
                value = std::move(current);
            }
            return value;
        }

        void VerifyCredential(
            PasswordVault const& vault,
            std::wstring const& account,
            std::wstring const& expected)
        {
            auto matches = FindCredentials(vault, account);
            if (matches.size() != 1 || ReadPassword(matches.front()) != expected)
            {
                throw hresult_error(E_FAIL);
            }
        }

        void AddCredentialVerified(
            PasswordVault const& vault,
            std::wstring const& account,
            std::wstring const& value)
        {
            vault.Add(PasswordCredential(ResourceName, account, value));
            VerifyCredential(vault, account, value);
        }

        bool IsHexDigit(wchar_t value)
        {
            return (value >= L'0' && value <= L'9') ||
                (value >= L'a' && value <= L'f') ||
                (value >= L'A' && value <= L'F');
        }

        bool IsRevisionToken(std::wstring const& value)
        {
            if (value.size() != 36)
            {
                return false;
            }

            for (size_t index = 0; index < value.size(); ++index)
            {
                auto separator = index == 8 || index == 13 || index == 18 || index == 23;
                if ((separator && value[index] != L'-') || (!separator && !IsHexDigit(value[index])))
                {
                    return false;
                }
            }
            return true;
        }

        std::wstring CreateRevisionToken()
        {
            GUID value{};
            check_hresult(CoCreateGuid(&value));
            wchar_t buffer[39]{};
            check_bool(StringFromGUID2(value, buffer, static_cast<int>(std::size(buffer))) > 0);
            std::wstring revision{ buffer };

            if (revision.size() >= 2 && revision.front() == L'{' && revision.back() == L'}')
            {
                revision = revision.substr(1, revision.size() - 2);
            }
            if (!IsRevisionToken(revision))
            {
                throw hresult_error(E_UNEXPECTED);
            }
            return revision;
        }

        std::wstring CommitAccount(std::wstring const& transaction)
        {
            return std::wstring{ CommitAccountPrefix } + transaction;
        }

        std::optional<std::wstring> ParseVersionedRevision(
            PasswordVault const& vault,
            std::optional<std::wstring> const& revision)
        {
            if (!revision.has_value())
            {
                return std::nullopt;
            }

            if (!IsRevisionToken(*revision))
            {
                throw hresult_error(E_FAIL);
            }

            auto commit = ReadCredential(vault, CommitAccount(*revision));
            if (!commit.has_value())
            {
                return std::nullopt;
            }
            if (*commit != CommitValue)
            {
                throw hresult_error(E_FAIL);
            }
            return revision;
        }

        std::wstring TransactionPrefix(std::wstring const& transaction)
        {
            return std::wstring{ TransactionAccountPrefix } + transaction + L":";
        }

        std::wstring TransactionValuePrefix(std::wstring const& transaction)
        {
            return TransactionPrefix(transaction) + L"value:";
        }

        std::wstring TransactionValueAccount(
            std::wstring const& transaction,
            std::wstring const& name)
        {
            return TransactionValuePrefix(transaction) + name;
        }

        std::wstring TransactionMigrationAccount(std::wstring const& transaction)
        {
            return TransactionPrefix(transaction) + L"migration";
        }

        SecretMigrationState ParseMigrationState(
            std::optional<std::wstring> const& value)
        {
            if (!value.has_value() || *value == L"pending")
            {
                return SecretMigrationState::Pending;
            }
            if (*value == L"locker-written")
            {
                return SecretMigrationState::LockerWritten;
            }
            if (*value == L"complete")
            {
                return SecretMigrationState::Complete;
            }

            throw hresult_error(E_FAIL);
        }

        std::wstring MigrationStateValue(SecretMigrationState state)
        {
            switch (state)
            {
            case SecretMigrationState::Pending:
                return L"pending";
            case SecretMigrationState::LockerWritten:
                return L"locker-written";
            case SecretMigrationState::Complete:
                return L"complete";
            }

            throw hresult_error(E_FAIL);
        }

        bool IsInternalAccount(std::wstring const& account)
        {
            return account == RevisionAccount ||
                account == MigrationAccount ||
                StartsWith(account, CommitAccountPrefix) ||
                StartsWith(account, TransactionAccountPrefix);
        }

        void InsertSnapshotEntry(
            std::map<std::wstring, std::wstring>& entries,
            std::wstring name,
            std::wstring value)
        {
            if (auto existing = entries.find(name); existing != entries.end())
            {
                if (existing->second != value)
                {
                    throw hresult_error(E_UNEXPECTED);
                }
                return;
            }
            entries.emplace(std::move(name), std::move(value));
        }

        StoredSnapshot LoadCommittedSnapshot(PasswordVault const& vault)
        {
            StoredSnapshot snapshot;
            snapshot.revision = ReadCredential(vault, RevisionAccount);
            snapshot.transaction = ParseVersionedRevision(vault, snapshot.revision);

            if (!snapshot.transaction.has_value())
            {
                snapshot.migrationState = ParseMigrationState(ReadCredential(vault, MigrationAccount));
                for (auto const& credential : AllCredentials(vault))
                {
                    auto account = std::wstring{ credential.UserName() };
                    if (credential.Resource() == ResourceName && !IsInternalAccount(account))
                    {
                        InsertSnapshotEntry(snapshot.entries, std::move(account), ReadPassword(credential));
                    }
                }
                return snapshot;
            }

            auto valuePrefix = TransactionValuePrefix(*snapshot.transaction);
            snapshot.migrationState = ParseMigrationState(
                ReadCredential(vault, TransactionMigrationAccount(*snapshot.transaction)));
            for (auto const& credential : AllCredentials(vault))
            {
                auto account = std::wstring{ credential.UserName() };
                if (credential.Resource() != ResourceName || !StartsWith(account, valuePrefix))
                {
                    continue;
                }

                auto name = account.substr(valuePrefix.size());
                if (name.empty())
                {
                    throw hresult_error(E_FAIL);
                }
                InsertSnapshotEntry(snapshot.entries, std::move(name), ReadPassword(credential));
            }
            return snapshot;
        }

        bool IsActiveTransactionAccount(
            std::wstring const& account,
            std::wstring const& transaction)
        {
            if (account == TransactionMigrationAccount(transaction))
            {
                return true;
            }

            auto valuePrefix = TransactionValuePrefix(transaction);
            return StartsWith(account, valuePrefix) && account.size() > valuePrefix.size();
        }

        void CleanupResidualCredentials(PasswordVault const& vault)
        {
            auto activeTransaction = ParseVersionedRevision(
                vault,
                ReadCredential(vault, RevisionAccount));
            auto activeCommitAccount = activeTransaction.has_value()
                ? CommitAccount(*activeTransaction)
                : std::wstring{};

            for (auto const& credential : AllCredentials(vault))
            {
                if (credential.Resource() != ResourceName)
                {
                    continue;
                }

                auto account = std::wstring{ credential.UserName() };
                if (account == RevisionAccount)
                {
                    continue;
                }

                auto remove = false;
                if (StartsWith(account, TransactionAccountPrefix))
                {
                    remove = !activeTransaction.has_value() ||
                        !IsActiveTransactionAccount(account, *activeTransaction);
                }
                else if (StartsWith(account, CommitAccountPrefix))
                {
                    remove = !activeTransaction.has_value() || account != activeCommitAccount;
                }
                else if (activeTransaction.has_value())
                {
                    remove = true;
                }

                if (remove)
                {
                    vault.Remove(credential);
                }
            }
        }

        void CleanupResidualCredentialsAfterCommit(PasswordVault const& vault) noexcept
        {
            try
            {
                CleanupResidualCredentials(vault);
            }
            catch (hresult_error const&)
            {
                // The commit is already durable. A later Probe/Read/Mutate retries cleanup.
            }
        }

        void StageCommittedSnapshot(
            PasswordVault const& vault,
            std::wstring const& transaction,
            std::map<std::wstring, std::wstring> const& entries,
            SecretMigrationState migrationState)
        {
            for (auto const& [name, value] : entries)
            {
                AddCredentialVerified(vault, TransactionValueAccount(transaction, name), value);
            }

            AddCredentialVerified(
                vault,
                TransactionMigrationAccount(transaction),
                MigrationStateValue(migrationState));
            AddCredentialVerified(vault, CommitAccount(transaction), CommitValue);

            // This is the only publication point. PasswordVault::Add replaces the
            // pointer without deleting the previously committed revision first.
            AddCredentialVerified(vault, RevisionAccount, transaction);
        }

        void RequireSnapshotMatches(
            StoredSnapshot const& actual,
            std::wstring const& revision,
            SecretMigrationState migrationState,
            std::map<std::wstring, std::wstring> const& entries)
        {
            if (actual.revision != revision ||
                actual.migrationState != migrationState ||
                actual.entries != entries)
            {
                throw hresult_error(E_FAIL);
            }
        }
    }

    SecretStoreResult SecretStore::Probe()
    {
        std::scoped_lock lock{ SecretStoreGate() };
        CrossProcessSecretStoreLock processLock;
        PasswordVault vault;
        auto snapshot = LoadCommittedSnapshot(vault);
        CleanupResidualCredentials(vault);

        if (ReadCredential(vault, RevisionAccount) != snapshot.revision)
        {
            throw SecretStoreConflict{};
        }

        return {
            .revision = std::move(snapshot.revision),
            .migrationState = snapshot.migrationState,
            .entries = {},
        };
    }

    SecretStoreResult SecretStore::Read(std::vector<std::wstring> const& names)
    {
        std::scoped_lock lock{ SecretStoreGate() };
        CrossProcessSecretStoreLock processLock;
        PasswordVault vault;
        auto snapshot = LoadCommittedSnapshot(vault);
        CleanupResidualCredentials(vault);
        std::vector<SecretEntry> entries;
        entries.reserve(names.size());

        for (auto const& name : names)
        {
            if (auto value = snapshot.entries.find(name); value != snapshot.entries.end())
            {
                entries.push_back({ name, value->second });
            }
        }

        if (ReadCredential(vault, RevisionAccount) != snapshot.revision)
        {
            throw SecretStoreConflict{};
        }

        return {
            .revision = std::move(snapshot.revision),
            .migrationState = snapshot.migrationState,
            .entries = std::move(entries),
        };
    }

    SecretStoreResult SecretStore::Mutate(
        std::vector<SecretMutation> const& changes,
        std::optional<std::wstring> const& expectedRevision,
        SecretClearScope clearScope,
        std::optional<SecretMigrationState> migrationState)
    {
        std::scoped_lock lock{ SecretStoreGate() };
        CrossProcessSecretStoreLock processLock;
        PasswordVault vault;
        auto previous = LoadCommittedSnapshot(vault);
        CleanupResidualCredentials(vault);
        if (ReadCredential(vault, RevisionAccount) != previous.revision ||
            previous.revision != expectedRevision)
        {
            throw SecretStoreConflict{};
        }

        auto nextEntries = previous.entries;
        for (auto entry = nextEntries.begin(); entry != nextEntries.end();)
        {
            if (MatchesClearScope(entry->first, clearScope))
            {
                entry = nextEntries.erase(entry);
            }
            else
            {
                ++entry;
            }
        }

        for (auto const& change : changes)
        {
            if (change.value.has_value())
            {
                nextEntries[change.name] = *change.value;
            }
            else
            {
                nextEntries.erase(change.name);
            }
        }

        auto nextMigration = migrationState.value_or(previous.migrationState);
        auto transaction = CreateRevisionToken();
        auto nextRevision = transaction;
        StageCommittedSnapshot(vault, transaction, nextEntries, nextMigration);
        RequireSnapshotMatches(
            LoadCommittedSnapshot(vault),
            nextRevision,
            nextMigration,
            nextEntries);
        CleanupResidualCredentialsAfterCommit(vault);

        return {
            .revision = std::move(nextRevision),
            .migrationState = nextMigration,
            .entries = {},
        };
    }
}
