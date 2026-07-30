import CryptoKit
import Czlib
import Foundation
import Security

private let vaultKdf = "PBKDF2-SHA256"
private let vaultCipher = "AES-256-GCM"
private let vaultKdfIterations = 600_000
private let saltBytes = 16
private let ivBytes = 12
private let gcmTagBytes = 16
let maxDecompressedSyncJSONBytes = 32_000_000

func accumulateDecompressedSyncJSONBytes(
    currentBytes: Int,
    nextBytes: Int,
    maxBytes: Int = maxDecompressedSyncJSONBytes
) throws -> Int {
    guard currentBytes >= 0,
          nextBytes >= 0,
          maxBytes >= 0,
          currentBytes <= maxBytes,
          nextBytes <= maxBytes - currentBytes else {
        throw SnapshotCryptoError.decompressedPayloadTooLarge(maxBytes)
    }
    return currentBytes + nextBytes
}

func decompressSyncJSONPayload(
    _ data: Data,
    compression: String,
    maxBytes: Int = maxDecompressedSyncJSONBytes
) throws -> Data {
    if compression == "none" {
        _ = try accumulateDecompressedSyncJSONBytes(
            currentBytes: 0,
            nextBytes: data.count,
            maxBytes: maxBytes
        )
        return data
    }
    if compression != "gzip" {
        throw SnapshotCryptoError.unsupportedCompression
    }

    return try data.withUnsafeBytes { sourceBuffer in
        guard let source = sourceBuffer.bindMemory(to: UInt8.self).baseAddress else {
            throw SnapshotCryptoError.unsupportedCompression
        }

        var stream = z_stream()
        stream.next_in = UnsafeMutablePointer<Bytef>(mutating: source)
        stream.avail_in = uInt(data.count)

        guard inflateInit2_(&stream, 16 + MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw SnapshotCryptoError.unsupportedCompression
        }
        defer { inflateEnd(&stream) }

        var output = Data()
        let chunkSize = 16_384
        var buffer = [UInt8](repeating: 0, count: chunkSize)

        while true {
            let status = buffer.withUnsafeMutableBytes { outputBuffer -> Int32 in
                stream.next_out = outputBuffer.bindMemory(to: UInt8.self).baseAddress
                stream.avail_out = uInt(chunkSize)
                return inflate(&stream, Z_NO_FLUSH)
            }

            let produced = chunkSize - Int(stream.avail_out)
            if produced > 0 {
                _ = try accumulateDecompressedSyncJSONBytes(
                    currentBytes: output.count,
                    nextBytes: produced,
                    maxBytes: maxBytes
                )
                output.append(buffer, count: produced)
            }

            if status == Z_STREAM_END {
                break
            }

            guard status == Z_OK else {
                throw SnapshotCryptoError.unsupportedCompression
            }
        }

        return output
    }
}

public actor CryptoEngine {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init() {
        encoder.outputFormatting = [.sortedKeys]
    }

    public func encryptVault(
        _ vault: SyncVault,
        passphrase: String
    ) throws -> EncryptedSnapshotEnvelope {
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }

        let salt = try randomData(count: saltBytes)
        let iv = try randomData(count: ivBytes)
        let updatedAt = vault.data.updatedAt
        let aad = Self.aad(for: updatedAt)
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: vaultKdfIterations)
        let nonce = try AES.GCM.Nonce(data: iv)
        let payload = try encoder.encode(vault)
        let sealed = try AES.GCM.seal(payload, using: key, nonce: nonce, authenticating: aad)

        var encrypted = Data(sealed.ciphertext)
        encrypted.append(sealed.tag)

        return EncryptedSnapshotEnvelope(
            kind: "zerochat.encryptedSnapshot",
            version: 1,
            encryptedAt: Self.nowMillis(),
            updatedAt: updatedAt,
            crypto: EnvelopeCrypto(
                cipher: vaultCipher,
                kdf: vaultKdf,
                iterations: vaultKdfIterations,
                salt: salt.base64EncodedString(),
                iv: iv.base64EncodedString(),
                aad: aad.base64EncodedString()
            ),
            payload: encrypted.base64EncodedString()
        )
    }

    public func encryptObject<T: Encodable>(
        _ value: T,
        passphrase: String,
        objectType: String,
        updatedAt: Int64
    ) throws -> EncryptedObjectEnvelope {
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }
        guard updatedAt > 0 else {
            throw SnapshotCryptoError.badTimestamp
        }

        let salt = try randomData(count: saltBytes)
        let iv = try randomData(count: ivBytes)
        let aad = Self.objectAad(for: objectType, updatedAt: updatedAt)
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: vaultKdfIterations)
        let nonce = try AES.GCM.Nonce(data: iv)
        let payload = try encoder.encode(value)
        let sealed = try AES.GCM.seal(payload, using: key, nonce: nonce, authenticating: aad)

        var encrypted = Data(sealed.ciphertext)
        encrypted.append(sealed.tag)

        return EncryptedObjectEnvelope(
            kind: "zerochat.encryptedObject",
            version: 1,
            objectType: objectType,
            encryptedAt: Self.nowMillis(),
            updatedAt: updatedAt,
            crypto: ObjectEnvelopeCrypto(
                cipher: vaultCipher,
                kdf: vaultKdf,
                iterations: vaultKdfIterations,
                salt: salt.base64EncodedString(),
                iv: iv.base64EncodedString(),
                aad: aad.base64EncodedString(),
                compression: "none"
            ),
            payload: encrypted.base64EncodedString()
        )
    }

    public func decryptVault(
        _ envelope: EncryptedSnapshotEnvelope,
        passphrase: String
    ) throws -> SyncVault {
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }
        guard envelope.kind == "zerochat.encryptedSnapshot", envelope.version == 1 else {
            throw SnapshotCryptoError.unsupportedSnapshot
        }
        guard envelope.crypto.cipher == vaultCipher, envelope.crypto.kdf == vaultKdf else {
            throw SnapshotCryptoError.unsupportedSnapshot
        }
        guard envelope.crypto.iterations == vaultKdfIterations else {
            throw SnapshotCryptoError.unsupportedKdf
        }

        let salt = try fixedBase64(envelope.crypto.salt, count: saltBytes, field: "salt")
        let iv = try fixedBase64(envelope.crypto.iv, count: ivBytes, field: "iv")
        let aad = try base64(envelope.crypto.aad, field: "aad")
        let expectedAad = Self.aad(for: envelope.updatedAt)
        guard constantTimeEqual(aad, expectedAad) else {
            throw SnapshotCryptoError.badAuthenticationData
        }

        let payload = try base64(envelope.payload, field: "payload")
        guard payload.count > gcmTagBytes else {
            throw SnapshotCryptoError.badPayload
        }

        let ciphertext = payload.prefix(payload.count - gcmTagBytes)
        let tag = payload.suffix(gcmTagBytes)
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: envelope.crypto.iterations)

        let decrypted: Data
        do {
            decrypted = try AES.GCM.open(box, using: key, authenticating: expectedAad)
        } catch {
            throw SnapshotCryptoError.badDecryption
        }

        let vault = try decodeValidatedSyncVault(decrypted, decoder: decoder)
        guard vault.data.updatedAt == envelope.updatedAt else {
            throw SnapshotCryptoError.badTimestamp
        }

        return vault
    }

    public func decryptObject<T: Decodable>(
        _ type: T.Type,
        envelope: EncryptedObjectEnvelope,
        passphrase: String,
        expectedObjectType: String
    ) throws -> T {
        guard !passphrase.isEmpty else {
            throw SnapshotCryptoError.missingPassphrase
        }
        guard envelope.kind == "zerochat.encryptedObject", envelope.version == 1 else {
            throw SnapshotCryptoError.unsupportedObject
        }
        guard envelope.objectType == expectedObjectType else {
            throw SnapshotCryptoError.badObjectType
        }
        guard envelope.crypto.cipher == vaultCipher, envelope.crypto.kdf == vaultKdf else {
            throw SnapshotCryptoError.unsupportedObject
        }
        guard envelope.crypto.iterations == vaultKdfIterations else {
            throw SnapshotCryptoError.unsupportedKdf
        }
        guard envelope.crypto.compression == "none" || envelope.crypto.compression == "gzip" else {
            throw SnapshotCryptoError.unsupportedCompression
        }

        let salt = try fixedBase64(envelope.crypto.salt, count: saltBytes, field: "salt")
        let iv = try fixedBase64(envelope.crypto.iv, count: ivBytes, field: "iv")
        let aad = try base64(envelope.crypto.aad, field: "aad")
        let expectedAad = Self.objectAad(for: envelope.objectType, updatedAt: envelope.updatedAt)
        guard constantTimeEqual(aad, expectedAad) else {
            throw SnapshotCryptoError.badAuthenticationData
        }

        let payload = try base64(envelope.payload, field: "payload")
        guard payload.count > gcmTagBytes else {
            throw SnapshotCryptoError.badPayload
        }

        let ciphertext = payload.prefix(payload.count - gcmTagBytes)
        let tag = payload.suffix(gcmTagBytes)
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let key = try deriveKey(passphrase: passphrase, salt: salt, iterations: envelope.crypto.iterations)

        let decrypted: Data
        do {
            decrypted = try AES.GCM.open(box, using: key, authenticating: expectedAad)
        } catch {
            throw SnapshotCryptoError.badIncrementalDecryption
        }

        return try decoder.decode(
            T.self,
            from: decompressSyncJSONPayload(decrypted, compression: envelope.crypto.compression)
        )
    }

    private func deriveKey(
        passphrase: String,
        salt: Data,
        iterations: Int
    ) throws -> SymmetricKey {
        guard iterations == vaultKdfIterations else {
            throw SnapshotCryptoError.unsupportedKdf
        }

        let passwordKey = SymmetricKey(data: Data(passphrase.utf8))
        var firstBlock = Data(salt)
        firstBlock.append(contentsOf: [0, 0, 0, 1] as [UInt8])

        var u = Array(HMAC<SHA256>.authenticationCode(for: firstBlock, using: passwordKey))
        var derived = u

        for _ in 1..<iterations {
            u = Array(HMAC<SHA256>.authenticationCode(for: Data(u), using: passwordKey))
            for index in derived.indices {
                derived[index] ^= u[index]
            }
        }

        return SymmetricKey(data: Data(derived))
    }

    private func randomData(count: Int) throws -> Data {
        var data = Data(count: count)
        let status = data.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else {
            throw SnapshotCryptoError.randomFailed
        }
        return data
    }

    private static func aad(for updatedAt: Int64) -> Data {
        Data("zerochat:vault:v1:\(updatedAt)".utf8)
    }

    private static func objectAad(for objectType: String, updatedAt: Int64) -> Data {
        Data("zerochat:object:v1:\(objectType):\(updatedAt)".utf8)
    }

    private static func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func base64(_ value: String, field: String) throws -> Data {
        guard let data = Data(base64Encoded: value) else {
            throw SnapshotCryptoError.badBase64(field)
        }
        return data
    }

    private func fixedBase64(_ value: String, count: Int, field: String) throws -> Data {
        let data = try base64(value, field: field)
        guard data.count == count else {
            throw SnapshotCryptoError.invalidField(field)
        }
        return data
    }

    private func constantTimeEqual(_ left: Data, _ right: Data) -> Bool {
        guard left.count == right.count else {
            return false
        }

        var diff: UInt8 = 0
        for index in 0..<left.count {
            diff |= left[index] ^ right[index]
        }
        return diff == 0
    }
}

public enum SnapshotCryptoError: LocalizedError {
    case missingPassphrase
    case unsupportedSnapshot
    case unsupportedObject
    case badObjectType
    case unsupportedKdf
    case unsupportedCompression
    case decompressedPayloadTooLarge(Int)
    case badAuthenticationData
    case badPayload
    case badTimestamp
    case badDecryption
    case badIncrementalDecryption
    case invalidVaultFormat
    case badBase64(String)
    case invalidField(String)
    case randomFailed

    public var errorDescription: String? {
        switch self {
        case .missingPassphrase:
            return "Data encryption password is required."
        case .unsupportedSnapshot:
            return "Remote snapshot uses an unsupported encryption format."
        case .unsupportedObject:
            return "Remote object uses an unsupported encryption format."
        case .badObjectType:
            return "Remote encrypted object type does not match its reference."
        case .unsupportedKdf:
            return "Remote snapshot uses an unsupported key derivation setting."
        case .unsupportedCompression:
            return "Remote incremental sync data uses unsupported compression."
        case .decompressedPayloadTooLarge(let maxBytes):
            return "Encrypted sync data exceeded the \(maxBytes)-byte decompression safety limit."
        case .badAuthenticationData:
            return "Remote snapshot authentication data does not match its timestamp."
        case .badPayload:
            return "Remote snapshot payload is invalid."
        case .badTimestamp:
            return "Remote snapshot timestamp does not match its payload."
        case .badDecryption:
            return "Remote data could not be decrypted with this password."
        case .badIncrementalDecryption:
            return "Remote incremental data could not be decrypted with this password."
        case .invalidVaultFormat:
            return "Remote snapshot payload has invalid format."
        case .badBase64(let field):
            return "Remote snapshot has invalid \(field) encoding."
        case .invalidField(let field):
            return "Remote snapshot has an invalid \(field) value."
        case .randomFailed:
            return "Secure random generation failed."
        }
    }
}
