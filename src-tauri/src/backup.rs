//! Portable, passphrase-protected backups for the encrypted vault document.
//!
//! The device-bound Keychain key must never be exported. Instead, this module
//! serializes the already-unlocked vault document (or an opaque JSON payload)
//! and protects that plaintext with an independent user recovery passphrase.

use crate::{
    error::CoreError,
    limits::{MAX_FILE_BYTES, MAX_PASSPHRASE_BYTES, MIN_PASSPHRASE_BYTES},
    vault::migration::{self, VaultDocument},
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{
    engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

pub const BACKUP_FORMAT_VERSION: u32 = 1;
pub const BACKUP_FILE_EXTENSION: &str = "amibackup";

const BACKUP_FORMAT: &str = "ai-memory-inspector-portable-backup";
const KDF_NAME: &str = "argon2id-v19-m65536-t3-p1";
const CIPHER_NAME: &str = "aes-256-gcm";
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const GCM_TAG_BYTES: usize = 16;
const ARGON_MEMORY_KIB: u32 = 64 * 1024;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_LANES: u32 = 1;

/// The JSON envelope is Base64 encoded, so the on-disk limit needs room for
/// expansion over the authenticated plaintext limit.
pub const MAX_BACKUP_FILE_BYTES: u64 = 40 * 1024 * 1024;
pub const MAX_BACKUP_PLAINTEXT_BYTES: usize = MAX_FILE_BYTES as usize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupPayloadKind {
    VaultDocument,
    Json,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackupEnvelope {
    format: String,
    version: u32,
    payload_type: BackupPayloadKind,
    kdf: String,
    cipher: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

fn validate_passphrase(passphrase: &str) -> Result<(), CoreError> {
    if !(MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len()) {
        return Err(CoreError::InvalidPassphrase);
    }
    Ok(())
}

fn random_bytes<const N: usize>() -> Result<[u8; N], CoreError> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|error| CoreError::Io(std::io::Error::other(error.to_string())))?;
    Ok(bytes)
}

fn derive_key(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, CoreError> {
    let parameters = Params::new(ARGON_MEMORY_KIB, ARGON_ITERATIONS, ARGON_LANES, Some(32))
        .map_err(|_| CoreError::InvalidVault)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters);
    let mut key = Zeroizing::new([0_u8; 32]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| CoreError::AuthenticationFailed)?;
    Ok(key)
}

fn aad(payload_type: BackupPayloadKind) -> &'static [u8] {
    match payload_type {
        BackupPayloadKind::VaultDocument => b"AI Memory Inspector portable backup;version=1;payload=vault-document;kdf=argon2id-v19-m65536-t3-p1;cipher=aes-256-gcm",
        BackupPayloadKind::Json => b"AI Memory Inspector portable backup;version=1;payload=json;kdf=argon2id-v19-m65536-t3-p1;cipher=aes-256-gcm",
    }
}

fn validate_envelope(envelope: &BackupEnvelope) -> Result<(), CoreError> {
    if envelope.format != BACKUP_FORMAT
        || envelope.version != BACKUP_FORMAT_VERSION
        || envelope.kdf != KDF_NAME
        || envelope.cipher != CIPHER_NAME
    {
        return Err(CoreError::UnsupportedFormat);
    }
    Ok(())
}

fn decode_component(value: &str) -> Result<Vec<u8>, CoreError> {
    STANDARD_NO_PAD
        .decode(value)
        .map_err(|_| CoreError::InvalidVault)
}

fn parse_envelope(serialized: &[u8]) -> Result<BackupEnvelope, CoreError> {
    if serialized.len() as u64 > MAX_BACKUP_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    let envelope: BackupEnvelope =
        serde_json::from_slice(serialized).map_err(|_| CoreError::InvalidVault)?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}

fn encrypt_payload(
    plaintext: &[u8],
    payload_type: BackupPayloadKind,
    passphrase: String,
) -> Result<Vec<u8>, CoreError> {
    if plaintext.len() > MAX_BACKUP_PLAINTEXT_BYTES {
        return Err(CoreError::FileTooLarge);
    }

    // Take ownership of the caller's passphrase allocation so it is wiped on
    // every return path, including KDF, encryption, and serialization errors.
    let passphrase = Zeroizing::new(passphrase);
    validate_passphrase(&passphrase)?;
    let salt = random_bytes::<SALT_BYTES>()?;
    let nonce = random_bytes::<NONCE_BYTES>()?;
    let key = derive_key(&passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| CoreError::InvalidVault)?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: aad(payload_type),
            },
        )
        .map_err(|_| CoreError::AuthenticationFailed)?;

    let envelope = BackupEnvelope {
        format: BACKUP_FORMAT.to_owned(),
        version: BACKUP_FORMAT_VERSION,
        payload_type,
        kdf: KDF_NAME.to_owned(),
        cipher: CIPHER_NAME.to_owned(),
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce),
        ciphertext: STANDARD_NO_PAD.encode(ciphertext),
    };
    let serialized = serde_json::to_vec(&envelope).map_err(|_| CoreError::InvalidVault)?;
    if serialized.len() as u64 > MAX_BACKUP_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    Ok(serialized)
}

fn decrypt_payload(
    serialized: &[u8],
    passphrase: String,
) -> Result<(BackupPayloadKind, Zeroizing<Vec<u8>>), CoreError> {
    let envelope = parse_envelope(serialized)?;
    let salt = decode_component(&envelope.salt)?;
    let nonce = decode_component(&envelope.nonce)?;
    if salt.len() != SALT_BYTES || nonce.len() != NONCE_BYTES {
        return Err(CoreError::InvalidVault);
    }

    let ciphertext = decode_component(&envelope.ciphertext)?;
    if ciphertext.len() > MAX_BACKUP_PLAINTEXT_BYTES.saturating_add(GCM_TAG_BYTES) {
        return Err(CoreError::FileTooLarge);
    }

    let passphrase = Zeroizing::new(passphrase);
    validate_passphrase(&passphrase)?;
    let key = derive_key(&passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| CoreError::InvalidVault)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: aad(envelope.payload_type),
                },
            )
            .map_err(|_| CoreError::AuthenticationFailed)?,
    );
    if plaintext.len() > MAX_BACKUP_PLAINTEXT_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    Ok((envelope.payload_type, plaintext))
}

/// Encrypt an unlocked vault document with an independent recovery
/// passphrase. The device-bound vault key is not part of the backup.
pub fn backup_document(document: &VaultDocument, passphrase: String) -> Result<Vec<u8>, CoreError> {
    let mut plaintext =
        Zeroizing::new(serde_json::to_vec(document).map_err(|_| CoreError::InvalidVault)?);
    let result = encrypt_payload(&plaintext, BackupPayloadKind::VaultDocument, passphrase);
    plaintext.zeroize();
    result
}

/// Authenticate, decrypt, deserialize, and migrate a portable vault backup.
pub fn restore_document(serialized: &[u8], passphrase: String) -> Result<VaultDocument, CoreError> {
    let (payload_type, plaintext) = decrypt_payload(serialized, passphrase)?;
    if payload_type != BackupPayloadKind::VaultDocument {
        return Err(CoreError::UnsupportedFormat);
    }
    let document = serde_json::from_slice(&plaintext).map_err(|_| CoreError::InvalidVault)?;
    migration::migrate(document)
}

/// Encrypt an opaque JSON payload for callers that do not need the vault
/// document schema. JSON is still authenticated and subject to the same size
/// limits.
pub fn backup_json(payload: &serde_json::Value, passphrase: String) -> Result<Vec<u8>, CoreError> {
    let mut plaintext =
        Zeroizing::new(serde_json::to_vec(payload).map_err(|_| CoreError::InvalidVault)?);
    let result = encrypt_payload(&plaintext, BackupPayloadKind::Json, passphrase);
    plaintext.zeroize();
    result
}

pub fn restore_json(serialized: &[u8], passphrase: String) -> Result<serde_json::Value, CoreError> {
    let (payload_type, plaintext) = decrypt_payload(serialized, passphrase)?;
    if payload_type != BackupPayloadKind::Json {
        return Err(CoreError::UnsupportedFormat);
    }
    serde_json::from_slice(&plaintext).map_err(|_| CoreError::InvalidVault)
}

fn read_limited(path: &Path) -> Result<Vec<u8>, CoreError> {
    if !path.is_file() {
        return Err(CoreError::VaultNotFound);
    }
    if fs::metadata(path)?.len() > MAX_BACKUP_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }

    // The bounded read also protects against a file growing between metadata
    // inspection and reading.
    let file = File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_BACKUP_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BACKUP_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    Ok(bytes)
}

fn temporary_path(path: &Path) -> Result<PathBuf, CoreError> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| CoreError::InvalidRequest("备份路径缺少有效文件名".to_owned()))?;
    let random = random_bytes::<12>()?;
    Ok(path.with_file_name(format!(".{name}.{}.tmp", URL_SAFE_NO_PAD.encode(random))))
}

fn atomic_write_with_hook<F>(path: &Path, bytes: &[u8], before_rename: F) -> Result<(), CoreError>
where
    F: FnOnce(&Path) -> std::io::Result<()>,
{
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = temporary_path(path)?;
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
        before_rename(&temporary)?;
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

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CoreError> {
    atomic_write_with_hook(path, bytes, |_| Ok(()))
}

pub fn backup_document_to_file(
    path: &Path,
    document: &VaultDocument,
    passphrase: String,
) -> Result<(), CoreError> {
    let serialized = backup_document(document, passphrase)?;
    atomic_write(path, &serialized)
}

pub fn restore_document_from_file(
    path: &Path,
    passphrase: String,
) -> Result<VaultDocument, CoreError> {
    restore_document(&read_limited(path)?, passphrase)
}

pub fn backup_json_to_file(
    path: &Path,
    payload: &serde_json::Value,
    passphrase: String,
) -> Result<(), CoreError> {
    let serialized = backup_json(payload, passphrase)?;
    atomic_write(path, &serialized)
}

pub fn restore_json_from_file(
    path: &Path,
    passphrase: String,
) -> Result<serde_json::Value, CoreError> {
    restore_json(&read_limited(path)?, passphrase)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSPHRASE: &str = "fictional recovery phrase 2026";

    fn fictional_document() -> VaultDocument {
        VaultDocument {
            schema_version: crate::vault::CURRENT_SCHEMA_VERSION,
            project: serde_json::json!({
                "name": "虚构测试项目",
                "records": [{ "id": "demo-1", "content": "not real user data" }]
            }),
            revision: 7,
            migrations: vec![crate::vault::CURRENT_SCHEMA_VERSION],
        }
    }

    #[test]
    fn document_round_trip_is_portable_and_contains_no_plaintext() {
        let document = fictional_document();
        let backup = backup_document(&document, PASSPHRASE.to_owned()).unwrap();
        assert!(!backup
            .windows("虚构测试项目".len())
            .any(|window| window == "虚构测试项目".as_bytes()));
        assert!(!backup
            .windows(PASSPHRASE.len())
            .any(|window| window == PASSPHRASE.as_bytes()));

        let envelope: BackupEnvelope = serde_json::from_slice(&backup).unwrap();
        assert_eq!(envelope.format, BACKUP_FORMAT);
        assert_eq!(envelope.version, BACKUP_FORMAT_VERSION);
        assert_eq!(envelope.payload_type, BackupPayloadKind::VaultDocument);
        assert_eq!(
            restore_document(&backup, PASSPHRASE.to_owned()).unwrap(),
            document
        );
    }

    #[test]
    fn json_round_trip_rejects_cross_type_restore() {
        let payload = serde_json::json!({ "kind": "fictional", "items": [1, 2, 3] });
        let backup = backup_json(&payload, PASSPHRASE.to_owned()).unwrap();
        assert_eq!(
            restore_json(&backup, PASSPHRASE.to_owned()).unwrap(),
            payload
        );
        assert!(matches!(
            restore_document(&backup, PASSPHRASE.to_owned()),
            Err(CoreError::UnsupportedFormat)
        ));
    }

    #[test]
    fn wrong_passphrase_tampering_and_truncation_are_rejected() {
        let backup = backup_document(&fictional_document(), PASSPHRASE.to_owned()).unwrap();
        assert!(matches!(
            restore_document(&backup, "wrong fictional recovery phrase".to_owned()),
            Err(CoreError::AuthenticationFailed)
        ));

        let mut envelope: BackupEnvelope = serde_json::from_slice(&backup).unwrap();
        let mut ciphertext = STANDARD_NO_PAD.decode(&envelope.ciphertext).unwrap();
        ciphertext[0] ^= 0x40;
        envelope.ciphertext = STANDARD_NO_PAD.encode(ciphertext);
        let tampered = serde_json::to_vec(&envelope).unwrap();
        assert!(matches!(
            restore_document(&tampered, PASSPHRASE.to_owned()),
            Err(CoreError::AuthenticationFailed)
        ));

        assert!(matches!(
            restore_document(&backup[..backup.len() / 2], PASSPHRASE.to_owned()),
            Err(CoreError::InvalidVault)
        ));
    }

    #[test]
    fn authenticated_payload_type_cannot_be_changed() {
        let backup = backup_document(&fictional_document(), PASSPHRASE.to_owned()).unwrap();
        let mut envelope: BackupEnvelope = serde_json::from_slice(&backup).unwrap();
        envelope.payload_type = BackupPayloadKind::Json;
        let tampered = serde_json::to_vec(&envelope).unwrap();
        assert!(matches!(
            restore_json(&tampered, PASSPHRASE.to_owned()),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn unknown_version_and_unrecognized_fields_are_rejected() {
        let backup = backup_document(&fictional_document(), PASSPHRASE.to_owned()).unwrap();
        let mut envelope: serde_json::Value = serde_json::from_slice(&backup).unwrap();
        envelope["version"] = serde_json::json!(BACKUP_FORMAT_VERSION + 1);
        assert!(matches!(
            restore_document(
                &serde_json::to_vec(&envelope).unwrap(),
                PASSPHRASE.to_owned()
            ),
            Err(CoreError::UnsupportedFormat)
        ));

        envelope["version"] = serde_json::json!(BACKUP_FORMAT_VERSION);
        envelope["unexpected"] = serde_json::json!(true);
        assert!(matches!(
            restore_document(
                &serde_json::to_vec(&envelope).unwrap(),
                PASSPHRASE.to_owned()
            ),
            Err(CoreError::InvalidVault)
        ));
    }

    #[test]
    fn file_api_is_atomic_private_and_bounded() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join(format!("portable.{BACKUP_FILE_EXTENSION}"));
        let document = fictional_document();
        backup_document_to_file(&path, &document, PASSPHRASE.to_owned()).unwrap();
        assert_eq!(
            restore_document_from_file(&path, PASSPHRASE.to_owned()).unwrap(),
            document
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        let oversized = directory.path().join("oversized.amibackup");
        let file = File::create(&oversized).unwrap();
        file.set_len(MAX_BACKUP_FILE_BYTES + 1).unwrap();
        assert!(matches!(
            restore_document_from_file(&oversized, PASSPHRASE.to_owned()),
            Err(CoreError::FileTooLarge)
        ));
    }

    #[test]
    fn failed_atomic_write_preserves_previous_backup_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.amibackup");
        let original = b"previous committed backup";
        fs::write(&path, original).unwrap();

        let result = atomic_write_with_hook(&path, b"replacement", |_| {
            Err(std::io::Error::other("injected failure before rename"))
        });
        assert!(matches!(result, Err(CoreError::Io(_))));
        assert_eq!(fs::read(&path).unwrap(), original);
        let leftovers = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn passphrase_and_plaintext_limits_are_enforced_before_expensive_work() {
        assert!(matches!(
            backup_json(&serde_json::json!({}), "too-short".to_owned()),
            Err(CoreError::InvalidPassphrase)
        ));
        let oversized = serde_json::Value::String("x".repeat(MAX_BACKUP_PLAINTEXT_BYTES + 1));
        assert!(matches!(
            backup_json(&oversized, PASSPHRASE.to_owned()),
            Err(CoreError::FileTooLarge)
        ));
    }
}
