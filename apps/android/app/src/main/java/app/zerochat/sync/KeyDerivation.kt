package app.zerochat.sync

import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

internal fun deriveKey(
    passphrase: String,
    salt: ByteArray,
    iterations: Int,
): SecretKeySpec {
    val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
    val spec = PBEKeySpec(passphrase.toCharArray(), salt, iterations, 256)
    return SecretKeySpec(factory.generateSecret(spec).encoded, "AES")
}
