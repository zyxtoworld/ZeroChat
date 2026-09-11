import Foundation
import CryptoKit
import Security

private let accessKeyPrefix = "zerochat-access:v1:"
private let localDataTransitionPassphraseAccountPrefix = "encrypted-backup-passphrase:"

public final class KeychainStore: Sendable {
    private let service = "app.zerochat.client"
    private let localDataTransitionService = "app.zerochat.client.local-data-transition"

    public init() {}

    public func set(_ value: String, account: String) throws {
        try set(value, account: account, service: service)
    }

    public func get(account: String) throws -> String? {
        try get(account: account, service: service)
    }

    public func setLocalDataTransitionPassphrase(_ value: String, transitionId: String) throws {
        try set(
            value,
            account: "\(localDataTransitionPassphraseAccountPrefix)\(transitionId)",
            service: localDataTransitionService
        )
    }

    public func localDataTransitionPassphrase(transitionId: String) throws -> String? {
        try get(
            account: "\(localDataTransitionPassphraseAccountPrefix)\(transitionId)",
            service: localDataTransitionService
        )
    }

    public func clearLocalDataTransitionPassphrase(transitionId: String) throws {
        try setLocalDataTransitionPassphrase("", transitionId: transitionId)
    }

    public func clearAllLocalDataTransitionPassphrases() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: localDataTransitionService
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    private func set(_ value: String, account: String, service: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        try performKeychainSet(
            value,
            update: { data in
                SecItemUpdate(
                    query as CFDictionary,
                    [kSecValueData as String: data] as CFDictionary
                )
            },
            add: { data in
                var attributes = query
                attributes[kSecValueData as String] = data
                attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                return SecItemAdd(attributes as CFDictionary, nil)
            },
            delete: {
                SecItemDelete(query as CFDictionary)
            }
        )
    }

    private func get(account: String, service: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return try decodeKeychainRead(status: status, item: item)
    }

    public func cloudflareAccessKey() throws -> String {
        guard let passphrase = try get(account: "sync-passphrase"),
              !passphrase.isEmpty else {
            return ""
        }

        let digest = SHA256.hash(data: Data("\(accessKeyPrefix)\(passphrase)".utf8))
        return Data(digest)
            .base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public func clearAll() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]

        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }
}

func decodeKeychainRead(status: OSStatus, item: CFTypeRef?) throws -> String? {
    if status == errSecItemNotFound {
        return nil
    }

    guard status == errSecSuccess else {
        throw KeychainError.status(status)
    }
    guard let data = item as? Data,
          let value = String(data: data, encoding: .utf8) else {
        throw KeychainError.invalidData
    }

    return value
}

public enum KeychainError: LocalizedError {
    case status(OSStatus)
    case invalidData

    public var errorDescription: String? {
        switch self {
        case .status(let status):
            return SecCopyErrorMessageString(status, nil) as String?
                ?? "Keychain operation failed with status \(status)."
        case .invalidData:
            return "Keychain item contained invalid text data."
        }
    }
}

func performKeychainSet(
    _ value: String,
    update: (Data) -> OSStatus,
    add: (Data) -> OSStatus,
    delete: () -> OSStatus
) throws {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        let status = delete()
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
        return
    }

    let data = Data(value.utf8)
    let updateStatus = update(data)
    if updateStatus == errSecSuccess {
        return
    }
    guard updateStatus == errSecItemNotFound else {
        throw KeychainError.status(updateStatus)
    }

    let addStatus = add(data)
    if addStatus == errSecSuccess {
        return
    }
    if addStatus == errSecDuplicateItem {
        let retryStatus = update(data)
        guard retryStatus == errSecSuccess else {
            throw KeychainError.status(retryStatus)
        }
        return
    }
    throw KeychainError.status(addStatus)
}
