import Foundation
import ZeroChatCore

struct AppleImportedBackup {
    var snapshot: AppSnapshot
    var providerKeys: [String: String]
}

struct AppleCompensationError: LocalizedError {
    let operationError: Error
    let compensationErrors: [Error]

    var errorDescription: String? {
        ([operationError] + compensationErrors)
            .map(\.localizedDescription)
            .joined(separator: "\n")
    }
}

@MainActor
func appleEncryptedBackupData(
    snapshot: AppSnapshot,
    passphrase: String,
    crypto: CryptoEngine,
    providerKey: (String) -> String
) async throws -> Data {
    let vault = SyncVault(
        data: snapshot,
        secrets: ProviderSecrets(providerKeys: appleProviderKeys(for: snapshot, providerKey: providerKey))
    )
    let envelope = try await crypto.encryptVault(vault, passphrase: passphrase)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return try encoder.encode(envelope)
}

@MainActor
func appleImportedBackup(
    data: Data,
    passphrase: String,
    crypto: CryptoEngine,
    now: Int64
) async throws -> AppleImportedBackup {
    let envelope = try JSONDecoder().decode(EncryptedSnapshotEnvelope.self, from: data)
    let vault = try await crypto.decryptVault(envelope, passphrase: passphrase)
    guard vault.data.version == 1 else {
        throw BackupImportError.invalidFormat
    }

    var imported = vault.data
    imported.updatedAt = now
    return AppleImportedBackup(snapshot: imported, providerKeys: vault.secrets.providerKeys)
}

@MainActor
func appleProviderKeys(
    for snapshot: AppSnapshot,
    providerKey: (String) -> String
) -> [String: String] {
    Dictionary(
        uniqueKeysWithValues: snapshot.providers.compactMap { provider in
            let value = providerKey(provider.id)
            return value.isEmpty ? nil : (provider.id, value)
        }
    )
}

@MainActor
func appleApplyProviderKeys(
    current: AppSnapshot,
    synced: AppSnapshot,
    providerKeys: [String: String],
    providerKey: (String) throws -> String,
    setProviderKey: @escaping (String, String) throws -> Void
) throws {
    let providerIds = Set(
        current.providers.map(\.id) +
            synced.providers.map(\.id) +
            ZeroChatViewModel.defaultSnapshot().providers.map(\.id)
    ).sorted()
    try appleReplaceProviderKeysAtomically(
        providerIds: providerIds,
        values: providerKeys,
        providerKey: providerKey,
        setProviderKey: setProviderKey
    )
}

@MainActor
func appleApplyProviderKeyValues(
    providerIds: [String],
    values: [String: String],
    providerKey: (String) throws -> String,
    setProviderKey: @escaping (String, String) throws -> Void
) throws {
    _ = try appleReplaceProviderKeysAtomically(
        providerIds: providerIds,
        values: values,
        providerKey: providerKey,
        setProviderKey: setProviderKey
    )
}

private typealias AppleProviderKeyRollback = @MainActor () throws -> Void

@MainActor
@discardableResult
private func appleReplaceProviderKeysAtomically(
    providerIds: [String],
    values: [String: String],
    providerKey: (String) throws -> String,
    setProviderKey: @escaping (String, String) throws -> Void
) throws -> AppleProviderKeyRollback {
    var previousValues: [String: String] = [:]
    for providerId in providerIds {
        previousValues[providerId] = try providerKey(providerId)
    }
    var appliedProviderIds: [String] = []

    do {
        for providerId in providerIds {
            try setProviderKey(providerId, values[providerId] ?? "")
            appliedProviderIds.append(providerId)
        }
    } catch {
        let operationError = error
        do {
            try appleRestoreProviderKeys(
                providerIds: appliedProviderIds,
                previousValues: previousValues,
                setProviderKey: setProviderKey
            )
        } catch let compensationError {
            throw AppleCompensationError(
                operationError: operationError,
                compensationErrors: appleCompensationErrors(from: compensationError)
            )
        }
        throw operationError
    }

    return {
        try appleRestoreProviderKeys(
            providerIds: appliedProviderIds,
            previousValues: previousValues,
            setProviderKey: setProviderKey
        )
    }
}

@MainActor
private func appleRestoreProviderKeys(
    providerIds: [String],
    previousValues: [String: String],
    setProviderKey: (String, String) throws -> Void
) throws {
    var errors: [Error] = []
    for providerId in providerIds.reversed() {
        do {
            try setProviderKey(providerId, previousValues[providerId] ?? "")
        } catch {
            errors.append(error)
        }
    }
    if !errors.isEmpty {
        throw AppleCompensationError(
            operationError: errors[0],
            compensationErrors: Array(errors.dropFirst())
        )
    }
}

private func appleCompensationErrors(from error: Error) -> [Error] {
    guard let compensation = error as? AppleCompensationError else {
        return [error]
    }
    return [compensation.operationError] + compensation.compensationErrors
}
