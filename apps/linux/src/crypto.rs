use crate::models::{
    EncryptedObjectEnvelope, EncryptedSnapshotEnvelope, EnvelopeCrypto, ObjectEnvelopeCrypto,
    SyncVault,
};
use crate::sync_vault_validation::decode_validated_sync_vault;
use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use flate2::read::GzDecoder;
use pbkdf2::pbkdf2_hmac;
use rand::{RngCore, rngs::OsRng};
use serde::{Serialize, de::DeserializeOwned};
use sha2::Sha256;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

const VAULT_KDF: &str = "PBKDF2-SHA256";
const VAULT_CIPHER: &str = "AES-256-GCM";
const VAULT_KDF_ITERATIONS: u32 = 600_000;
const SALT_BYTES: usize = 16;
const IV_BYTES: usize = 12;
const GCM_TAG_BYTES: usize = 16;
pub(crate) const MAX_DECOMPRESSED_SYNC_JSON_BYTES: usize = 32_000_000;

pub struct SnapshotCrypto;

impl SnapshotCrypto {
    pub fn new() -> Self {
        Self
    }

    pub fn encrypt_vault(
        &self,
        vault: &SyncVault,
        passphrase: &str,
    ) -> Result<EncryptedSnapshotEnvelope> {
        if passphrase.is_empty() {
            bail!("Data encryption password is required.");
        }

        let salt = random_bytes(SALT_BYTES);
        let iv = random_bytes(IV_BYTES);
        let updated_at = vault.data.updated_at;
        let aad = aad_for(updated_at);
        let key = derive_key(passphrase, &salt, VAULT_KDF_ITERATIONS);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Remote snapshot uses an unsupported encryption key."))?;
        let payload = serde_json::to_vec(vault)?;
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: payload.as_ref(),
                    aad: aad.as_ref(),
                },
            )
            .map_err(|_| anyhow::anyhow!("Remote snapshot encryption failed."))?;

        Ok(EncryptedSnapshotEnvelope {
            kind: "zerochat.encryptedSnapshot".to_owned(),
            version: 1,
            encrypted_at: now_millis(),
            updated_at,
            crypto: EnvelopeCrypto {
                cipher: VAULT_CIPHER.to_owned(),
                kdf: VAULT_KDF.to_owned(),
                iterations: VAULT_KDF_ITERATIONS as i32,
                salt: STANDARD.encode(salt),
                iv: STANDARD.encode(iv),
                aad: STANDARD.encode(aad),
            },
            payload: STANDARD.encode(encrypted),
        })
    }

    pub fn encrypt_object<T: Serialize>(
        &self,
        value: &T,
        passphrase: &str,
        object_type: &str,
        updated_at: i64,
    ) -> Result<EncryptedObjectEnvelope> {
        if passphrase.is_empty() {
            bail!("Data encryption password is required.");
        }
        if updated_at <= 0 {
            bail!("Encrypted object timestamp is invalid.");
        }

        let salt = random_bytes(SALT_BYTES);
        let iv = random_bytes(IV_BYTES);
        let aad = object_aad_for(object_type, updated_at);
        let key = derive_key(passphrase, &salt, VAULT_KDF_ITERATIONS);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Remote object uses an unsupported encryption key."))?;
        let payload = serde_json::to_vec(value)?;
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: payload.as_ref(),
                    aad: aad.as_ref(),
                },
            )
            .map_err(|_| anyhow::anyhow!("Remote object encryption failed."))?;

        Ok(EncryptedObjectEnvelope {
            kind: "zerochat.encryptedObject".to_owned(),
            version: 1,
            object_type: object_type.to_owned(),
            encrypted_at: now_millis(),
            updated_at,
            crypto: ObjectEnvelopeCrypto {
                cipher: VAULT_CIPHER.to_owned(),
                kdf: VAULT_KDF.to_owned(),
                iterations: VAULT_KDF_ITERATIONS as i32,
                salt: STANDARD.encode(salt),
                iv: STANDARD.encode(iv),
                aad: STANDARD.encode(aad),
                compression: "none".to_owned(),
            },
            payload: STANDARD.encode(encrypted),
        })
    }

    pub fn decrypt_vault(
        &self,
        envelope: &EncryptedSnapshotEnvelope,
        passphrase: &str,
    ) -> Result<SyncVault> {
        if passphrase.is_empty() {
            bail!("Data encryption password is required.");
        }
        if envelope.kind != "zerochat.encryptedSnapshot" || envelope.version != 1 {
            bail!("Remote data is not a supported ZeroChat encrypted snapshot.");
        }
        if envelope.crypto.cipher != VAULT_CIPHER || envelope.crypto.kdf != VAULT_KDF {
            bail!("Remote snapshot uses an unsupported encryption format.");
        }
        if envelope.crypto.iterations != VAULT_KDF_ITERATIONS as i32 {
            bail!("Remote snapshot uses an unsupported key derivation setting.");
        }

        let salt = fixed_base64(&envelope.crypto.salt, SALT_BYTES, "salt")?;
        let iv = fixed_base64(&envelope.crypto.iv, IV_BYTES, "iv")?;
        let aad = base64_bytes(&envelope.crypto.aad, "aad")?;
        let expected_aad = aad_for(envelope.updated_at);
        if !constant_time_eq(&aad, &expected_aad) {
            bail!("Remote snapshot authentication data does not match its timestamp.");
        }

        let payload = base64_bytes(&envelope.payload, "payload")?;
        if payload.len() <= GCM_TAG_BYTES {
            bail!("Remote snapshot payload is invalid.");
        }

        let key = derive_key(passphrase, &salt, envelope.crypto.iterations as u32);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Remote snapshot uses an unsupported encryption key."))?;
        let decrypted = cipher
            .decrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: payload.as_ref(),
                    aad: expected_aad.as_ref(),
                },
            )
            .map_err(|_| {
                anyhow::anyhow!("Remote data could not be decrypted with this password.")
            })?;
        let vault = decode_validated_sync_vault(&decrypted)?;

        if vault.data.updated_at != envelope.updated_at {
            bail!("Remote snapshot timestamp does not match its payload.");
        }

        Ok(vault)
    }

    pub fn decrypt_object<T: DeserializeOwned>(
        &self,
        envelope: &EncryptedObjectEnvelope,
        passphrase: &str,
        expected_object_type: &str,
    ) -> Result<T> {
        if passphrase.is_empty() {
            bail!("Data encryption password is required.");
        }
        if envelope.kind != "zerochat.encryptedObject" || envelope.version != 1 {
            bail!("Remote data is not a supported ZeroChat encrypted object.");
        }
        if envelope.object_type != expected_object_type {
            bail!("Remote encrypted object type does not match its reference.");
        }
        if envelope.crypto.cipher != VAULT_CIPHER || envelope.crypto.kdf != VAULT_KDF {
            bail!("Remote object uses an unsupported encryption format.");
        }
        if envelope.crypto.iterations != VAULT_KDF_ITERATIONS as i32 {
            bail!("Remote object uses an unsupported key derivation setting.");
        }
        if envelope.crypto.compression != "none" && envelope.crypto.compression != "gzip" {
            bail!("Remote object uses an unsupported compression format.");
        }

        let salt = fixed_base64(&envelope.crypto.salt, SALT_BYTES, "salt")?;
        let iv = fixed_base64(&envelope.crypto.iv, IV_BYTES, "iv")?;
        let aad = base64_bytes(&envelope.crypto.aad, "aad")?;
        let expected_aad = object_aad_for(&envelope.object_type, envelope.updated_at);
        if !constant_time_eq(&aad, &expected_aad) {
            bail!("Remote object authentication data does not match its type and timestamp.");
        }

        let payload = base64_bytes(&envelope.payload, "payload")?;
        if payload.len() <= GCM_TAG_BYTES {
            bail!("Remote object payload is invalid.");
        }

        let key = derive_key(passphrase, &salt, envelope.crypto.iterations as u32);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|_| anyhow::anyhow!("Remote object uses an unsupported encryption key."))?;
        let decrypted = cipher
            .decrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: payload.as_ref(),
                    aad: expected_aad.as_ref(),
                },
            )
            .map_err(|_| {
                anyhow::anyhow!(
                    "Remote incremental data could not be decrypted with this password."
                )
            })?;
        let json = decompress_json_payload(&decrypted, &envelope.crypto.compression)?;

        Ok(serde_json::from_slice::<T>(&json)?)
    }
}

fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iterations, &mut key);
    key
}

fn aad_for(updated_at: i64) -> Vec<u8> {
    format!("zerochat:vault:v1:{updated_at}").into_bytes()
}

fn object_aad_for(object_type: &str, updated_at: i64) -> Vec<u8> {
    format!("zerochat:object:v1:{object_type}:{updated_at}").into_bytes()
}

fn decompress_json_payload(bytes: &[u8], compression: &str) -> Result<Vec<u8>> {
    decompress_json_payload_with_limit(bytes, compression, MAX_DECOMPRESSED_SYNC_JSON_BYTES)
}

fn decompress_json_payload_with_limit(
    bytes: &[u8],
    compression: &str,
    max_bytes: usize,
) -> Result<Vec<u8>> {
    match compression {
        "none" => {
            accumulate_decompressed_sync_json_bytes(0, bytes.len(), max_bytes)?;
            Ok(bytes.to_vec())
        }
        "gzip" => {
            let decoder = GzDecoder::new(bytes);
            read_bounded_decompressed_sync_json(decoder, max_bytes)
        }
        _ => bail!("Remote object uses an unsupported compression format."),
    }
}

fn accumulate_decompressed_sync_json_bytes(
    current_bytes: usize,
    next_bytes: usize,
    max_bytes: usize,
) -> Result<usize> {
    if current_bytes > max_bytes || next_bytes > max_bytes - current_bytes {
        bail!("Encrypted sync data exceeded the {max_bytes}-byte safety limit.");
    }
    Ok(current_bytes + next_bytes)
}

fn read_bounded_decompressed_sync_json(mut reader: impl Read, max_bytes: usize) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(max_bytes.min(16_384));
    let mut buffer = [0_u8; 16_384];
    let mut total_bytes = 0;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }

        total_bytes = accumulate_decompressed_sync_json_bytes(total_bytes, read, max_bytes)?;
        output.extend_from_slice(&buffer[..read]);
    }

    Ok(output)
}

fn random_bytes(size: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; size];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn base64_bytes(value: &str, field: &str) -> Result<Vec<u8>> {
    STANDARD
        .decode(value)
        .map_err(|_| anyhow::anyhow!("Remote snapshot has invalid {field} encoding."))
}

fn fixed_base64(value: &str, size: usize, field: &str) -> Result<Vec<u8>> {
    let bytes = base64_bytes(value, field)?;
    if bytes.len() != size {
        bail!("Remote snapshot has an invalid {field} value.");
    }
    Ok(bytes)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    let mut diff = 0_u8;
    for index in 0..left.len() {
        diff |= left[index] ^ right[index];
    }
    diff == 0
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{MAX_DECOMPRESSED_SYNC_JSON_BYTES, decompress_json_payload_with_limit};
    use flate2::{Compression, write::GzEncoder};
    use std::io::Write;

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).expect("gzip write must succeed");
        encoder.finish().expect("gzip finish must succeed")
    }

    #[test]
    fn decompressed_sync_json_budget_matches_cross_platform_contract() {
        assert_eq!(MAX_DECOMPRESSED_SYNC_JSON_BYTES, 32_000_000);
    }

    #[test]
    fn gzip_decompression_accepts_boundary_and_rejects_overflow_before_append() {
        let payload = b"12345";
        let compressed = gzip(payload);

        assert_eq!(
            decompress_json_payload_with_limit(&compressed, "gzip", payload.len()).unwrap(),
            payload
        );
        assert_eq!(
            decompress_json_payload_with_limit(&compressed, "gzip", payload.len() - 1)
                .unwrap_err()
                .to_string(),
            "Encrypted sync data exceeded the 4-byte safety limit."
        );
    }

    #[test]
    fn uncompressed_authenticated_objects_use_the_same_budget() {
        let payload = b"12345";

        assert_eq!(
            decompress_json_payload_with_limit(payload, "none", payload.len()).unwrap(),
            payload
        );
        assert_eq!(
            decompress_json_payload_with_limit(payload, "none", payload.len() - 1)
                .unwrap_err()
                .to_string(),
            "Encrypted sync data exceeded the 4-byte safety limit."
        );
    }
}
