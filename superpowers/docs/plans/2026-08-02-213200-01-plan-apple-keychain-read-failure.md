# Apple Keychain read-failure fail-closed plan

## Root cause

`KeychainStore.get` correctly returns `nil` only for `errSecItemNotFound` and throws for every other Keychain failure. `AppleChatViewModel` erases those throws with `try?`, so `DataSettingsView` cannot distinguish a genuinely missing sync passphrase from inaccessible or corrupt secure storage. A failed read therefore looks like an empty committed value and can allow an unconfirmed overwrite.

## Outcome

- Preserve an explicit `missing` / `value` / `failure` state at the Apple ViewModel boundary.
- Report Keychain read failures with distinct localized copy.
- Re-read the committed sync passphrase before save, reset, encrypted-backup export, and encrypted-backup import.
- Block every sensitive action after a failed read and expose an explicit retry action.
- Keep `KeychainStore.get` throwing for backup/sync paths so those operations continue to fail closed.

## Verification

1. Add failing Node contract assertions and Swift unit tests before production edits.
2. Extract and test the Keychain status/data decoder so only `errSecItemNotFound` maps to missing.
3. Implement the ViewModel three-state reader and Data Settings gate.
4. Run the focused Apple contract gate, repository/completion/documentation checks, and source-format checks available on Windows.
5. Record that Swift compile/runtime verification still requires the Apple target host; do not claim a target-host pass from Windows.

