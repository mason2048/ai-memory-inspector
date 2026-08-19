use super::{migration, VaultBackend, VaultKey, VaultStore, CURRENT_SCHEMA_VERSION};
use crate::{
    error::CoreError,
    limits::{MAX_PASSPHRASE_BYTES, MIN_PASSPHRASE_BYTES},
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use zeroize::{Zeroize, Zeroizing};

const PASSPHRASE_CONTAINER_FORMAT: &str = "ami-encrypted-container-v1";
const DIRECT_KEY_CONTAINER_FORMAT: &str = "ami-encrypted-container-v2";
const PASSPHRASE_KDF: &str = "argon2id-v19-m65536-t3-p1";
const DIRECT_KEY_KDF: &str = "direct-key-32-v1";
const CIPHER: &str = "aes-256-gcm";
const PASSPHRASE_AAD: &[u8] = b"AI Memory Inspector vault;format=1";
const DIRECT_KEY_AAD_PREFIX: &str =
    "AI Memory Inspector vault;format=2;kdf=direct-key-32-v1;cipher=aes-256-gcm";
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const ARGON_MEMORY_KIB: u32 = 64 * 1024;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_LANES: u32 = 1;
const MAX_VAULT_BYTES: u64 = 40 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContainerEnvelope {
    format: String,
    kdf: String,
    cipher: String,
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    salt: Option<String>,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Default)]
pub struct EncryptedContainerVault;

fn validate_passphrase(passphrase: &str) -> Result<(), CoreError> {
    if !(MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len()) {
        return Err(CoreError::InvalidPassphrase);
    }
    Ok(())
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<VaultKey, CoreError> {
    let parameters = Params::new(ARGON_MEMORY_KIB, ARGON_ITERATIONS, ARGON_LANES, Some(32))
        .map_err(|_| CoreError::InvalidVault)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
    let mut output = [0_u8; 32];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut output)
        .map_err(|_| CoreError::AuthenticationFailed)?;
    Ok(VaultKey::new(output))
}

fn random_bytes<const N: usize>() -> Result<[u8; N], CoreError> {
    let mut value = [0_u8; N];
    getrandom::fill(&mut value)
        .map_err(|error| CoreError::Io(std::io::Error::other(error.to_string())))?;
    Ok(value)
}

fn decode(value: &str) -> Result<Vec<u8>, CoreError> {
    STANDARD_NO_PAD
        .decode(value)
        .map_err(|_| CoreError::InvalidVault)
}

fn read_envelope(path: &Path) -> Result<ContainerEnvelope, CoreError> {
    if !path.is_file() {
        return Err(CoreError::VaultNotFound);
    }
    if fs::metadata(path)?.len() > MAX_VAULT_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    let serialized = fs::read(path)?;
    let envelope: ContainerEnvelope =
        serde_json::from_slice(&serialized).map_err(|_| CoreError::InvalidVault)?;
    let is_passphrase_v1 = envelope.format == PASSPHRASE_CONTAINER_FORMAT
        && envelope.kdf == PASSPHRASE_KDF
        && envelope.salt.is_some();
    let is_direct_key_v2 = envelope.format == DIRECT_KEY_CONTAINER_FORMAT
        && envelope.kdf == DIRECT_KEY_KDF
        && envelope.salt.is_none();
    if (!is_passphrase_v1 && !is_direct_key_v2)
        || envelope.cipher != CIPHER
        || envelope.schema_version == 0
        || envelope.schema_version > CURRENT_SCHEMA_VERSION
    {
        return Err(CoreError::InvalidVault);
    }
    Ok(envelope)
}

fn direct_key_aad(schema_version: u32) -> Vec<u8> {
    format!("{DIRECT_KEY_AAD_PREFIX};schema={schema_version}").into_bytes()
}

fn envelope_aad(envelope: &ContainerEnvelope) -> Result<Vec<u8>, CoreError> {
    match (envelope.format.as_str(), envelope.kdf.as_str()) {
        (PASSPHRASE_CONTAINER_FORMAT, PASSPHRASE_KDF) => Ok(PASSPHRASE_AAD.to_vec()),
        (DIRECT_KEY_CONTAINER_FORMAT, DIRECT_KEY_KDF) => {
            Ok(direct_key_aad(envelope.schema_version))
        }
        _ => Err(CoreError::InvalidVault),
    }
}

fn decrypt_document(
    envelope: &ContainerEnvelope,
    key: &VaultKey,
) -> Result<migration::VaultDocument, CoreError> {
    let nonce = decode(&envelope.nonce)?;
    if nonce.len() != NONCE_BYTES {
        return Err(CoreError::InvalidVault);
    }
    let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| CoreError::InvalidVault)?;
    let ciphertext = decode(&envelope.ciphertext)?;
    let aad = envelope_aad(envelope)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| CoreError::AuthenticationFailed)?,
    );
    let document: migration::VaultDocument =
        serde_json::from_slice(&plaintext).map_err(|_| CoreError::InvalidVault)?;
    migration::migrate(document)
}

fn encrypt_document(
    document: &migration::VaultDocument,
    key: &VaultKey,
    aad: &[u8],
) -> Result<(String, String), CoreError> {
    let nonce = random_bytes::<NONCE_BYTES>()?;
    let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| CoreError::InvalidVault)?;
    let mut plaintext =
        Zeroizing::new(serde_json::to_vec(document).map_err(|_| CoreError::InvalidVault)?);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(|_| CoreError::AuthenticationFailed)?;
    plaintext.zeroize();
    Ok((
        STANDARD_NO_PAD.encode(nonce),
        STANDARD_NO_PAD.encode(ciphertext),
    ))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    let parent = path
        .parent()
        .ok_or_else(|| CoreError::InvalidRequest("资料库路径缺少父目录".to_owned()))?;
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension("vault.tmp");
    if temporary.is_file() {
        // A prior process may have stopped after syncing the temporary but
        // before the atomic rename. It is never a committed vault version.
        fs::remove_file(&temporary)?;
    }
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> Result<(), CoreError> {
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        if let Ok(directory) = OpenOptions::new().read(true).open(parent) {
            directory.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

impl VaultStore for EncryptedContainerVault {
    fn backend(&self) -> VaultBackend {
        VaultBackend::EncryptedContainer
    }

    fn exists(&self, path: &Path) -> bool {
        path.is_file()
    }

    fn create(&self, path: &Path, passphrase: &str) -> Result<VaultKey, CoreError> {
        validate_passphrase(passphrase)?;
        if path.exists() {
            return Err(CoreError::VaultAlreadyExists);
        }
        let salt = random_bytes::<SALT_BYTES>()?;
        let key = derive_key(passphrase, &salt)?;
        let (nonce, ciphertext) =
            encrypt_document(&migration::VaultDocument::default(), &key, PASSPHRASE_AAD)?;
        let envelope = ContainerEnvelope {
            format: PASSPHRASE_CONTAINER_FORMAT.to_owned(),
            kdf: PASSPHRASE_KDF.to_owned(),
            cipher: CIPHER.to_owned(),
            schema_version: CURRENT_SCHEMA_VERSION,
            salt: Some(STANDARD_NO_PAD.encode(salt)),
            nonce,
            ciphertext,
        };
        let serialized = serde_json::to_vec(&envelope).map_err(|_| CoreError::InvalidVault)?;
        atomic_write(path, &serialized)?;
        Ok(key)
    }

    fn unlock(&self, path: &Path, passphrase: &str) -> Result<(VaultKey, u32), CoreError> {
        validate_passphrase(passphrase)?;
        let envelope = read_envelope(path)?;
        if envelope.format != PASSPHRASE_CONTAINER_FORMAT || envelope.kdf != PASSPHRASE_KDF {
            return Err(CoreError::InvalidVault);
        }
        let salt = decode(envelope.salt.as_deref().ok_or(CoreError::InvalidVault)?)?;
        if salt.len() != SALT_BYTES {
            return Err(CoreError::InvalidVault);
        }
        let key = derive_key(passphrase, &salt)?;
        let migrated = decrypt_document(&envelope, &key)?;
        Ok((key, migrated.schema_version))
    }

    fn create_with_key(&self, path: &Path, key: &VaultKey) -> Result<(), CoreError> {
        if path.exists() {
            return Err(CoreError::VaultAlreadyExists);
        }
        let aad = direct_key_aad(CURRENT_SCHEMA_VERSION);
        let (nonce, ciphertext) =
            encrypt_document(&migration::VaultDocument::default(), key, &aad)?;
        let envelope = ContainerEnvelope {
            format: DIRECT_KEY_CONTAINER_FORMAT.to_owned(),
            kdf: DIRECT_KEY_KDF.to_owned(),
            cipher: CIPHER.to_owned(),
            schema_version: CURRENT_SCHEMA_VERSION,
            salt: None,
            nonce,
            ciphertext,
        };
        let serialized = serde_json::to_vec(&envelope).map_err(|_| CoreError::InvalidVault)?;
        atomic_write(path, &serialized)
    }

    fn unlock_with_key(&self, path: &Path, key: &VaultKey) -> Result<u32, CoreError> {
        let envelope = read_envelope(path)?;
        if envelope.format != DIRECT_KEY_CONTAINER_FORMAT || envelope.kdf != DIRECT_KEY_KDF {
            return Err(CoreError::InvalidVault);
        }
        Ok(decrypt_document(&envelope, key)?.schema_version)
    }

    fn read_document(
        &self,
        path: &Path,
        key: &VaultKey,
    ) -> Result<migration::VaultDocument, CoreError> {
        decrypt_document(&read_envelope(path)?, key)
    }

    fn write_document(
        &self,
        path: &Path,
        key: &VaultKey,
        document: &migration::VaultDocument,
    ) -> Result<(), CoreError> {
        let mut envelope = read_envelope(path)?;
        envelope.schema_version = document.schema_version;
        let aad = envelope_aad(&envelope)?;
        let (nonce, ciphertext) = encrypt_document(document, key, &aad)?;
        envelope.nonce = nonce;
        envelope.ciphertext = ciphertext;
        let serialized = serde_json::to_vec(&envelope).map_err(|_| CoreError::InvalidVault)?;
        atomic_write(path, &serialized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn direct_key(value: u8) -> VaultKey {
        VaultKey::new([value; 32])
    }

    #[test]
    fn container_is_authenticated_and_contains_no_plaintext_passphrase() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("vault.data");
        let store = EncryptedContainerVault;
        let passphrase = "fictitious-long-passphrase";
        store.create(&path, passphrase).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(!bytes
            .windows(passphrase.len())
            .any(|part| part == passphrase.as_bytes()));
        assert!(store.unlock(&path, passphrase).is_ok());
        assert!(matches!(
            store.unlock(&path, "wrong-fictitious-passphrase"),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn tampering_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("vault.data");
        let store = EncryptedContainerVault;
        store.create(&path, "fictitious-long-passphrase").unwrap();
        let mut envelope: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        envelope["ciphertext"] = serde_json::Value::String("AAAA".to_owned());
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();
        assert!(matches!(
            store.unlock(&path, "fictitious-long-passphrase"),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn direct_key_container_is_versioned_authenticated_and_has_no_plaintext() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("direct.vault");
        let store = EncryptedContainerVault;
        let key = direct_key(0xa5);
        store.create_with_key(&path, &key).unwrap();

        let mut document = store.read_document(&path, &key).unwrap();
        document.project = serde_json::json!({
            "title": "虚构敏感项目",
            "token": "not-a-real-secret"
        });
        document.revision = 1;
        store.write_document(&path, &key, &document).unwrap();

        let serialized = fs::read(&path).unwrap();
        let envelope: serde_json::Value = serde_json::from_slice(&serialized).unwrap();
        assert_eq!(envelope["format"], DIRECT_KEY_CONTAINER_FORMAT);
        assert_eq!(envelope["kdf"], DIRECT_KEY_KDF);
        assert!(envelope.get("salt").is_none());
        assert!(!serialized
            .windows("虚构敏感项目".len())
            .any(|part| part == "虚构敏感项目".as_bytes()));
        let encoded_key = STANDARD_NO_PAD.encode(key.bytes());
        assert!(!serialized
            .windows(encoded_key.len())
            .any(|part| part == encoded_key.as_bytes()));

        assert_eq!(
            store.unlock_with_key(&path, &key).unwrap(),
            CURRENT_SCHEMA_VERSION
        );
        assert_eq!(
            store.read_document(&path, &key).unwrap().project["title"],
            "虚构敏感项目"
        );
        assert!(matches!(
            store.unlock_with_key(&path, &direct_key(0xa6)),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn direct_key_ciphertext_tampering_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("direct.vault");
        let store = EncryptedContainerVault;
        let key = direct_key(31);
        store.create_with_key(&path, &key).unwrap();

        let mut envelope: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let ciphertext = envelope["ciphertext"].as_str().unwrap();
        let mut tampered = ciphertext.as_bytes().to_vec();
        tampered[0] = if tampered[0] == b'A' { b'B' } else { b'A' };
        envelope["ciphertext"] = serde_json::Value::String(String::from_utf8(tampered).unwrap());
        fs::write(&path, serde_json::to_vec(&envelope).unwrap()).unwrap();

        assert!(matches!(
            store.unlock_with_key(&path, &key),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn direct_and_passphrase_formats_cannot_be_confused() {
        let directory = tempfile::tempdir().unwrap();
        let direct_path = directory.path().join("direct.vault");
        let passphrase_path = directory.path().join("passphrase.vault");
        let store = EncryptedContainerVault;
        let key = direct_key(9);
        store.create_with_key(&direct_path, &key).unwrap();
        store
            .create(&passphrase_path, "fictitious-long-passphrase")
            .unwrap();

        assert!(matches!(
            store.unlock(&direct_path, "fictitious-long-passphrase"),
            Err(CoreError::InvalidVault)
        ));
        assert!(matches!(
            store.unlock_with_key(&passphrase_path, &key),
            Err(CoreError::InvalidVault)
        ));
    }
}
