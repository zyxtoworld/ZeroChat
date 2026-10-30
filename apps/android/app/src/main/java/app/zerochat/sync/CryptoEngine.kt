package app.zerochat.sync

import android.util.Base64
import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.EnvelopeCrypto
import app.zerochat.data.ObjectEnvelopeCrypto
import app.zerochat.data.SyncVault
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.SerializationStrategy
import kotlinx.serialization.json.Json
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.SecureRandom
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

private const val VAULT_KDF = "PBKDF2-SHA256"
private const val VAULT_CIPHER = "AES-256-GCM"
private const val VAULT_KDF_ITERATIONS = 600_000
private const val SALT_BYTES = 16
private const val IV_BYTES = 12
private const val GCM_TAG_BITS = 128
internal const val MAX_DECOMPRESSED_SYNC_JSON_BYTES = 32_000_000

internal fun accumulateDecompressedSyncJsonBytes(
    currentBytes: Int,
    nextBytes: Int,
    maxBytes: Int,
): Int {
    require(currentBytes >= 0 && nextBytes >= 0 && maxBytes >= 0)
    if (currentBytes > maxBytes || nextBytes > maxBytes - currentBytes) {
        throw IllegalArgumentException(
            "Encrypted sync data exceeded the $maxBytes-byte safety limit.",
        )
    }
    return currentBytes + nextBytes
}

internal fun decompressJsonPayload(
    bytes: ByteArray,
    compression: String,
    maxBytes: Int = MAX_DECOMPRESSED_SYNC_JSON_BYTES,
): ByteArray {
    require(maxBytes >= 0) { "Decompression limit must not be negative." }
    return when (compression) {
        "none" -> {
            accumulateDecompressedSyncJsonBytes(0, bytes.size, maxBytes)
            bytes
        }
        "gzip" -> GZIPInputStream(ByteArrayInputStream(bytes)).use { input ->
            readBoundedDecompressedSyncJson(input, maxBytes)
        }
        else -> throw IllegalArgumentException("Remote object uses an unsupported compression format.")
    }
}

private fun readBoundedDecompressedSyncJson(input: InputStream, maxBytes: Int): ByteArray {
    val output = ByteArrayOutputStream(minOf(maxBytes, DEFAULT_BUFFER_SIZE))
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var totalBytes = 0

    while (true) {
        val read = input.read(buffer)
        if (read < 0) {
            break
        }
        if (read == 0) {
            continue
        }

        totalBytes = accumulateDecompressedSyncJsonBytes(totalBytes, read, maxBytes)
        output.write(buffer, 0, read)
    }

    return output.toByteArray()
}

class CryptoEngine {
    private val random = SecureRandom()
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    fun encryptVault(vault: SyncVault, passphrase: String): EncryptedSnapshotEnvelope {
        require(passphrase.isNotEmpty()) { "Data encryption password is required." }

        val normalizedVault = normalizeSyncVaultForProtocol(vault)
        val salt = randomBytes(SALT_BYTES)
        val iv = randomBytes(IV_BYTES)
        val updatedAt = normalizedVault.data.updatedAt
        val aad = aadFor(updatedAt)
        val key = deriveKey(passphrase, salt, VAULT_KDF_ITERATIONS)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad)

        val payload = json.encodeToString(SyncVault.serializer(), normalizedVault)
            .toByteArray(Charsets.UTF_8)
        val encrypted = cipher.doFinal(payload)

        return EncryptedSnapshotEnvelope(
            encryptedAt = System.currentTimeMillis(),
            updatedAt = updatedAt,
            crypto = EnvelopeCrypto(
                cipher = VAULT_CIPHER,
                kdf = VAULT_KDF,
                iterations = VAULT_KDF_ITERATIONS,
                salt = base64(salt),
                iv = base64(iv),
                aad = base64(aad),
            ),
            payload = base64(encrypted),
        )
    }

    fun <T> encryptObject(
        serializer: SerializationStrategy<T>,
        value: T,
        passphrase: String,
        objectType: String,
        updatedAt: Long,
    ): EncryptedObjectEnvelope {
        require(passphrase.isNotEmpty()) { "Data encryption password is required." }
        require(updatedAt > 0) { "Encrypted object timestamp is invalid." }

        val salt = randomBytes(SALT_BYTES)
        val iv = randomBytes(IV_BYTES)
        val aad = objectAadFor(objectType, updatedAt)
        val key = deriveKey(passphrase, salt, VAULT_KDF_ITERATIONS)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        cipher.updateAAD(aad)

        val payload = json.encodeToString(serializer, value).toByteArray(Charsets.UTF_8)
        val encrypted = cipher.doFinal(payload)

        return EncryptedObjectEnvelope(
            objectType = objectType,
            encryptedAt = System.currentTimeMillis(),
            updatedAt = updatedAt,
            crypto = ObjectEnvelopeCrypto(
                cipher = VAULT_CIPHER,
                kdf = VAULT_KDF,
                iterations = VAULT_KDF_ITERATIONS,
                salt = base64(salt),
                iv = base64(iv),
                aad = base64(aad),
                compression = "none",
            ),
            payload = base64(encrypted),
        )
    }

    fun decryptVault(envelope: EncryptedSnapshotEnvelope, passphrase: String): SyncVault {
        require(passphrase.isNotEmpty()) { "Data encryption password is required." }
        require(envelope.kind == "zerochat.encryptedSnapshot" && envelope.version == 1) {
            "Remote data is not a supported ZeroChat encrypted snapshot."
        }
        require(envelope.crypto.cipher == VAULT_CIPHER && envelope.crypto.kdf == VAULT_KDF) {
            "Remote snapshot uses an unsupported encryption format."
        }
        require(envelope.crypto.iterations == VAULT_KDF_ITERATIONS) {
            "Remote snapshot uses an unsupported key derivation setting."
        }

        val salt = fixedBytes(envelope.crypto.salt, SALT_BYTES, "salt")
        val iv = fixedBytes(envelope.crypto.iv, IV_BYTES, "iv")
        val aad = bytes(envelope.crypto.aad, "aad")
        val expectedAad = aadFor(envelope.updatedAt)
        require(aad.contentEquals(expectedAad)) {
            "Remote snapshot authentication data does not match its timestamp."
        }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            deriveKey(passphrase, salt, envelope.crypto.iterations),
            GCMParameterSpec(GCM_TAG_BITS, iv),
        )
        cipher.updateAAD(expectedAad)

        val decrypted = runCatching {
            cipher.doFinal(bytes(envelope.payload, "payload"))
        }.getOrElse {
            throw IllegalArgumentException("Remote data could not be decrypted with this password.", it)
        }
        val vault = decodeValidatedSyncVault(json, decrypted.toString(Charsets.UTF_8))
        require(vault.data.updatedAt == envelope.updatedAt) {
            "Remote snapshot timestamp does not match its payload."
        }

        return vault
    }

    fun <T> decryptObject(
        deserializer: DeserializationStrategy<T>,
        envelope: EncryptedObjectEnvelope,
        passphrase: String,
        expectedObjectType: String,
    ): T {
        require(passphrase.isNotEmpty()) { "Data encryption password is required." }
        require(envelope.kind == "zerochat.encryptedObject" && envelope.version == 1) {
            "Remote data is not a supported ZeroChat encrypted object."
        }
        require(envelope.objectType == expectedObjectType) {
            "Remote encrypted object type does not match its reference."
        }
        require(envelope.crypto.cipher == VAULT_CIPHER && envelope.crypto.kdf == VAULT_KDF) {
            "Remote object uses an unsupported encryption format."
        }
        require(envelope.crypto.iterations == VAULT_KDF_ITERATIONS) {
            "Remote object uses an unsupported key derivation setting."
        }
        require(envelope.crypto.compression == "none" || envelope.crypto.compression == "gzip") {
            "Remote object uses an unsupported compression format."
        }

        val salt = fixedBytes(envelope.crypto.salt, SALT_BYTES, "salt")
        val iv = fixedBytes(envelope.crypto.iv, IV_BYTES, "iv")
        val aad = bytes(envelope.crypto.aad, "aad")
        val expectedAad = objectAadFor(envelope.objectType, envelope.updatedAt)
        require(aad.contentEquals(expectedAad)) {
            "Remote object authentication data does not match its type and timestamp."
        }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            deriveKey(passphrase, salt, envelope.crypto.iterations),
            GCMParameterSpec(GCM_TAG_BITS, iv),
        )
        cipher.updateAAD(expectedAad)

        val decrypted = runCatching {
            cipher.doFinal(bytes(envelope.payload, "payload"))
        }.getOrElse {
            throw IllegalArgumentException("Remote incremental data could not be decrypted with this password.", it)
        }
        val payload = decompressJsonPayload(decrypted, envelope.crypto.compression)
        return json.decodeFromString(deserializer, payload.toString(Charsets.UTF_8))
    }

    private fun randomBytes(size: Int): ByteArray =
        ByteArray(size).also { random.nextBytes(it) }

    private fun aadFor(updatedAt: Long): ByteArray =
        "zerochat:vault:v1:$updatedAt".toByteArray(Charsets.UTF_8)

    private fun objectAadFor(objectType: String, updatedAt: Long): ByteArray =
        "zerochat:object:v1:$objectType:$updatedAt".toByteArray(Charsets.UTF_8)

    private fun base64(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun bytes(value: String, field: String): ByteArray =
        runCatching { Base64.decode(value, Base64.DEFAULT) }
            .getOrElse { throw IllegalArgumentException("Remote snapshot has invalid $field encoding.", it) }

    private fun fixedBytes(value: String, size: Int, field: String): ByteArray {
        val decoded = bytes(value, field)
        require(decoded.size == size) { "Remote snapshot has an invalid $field value." }
        return decoded
    }
}
