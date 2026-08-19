mod container;
pub mod migration;

#[cfg(feature = "sqlcipher")]
pub mod sqlcipher;

pub use container::EncryptedContainerVault;
use migration::VaultDocument;

use crate::{
    dto::{VaultGatewayStatus, VaultLockState, VaultStatus},
    error::CoreError,
};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const CURRENT_SCHEMA_VERSION: u32 = 2;
const PROJECT_STATE_VERSION: u64 = 2;
const MAX_CHECKPOINT_BYTES: u64 = 40 * 1024 * 1024;
const CHECKPOINT_TEMP_ATTEMPTS: usize = 16;

fn invalid_project_state() -> CoreError {
    CoreError::UnsupportedFormat
}

/// Backup authentication protects bytes, not application compatibility. Keep
/// this check in the native restore boundary so an older or future renderer
/// can never commit a project shape it does not understand.
fn validate_project_state_v2(project: &serde_json::Value) -> Result<(), CoreError> {
    let object = project.as_object().ok_or_else(invalid_project_state)?;
    let allowed = [
        "version",
        "name",
        "importedAt",
        "records",
        "dispositions",
        "revisions",
        "snapshots",
        "manualCleanupIds",
        "customRuleSet",
        "searchIndex",
    ];
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || object.get("version").and_then(serde_json::Value::as_u64) != Some(PROJECT_STATE_VERSION)
        || !object.get("name").is_some_and(serde_json::Value::is_string)
        || !object
            .get("importedAt")
            .is_some_and(serde_json::Value::is_string)
    {
        return Err(invalid_project_state());
    }

    let records = object
        .get("records")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid_project_state)?;
    if !records.iter().all(serde_json::Value::is_object) {
        return Err(invalid_project_state());
    }
    let dispositions = object
        .get("dispositions")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(invalid_project_state)?;
    if !dispositions.values().all(|value| {
        matches!(
            value.as_str(),
            Some("unreviewed" | "keep" | "ignore" | "suggest-delete" | "corrected")
        )
    }) {
        return Err(invalid_project_state());
    }
    for field in ["revisions", "snapshots"] {
        let values = object
            .get(field)
            .and_then(serde_json::Value::as_array)
            .ok_or_else(invalid_project_state)?;
        if !values.iter().all(serde_json::Value::is_object) {
            return Err(invalid_project_state());
        }
    }
    let cleanup_ids = object
        .get("manualCleanupIds")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(invalid_project_state)?;
    if !cleanup_ids.iter().all(serde_json::Value::is_string) {
        return Err(invalid_project_state());
    }
    if object.get("searchIndex").is_some_and(|value| {
        value
            .as_array()
            .is_none_or(|entries| !entries.iter().all(serde_json::Value::is_object))
    }) {
        return Err(invalid_project_state());
    }
    Ok(())
}

fn pre_restore_checkpoint_path(vault_path: &Path) -> PathBuf {
    vault_path.with_extension("pre-restore.vault")
}

fn validate_checkpoint_file(metadata: &fs::Metadata) -> Result<(), CoreError> {
    if !metadata.file_type().is_file() {
        return Err(CoreError::InvalidVault);
    }
    if metadata.len() > MAX_CHECKPOINT_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 || metadata.mode() & 0o777 != 0o600 {
            return Err(CoreError::InvalidVault);
        }
    }
    Ok(())
}

fn validate_checkpoint_target(path: &Path) -> Result<(), CoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_checkpoint_file(&metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CoreError::Io(error)),
    }
}

fn create_random_checkpoint_temporary(parent: &Path) -> Result<(PathBuf, File), CoreError> {
    for _ in 0..CHECKPOINT_TEMP_ATTEMPTS {
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random)
            .map_err(|error| CoreError::Io(io::Error::other(error.to_string())))?;
        let path = parent.join(format!(
            ".memory-inspector-pre-restore-{:032x}.tmp",
            u128::from_le_bytes(random)
        ));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(CoreError::Io(error)),
        }
    }
    Err(CoreError::Io(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "unable to allocate a private pre-restore temporary file",
    )))
}

fn open_checkpoint_source(vault_path: &Path) -> Result<(File, fs::Metadata), CoreError> {
    let path_metadata = fs::symlink_metadata(vault_path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            CoreError::VaultNotFound
        } else {
            CoreError::Io(error)
        }
    })?;
    validate_checkpoint_file(&path_metadata)?;

    let mut options = OpenOptions::new();
    options.read(true);
    // Prevent the path from being swapped to a symlink between the metadata
    // check and open. O_NOFOLLOW is 0x100 on Darwin.
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(0x100);
    }
    let source = options.open(vault_path)?;
    let opened_metadata = source.metadata()?;
    validate_checkpoint_file(&opened_metadata)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if path_metadata.dev() != opened_metadata.dev()
            || path_metadata.ino() != opened_metadata.ino()
        {
            return Err(CoreError::InvalidVault);
        }
    }
    Ok((source, opened_metadata))
}

fn create_pre_restore_checkpoint(vault_path: &Path) -> Result<PathBuf, CoreError> {
    let parent = vault_path
        .parent()
        .ok_or_else(|| CoreError::InvalidRequest("资料库路径缺少父目录".to_owned()))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.file_type().is_dir() {
        return Err(CoreError::InvalidVault);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if parent_metadata.mode() & 0o022 != 0 {
            return Err(CoreError::InvalidVault);
        }
    }
    let checkpoint = pre_restore_checkpoint_path(vault_path);
    validate_checkpoint_target(&checkpoint)?;
    let (mut source, source_metadata) = open_checkpoint_source(vault_path)?;
    let (temporary, mut destination) = create_random_checkpoint_temporary(parent)?;

    let result = (|| -> Result<(), CoreError> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            destination.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        let copied = {
            let mut limited_source = Read::take(&mut source, MAX_CHECKPOINT_BYTES + 1);
            io::copy(&mut limited_source, &mut destination)?
        };
        if copied > MAX_CHECKPOINT_BYTES {
            return Err(CoreError::FileTooLarge);
        }
        if copied != source_metadata.len() || source.metadata()?.len() != source_metadata.len() {
            return Err(CoreError::InvalidVault);
        }
        destination.flush()?;
        destination.sync_all()?;
        validate_checkpoint_file(&destination.metadata()?)?;
        // A target changed to a symlink, directory, hardlink, or unsafe file
        // while copying is rejected. A change after this check is still safe:
        // rename replaces the directory entry and never follows its target.
        validate_checkpoint_target(&checkpoint)?;
        fs::rename(&temporary, &checkpoint)?;
        let directory = OpenOptions::new().read(true).open(parent)?;
        directory.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(checkpoint)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultBackend {
    EncryptedContainer,
    #[cfg(feature = "sqlcipher")]
    Sqlcipher,
}

impl VaultBackend {
    pub const fn name(self) -> &'static str {
        match self {
            Self::EncryptedContainer => "encrypted-container-aes256gcm",
            #[cfg(feature = "sqlcipher")]
            Self::Sqlcipher => "sqlcipher-feature",
        }
    }
}

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct VaultKey([u8; 32]);

impl VaultKey {
    pub(crate) fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub(crate) fn bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

pub trait VaultStore: Send + Sync + 'static {
    fn backend(&self) -> VaultBackend;
    fn exists(&self, path: &Path) -> bool;
    /// Creates the legacy passphrase-derived container format.
    ///
    /// Kept so an explicit migration/recovery flow can continue opening v1
    /// containers. Device-key production flows should use `create_with_key`.
    fn create(&self, path: &Path, passphrase: &str) -> Result<VaultKey, CoreError>;
    /// Unlocks the legacy passphrase-derived container format.
    fn unlock(&self, path: &Path, passphrase: &str) -> Result<(VaultKey, u32), CoreError>;
    /// Creates a container using an already generated 256-bit master key.
    ///
    /// The key is borrowed so the store never needs to duplicate it. The
    /// controller consumes the owner and keeps it only for the unlocked
    /// session.
    fn create_with_key(&self, path: &Path, key: &VaultKey) -> Result<(), CoreError>;
    /// Authenticates a direct-key container and returns its schema version.
    fn unlock_with_key(&self, path: &Path, key: &VaultKey) -> Result<u32, CoreError>;
    fn read_document(&self, path: &Path, key: &VaultKey) -> Result<VaultDocument, CoreError>;
    fn write_document(
        &self,
        path: &Path,
        key: &VaultKey,
        document: &VaultDocument,
    ) -> Result<(), CoreError>;
}

#[derive(Default)]
struct LockState {
    key: Option<VaultKey>,
    schema_version: u32,
}

pub struct VaultController {
    store: Box<dyn VaultStore>,
    state: Mutex<LockState>,
}

impl VaultController {
    pub fn new(store: impl VaultStore) -> Self {
        Self {
            store: Box::new(store),
            state: Mutex::new(LockState::default()),
        }
    }

    pub fn status_for(&self, path: &Path) -> VaultStatus {
        let state = self.state.lock().expect("vault state mutex poisoned");
        VaultStatus {
            exists: self.store.exists(path),
            locked: state.key.is_none(),
            schema_version: state.schema_version,
            backend: self.store.backend().name(),
        }
    }

    pub fn status(&self) -> VaultStatus {
        let state = self.state.lock().expect("vault state mutex poisoned");
        VaultStatus {
            exists: state.schema_version > 0,
            locked: state.key.is_none(),
            schema_version: state.schema_version,
            backend: self.store.backend().name(),
        }
    }

    pub fn gateway_status(&self) -> VaultGatewayStatus {
        let state = self.state.lock().expect("vault state mutex poisoned");
        VaultGatewayStatus {
            state: if state.key.is_some() {
                VaultLockState::Unlocked
            } else {
                VaultLockState::Locked
            },
            changed_at: None,
        }
    }

    pub fn create(&self, path: &Path, mut passphrase: String) -> Result<(), CoreError> {
        let result = self.store.create(path, &passphrase);
        passphrase.zeroize();
        let key = result?;
        let mut state = self.state.lock().expect("vault state mutex poisoned");
        state.key = Some(key);
        state.schema_version = CURRENT_SCHEMA_VERSION;
        Ok(())
    }

    pub fn unlock(&self, path: &Path, mut passphrase: String) -> Result<(), CoreError> {
        let result = self.store.unlock(path, &passphrase);
        passphrase.zeroize();
        let (key, version) = result?;
        let mut state = self.state.lock().expect("vault state mutex poisoned");
        state.key = Some(key);
        state.schema_version = version;
        Ok(())
    }

    pub fn create_with_key(&self, path: &Path, key: VaultKey) -> Result<(), CoreError> {
        self.store.create_with_key(path, &key)?;
        let mut state = self.state.lock().expect("vault state mutex poisoned");
        state.key = Some(key);
        state.schema_version = CURRENT_SCHEMA_VERSION;
        Ok(())
    }

    pub fn unlock_with_key(&self, path: &Path, key: VaultKey) -> Result<(), CoreError> {
        let version = self.store.unlock_with_key(path, &key)?;
        let mut state = self.state.lock().expect("vault state mutex poisoned");
        state.key = Some(key);
        state.schema_version = version;
        Ok(())
    }

    pub fn lock(&self) {
        let mut state = self.state.lock().expect("vault state mutex poisoned");
        state.key.take();
    }

    pub fn read_project(&self, path: &Path) -> Result<VaultDocument, CoreError> {
        let state = self.state.lock().expect("vault state mutex poisoned");
        let key = state.key.as_ref().ok_or(CoreError::VaultLocked)?;
        self.store.read_document(path, key)
    }

    pub fn write_project(
        &self,
        path: &Path,
        expected_revision: u64,
        project: serde_json::Value,
    ) -> Result<VaultDocument, CoreError> {
        // Only the dedicated clear command may persist a null project.
        validate_project_state_v2(&project)?;
        let state = self.state.lock().expect("vault state mutex poisoned");
        let key = state.key.as_ref().ok_or(CoreError::VaultLocked)?;
        let mut document = self.store.read_document(path, key)?;
        if document.revision != expected_revision {
            return Err(CoreError::RevisionConflict);
        }
        document.project = project;
        document.revision = document
            .revision
            .checked_add(1)
            .ok_or(CoreError::RevisionConflict)?;
        self.store.write_document(path, key, &document)?;
        Ok(document)
    }

    pub fn clear_project(
        &self,
        path: &Path,
        expected_revision: u64,
    ) -> Result<VaultDocument, CoreError> {
        let state = self.state.lock().expect("vault state mutex poisoned");
        let key = state.key.as_ref().ok_or(CoreError::VaultLocked)?;
        let mut document = self.store.read_document(path, key)?;
        if document.revision != expected_revision {
            return Err(CoreError::RevisionConflict);
        }
        document.project = serde_json::Value::Null;
        document.revision = document
            .revision
            .checked_add(1)
            .ok_or(CoreError::RevisionConflict)?;
        self.store.write_document(path, key, &document)?;
        Ok(document)
    }

    /// Authenticated restore replaces the complete logical document while
    /// preserving optimistic monotonicity for the running vault.
    pub fn restore_project(
        &self,
        path: &Path,
        mut restored: VaultDocument,
    ) -> Result<VaultDocument, CoreError> {
        let state = self.state.lock().expect("vault state mutex poisoned");
        let key = state.key.as_ref().ok_or(CoreError::VaultLocked)?;
        if restored.schema_version != CURRENT_SCHEMA_VERSION {
            return Err(CoreError::UnsupportedFormat);
        }
        if !restored.project.is_null() {
            validate_project_state_v2(&restored.project)?;
        }
        let current = self.store.read_document(path, key)?;
        restored.schema_version = CURRENT_SCHEMA_VERSION;
        restored.revision = current
            .revision
            .max(restored.revision)
            .checked_add(1)
            .ok_or(CoreError::RevisionConflict)?;
        if !restored.migrations.contains(&CURRENT_SCHEMA_VERSION) {
            restored.migrations.push(CURRENT_SCHEMA_VERSION);
        }
        // The current container was authenticated by read_document above and
        // is already encrypted by the device-bound key. Copying its raw bytes
        // produces a recoverable checkpoint without ever materializing a
        // second plaintext project. A checkpoint failure aborts the restore.
        let checkpoint_path = create_pre_restore_checkpoint(path)?;
        if self.store.read_document(&checkpoint_path, key)? != current {
            return Err(CoreError::InvalidVault);
        }
        self.store.write_document(path, key, &restored)?;
        Ok(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn direct_key(value: u8) -> VaultKey {
        VaultKey::new([value; 32])
    }

    fn project_state(name: &str) -> serde_json::Value {
        serde_json::json!({
            "version": 2,
            "name": name,
            "importedAt": "2026-08-13T00:00:00.000Z",
            "records": [],
            "dispositions": {},
            "revisions": [],
            "snapshots": [],
            "manualCleanupIds": []
        })
    }

    fn checkpoint_temporary_count(directory: &Path) -> usize {
        fs::read_dir(directory)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                name.starts_with(".memory-inspector-pre-restore-") && name.ends_with(".tmp")
            })
            .count()
    }

    #[test]
    fn controller_transitions_lock_state() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        assert!(controller.status_for(&path).locked);
        controller
            .create(&path, "correct horse battery staple".to_owned())
            .unwrap();
        assert!(!controller.status().locked);
        controller.lock();
        assert!(controller.status().locked);
        controller
            .unlock(&path, "correct horse battery staple".to_owned())
            .unwrap();
        assert!(!controller.status().locked);
    }

    #[test]
    fn project_writes_are_encrypted_versioned_and_conflict_safe() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("project.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        controller.create_with_key(&path, direct_key(17)).unwrap();

        let stored = controller
            .write_project(&path, 0, project_state("虚构项目"))
            .unwrap();
        assert_eq!(stored.revision, 1);
        assert_eq!(
            controller.read_project(&path).unwrap().project["name"],
            "虚构项目"
        );
        assert!(!std::fs::read(&path)
            .unwrap()
            .windows("虚构项目".len())
            .any(|part| part == "虚构项目".as_bytes()));
        assert!(matches!(
            controller.write_project(&path, 0, project_state("stale")),
            Err(CoreError::RevisionConflict)
        ));

        controller.clear_project(&path, 1).unwrap();
        let cleared = controller.read_project(&path).unwrap();
        assert_eq!(cleared.revision, 2);
        assert!(cleared.project.is_null());
        controller.lock();
        assert!(matches!(
            controller.read_project(&path),
            Err(CoreError::VaultLocked)
        ));
    }

    #[test]
    fn ordinary_write_rejects_null_invalid_and_future_projects() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("write-validation.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        controller.create_with_key(&path, direct_key(19)).unwrap();
        controller
            .write_project(&path, 0, project_state("preserved"))
            .unwrap();
        let before = fs::read(&path).unwrap();
        let mut future = project_state("future");
        future["version"] = serde_json::json!(3);
        let mut invalid = project_state("invalid");
        invalid["records"] = serde_json::json!({});

        for rejected in [serde_json::Value::Null, future, invalid] {
            assert!(matches!(
                controller.write_project(&path, 1, rejected),
                Err(CoreError::UnsupportedFormat)
            ));
            assert_eq!(fs::read(&path).unwrap(), before);
            assert_eq!(
                controller.read_project(&path).unwrap().project["name"],
                "preserved"
            );
        }
    }

    #[test]
    fn direct_key_controller_authenticates_and_locks() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("direct.vault");
        let controller = VaultController::new(EncryptedContainerVault);

        controller.create_with_key(&path, direct_key(23)).unwrap();
        assert!(!controller.status_for(&path).locked);
        controller.lock();
        assert!(matches!(
            controller.unlock_with_key(&path, direct_key(24)),
            Err(CoreError::AuthenticationFailed)
        ));
        assert!(controller.status_for(&path).locked);
        controller.unlock_with_key(&path, direct_key(23)).unwrap();
        assert!(!controller.status_for(&path).locked);
    }

    #[test]
    fn authenticated_restore_is_atomic_and_revision_monotonic() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("restore.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        controller.create_with_key(&path, direct_key(23)).unwrap();
        controller
            .write_project(&path, 0, project_state("current"))
            .unwrap();
        let original_container = fs::read(&path).unwrap();
        let restored = migration::VaultDocument {
            schema_version: CURRENT_SCHEMA_VERSION,
            project: project_state("restored"),
            revision: 0,
            migrations: vec![CURRENT_SCHEMA_VERSION],
        };
        let committed = controller.restore_project(&path, restored).unwrap();
        assert_eq!(committed.revision, 2);
        assert_eq!(
            controller.read_project(&path).unwrap().project["name"],
            "restored"
        );
        assert!(!std::fs::read(&path)
            .unwrap()
            .windows("restored".len())
            .any(|part| part == b"restored"));

        let checkpoint = pre_restore_checkpoint_path(&path);
        assert_eq!(fs::read(&checkpoint).unwrap(), original_container);
        let checkpoint_document = EncryptedContainerVault
            .read_document(&checkpoint, &direct_key(23))
            .unwrap();
        assert_eq!(checkpoint_document.project["name"], "current");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&checkpoint).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }

        let before_second_restore = fs::read(&path).unwrap();
        let cleared = controller
            .restore_project(
                &path,
                migration::VaultDocument {
                    schema_version: CURRENT_SCHEMA_VERSION,
                    project: serde_json::Value::Null,
                    revision: 0,
                    migrations: vec![CURRENT_SCHEMA_VERSION],
                },
            )
            .unwrap();
        assert_eq!(cleared.revision, 3);
        assert!(cleared.project.is_null());
        assert_eq!(fs::read(&checkpoint).unwrap(), before_second_restore);
        let checkpoint_count = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".pre-restore.vault")
            })
            .count();
        assert_eq!(checkpoint_count, 1);
        assert_eq!(checkpoint_temporary_count(directory.path()), 0);
    }

    #[test]
    fn restore_rejects_unsupported_project_shapes_without_touching_vault() {
        let invalid_projects = [
            serde_json::json!([]),
            serde_json::json!({
                "version": 3,
                "name": "future",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": {},
                "revisions": [],
                "snapshots": [],
                "manualCleanupIds": []
            }),
            serde_json::json!({
                "version": 2,
                "name": "wrong records",
                "importedAt": "2026-08-13",
                "records": {},
                "dispositions": {},
                "revisions": [],
                "snapshots": [],
                "manualCleanupIds": []
            }),
            serde_json::json!({
                "version": 2,
                "name": "wrong dispositions",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": [],
                "revisions": [],
                "snapshots": [],
                "manualCleanupIds": []
            }),
            serde_json::json!({
                "version": 2,
                "name": "wrong revisions",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": {},
                "revisions": {},
                "snapshots": [],
                "manualCleanupIds": []
            }),
            serde_json::json!({
                "version": 2,
                "name": "wrong snapshots",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": {},
                "revisions": [],
                "snapshots": {},
                "manualCleanupIds": []
            }),
            serde_json::json!({
                "version": 2,
                "name": "wrong cleanup ids",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": {},
                "revisions": [],
                "snapshots": [],
                "manualCleanupIds": [7]
            }),
            serde_json::json!({
                "version": 2,
                "name": "unknown field",
                "importedAt": "2026-08-13",
                "records": [],
                "dispositions": {},
                "revisions": [],
                "snapshots": [],
                "manualCleanupIds": [],
                "futureField": true
            }),
        ];

        for (index, project) in invalid_projects.into_iter().enumerate() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("invalid-{index}.vault"));
            let controller = VaultController::new(EncryptedContainerVault);
            controller.create_with_key(&path, direct_key(42)).unwrap();
            controller
                .write_project(&path, 0, project_state("preserve me"))
                .unwrap();
            let before = fs::read(&path).unwrap();
            let restored = migration::VaultDocument {
                schema_version: CURRENT_SCHEMA_VERSION,
                project,
                revision: 0,
                migrations: vec![CURRENT_SCHEMA_VERSION],
            };

            assert!(matches!(
                controller.restore_project(&path, restored),
                Err(CoreError::UnsupportedFormat)
            ));
            assert_eq!(fs::read(&path).unwrap(), before);
            assert!(!pre_restore_checkpoint_path(&path).exists());
        }
    }

    #[test]
    fn checkpoint_failure_aborts_restore_and_preserves_current_vault() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("checkpoint-failure.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        controller.create_with_key(&path, direct_key(77)).unwrap();
        controller
            .write_project(&path, 0, project_state("preserved"))
            .unwrap();
        let before = fs::read(&path).unwrap();
        fs::create_dir(pre_restore_checkpoint_path(&path)).unwrap();
        let restored = migration::VaultDocument {
            schema_version: CURRENT_SCHEMA_VERSION,
            project: project_state("must not commit"),
            revision: 0,
            migrations: vec![CURRENT_SCHEMA_VERSION],
        };

        assert!(matches!(
            controller.restore_project(&path, restored),
            Err(CoreError::InvalidVault)
        ));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(
            controller.read_project(&path).unwrap().project["name"],
            "preserved"
        );
        assert!(pre_restore_checkpoint_path(&path).is_dir());
        assert_eq!(checkpoint_temporary_count(directory.path()), 0);
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_rejects_symlink_hardlink_and_unsafe_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        for attack in ["symlink", "hardlink", "permissions"] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("{attack}.vault"));
            let checkpoint = pre_restore_checkpoint_path(&path);
            let sentinel = directory.path().join(format!("{attack}.sentinel"));
            let controller = VaultController::new(EncryptedContainerVault);
            controller.create_with_key(&path, direct_key(91)).unwrap();
            controller
                .write_project(&path, 0, project_state("preserved"))
                .unwrap();
            let before = fs::read(&path).unwrap();
            fs::write(&sentinel, b"must remain unchanged").unwrap();
            fs::set_permissions(&sentinel, fs::Permissions::from_mode(0o600)).unwrap();
            match attack {
                "symlink" => symlink(&sentinel, &checkpoint).unwrap(),
                "hardlink" => fs::hard_link(&sentinel, &checkpoint).unwrap(),
                "permissions" => {
                    fs::write(&checkpoint, b"old unsafe checkpoint").unwrap();
                    fs::set_permissions(&checkpoint, fs::Permissions::from_mode(0o644)).unwrap();
                }
                _ => unreachable!(),
            }
            let restored = migration::VaultDocument {
                schema_version: CURRENT_SCHEMA_VERSION,
                project: project_state("must not commit"),
                revision: 0,
                migrations: vec![CURRENT_SCHEMA_VERSION],
            };

            assert!(matches!(
                controller.restore_project(&path, restored),
                Err(CoreError::InvalidVault)
            ));
            assert_eq!(fs::read(&path).unwrap(), before);
            assert_eq!(fs::read(&sentinel).unwrap(), b"must remain unchanged");
            assert_eq!(checkpoint_temporary_count(directory.path()), 0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn checkpoint_rejects_symlinked_or_hardlinked_source_vault() {
        use std::os::unix::fs::symlink;

        for attack in ["symlink", "hardlink"] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join(format!("{attack}.vault"));
            let actual = directory.path().join(format!("{attack}.actual"));
            let controller = VaultController::new(EncryptedContainerVault);
            controller.create_with_key(&path, direct_key(92)).unwrap();
            controller
                .write_project(&path, 0, project_state("preserved"))
                .unwrap();
            fs::rename(&path, &actual).unwrap();
            match attack {
                "symlink" => symlink(&actual, &path).unwrap(),
                "hardlink" => fs::hard_link(&actual, &path).unwrap(),
                _ => unreachable!(),
            }
            let actual_before = fs::read(&actual).unwrap();
            let restored = migration::VaultDocument {
                schema_version: CURRENT_SCHEMA_VERSION,
                project: project_state("must not commit"),
                revision: 0,
                migrations: vec![CURRENT_SCHEMA_VERSION],
            };

            assert!(matches!(
                controller.restore_project(&path, restored),
                Err(CoreError::InvalidVault)
            ));
            assert_eq!(fs::read(&actual).unwrap(), actual_before);
            assert!(!pre_restore_checkpoint_path(&path).exists());
            assert_eq!(checkpoint_temporary_count(directory.path()), 0);
        }
    }

    #[cfg(unix)]
    #[test]
    fn oversized_source_does_not_replace_existing_checkpoint() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oversized.vault");
        let checkpoint = pre_restore_checkpoint_path(&path);
        let source = File::create(&path).unwrap();
        source.set_len(MAX_CHECKPOINT_BYTES + 1).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&checkpoint, b"previous encrypted checkpoint").unwrap();
        fs::set_permissions(&checkpoint, fs::Permissions::from_mode(0o600)).unwrap();

        assert!(matches!(
            create_pre_restore_checkpoint(&path),
            Err(CoreError::FileTooLarge)
        ));
        assert_eq!(
            fs::read(&checkpoint).unwrap(),
            b"previous encrypted checkpoint"
        );
        assert_eq!(checkpoint_temporary_count(directory.path()), 0);
    }

    #[test]
    fn restore_rejects_future_vault_schema_before_creating_checkpoint() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("future-schema.vault");
        let controller = VaultController::new(EncryptedContainerVault);
        controller.create_with_key(&path, direct_key(88)).unwrap();
        controller
            .write_project(&path, 0, project_state("preserved"))
            .unwrap();
        let before = fs::read(&path).unwrap();
        let restored = migration::VaultDocument {
            schema_version: CURRENT_SCHEMA_VERSION + 1,
            project: project_state("future"),
            revision: 0,
            migrations: vec![CURRENT_SCHEMA_VERSION + 1],
        };

        assert!(matches!(
            controller.restore_project(&path, restored),
            Err(CoreError::UnsupportedFormat)
        ));
        assert_eq!(fs::read(&path).unwrap(), before);
        assert!(!pre_restore_checkpoint_path(&path).exists());
    }
}
