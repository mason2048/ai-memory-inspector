#![forbid(unsafe_code)]

pub mod backup;
pub mod dto;
pub mod error;
pub mod import;
#[cfg(target_os = "macos")]
mod keychain;
pub mod limits;
pub mod secret;
pub mod vault;

pub use dto::{
    ImportFormat, ImportPreflightResponse, NativeImportFileResponse, NativeImportSelectionResponse,
    VaultBackupExportRequest, VaultBackupOperationResponse, VaultBackupRestoreRequest,
    VaultGatewayStatus, VaultLockState, VaultProjectClearRequest, VaultProjectResponse,
    VaultProjectWriteRequest, VaultStatus,
};
pub use error::{CoreError, ErrorCode};

use std::{
    fs::{File, OpenOptions},
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use vault::{EncryptedContainerVault, VaultController};

#[cfg(target_os = "macos")]
use keychain::{KeychainMasterKey, SystemKeychain};

#[derive(Clone)]
pub struct AppState {
    vault: Arc<VaultController>,
    unlock_guard: Arc<Mutex<()>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            vault: Arc::new(VaultController::new(EncryptedContainerVault)),
            unlock_guard: Arc::new(Mutex::new(())),
        }
    }
}

#[cfg(target_os = "macos")]
fn unlock_with_keychain(
    state: &AppState,
    vault_path: &Path,
) -> Result<VaultGatewayStatus, CoreError> {
    let _guard = state
        .unlock_guard
        .lock()
        .map_err(|_| CoreError::BackendUnavailable)?;
    let _process_guard = acquire_vault_process_lock(vault_path)?;
    if vault_path.exists() && !vault_path.is_file() {
        return Err(CoreError::InvalidVault);
    }
    let keychain = SystemKeychain::production();
    let master_key = match keychain.read_master_key()? {
        Some(key) => key,
        None if vault_path.is_file() => {
            // A vault without its ThisDeviceOnly key requires the independent
            // backup-recovery flow. Never generate a replacement key over it.
            return Err(CoreError::VaultLocked);
        }
        None => {
            let generated = KeychainMasterKey::generate()?;
            keychain.store_master_key(&generated)?;
            // Read through the protected Keychain immediately. This is the
            // first user-presence gate. A successful create-or-update call is
            // insufficient: only an exact readback of this generated key may
            // create the vault.
            generated.accept_verified_readback(keychain.read_master_key()?)?
        }
    };

    if vault_path.is_file() {
        state
            .vault
            .unlock_with_key(vault_path, master_key.into_vault_key())?;
    } else {
        state
            .vault
            .create_with_key(vault_path, master_key.into_vault_key())?;
    }
    Ok(state.vault.gateway_status())
}

struct VaultProcessGuard(File);

impl Drop for VaultProcessGuard {
    fn drop(&mut self) {
        let _ = fs4::FileExt::unlock(&self.0);
    }
}

fn acquire_vault_process_lock(vault_path: &Path) -> Result<VaultProcessGuard, CoreError> {
    let parent = vault_path
        .parent()
        .ok_or_else(|| CoreError::InvalidRequest("资料库路径缺少父目录".to_owned()))?;
    std::fs::create_dir_all(parent)?;
    let lock_path = parent.join("memory-inspector.lifecycle.lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)?;
    fs4::FileExt::lock(&file)?;
    Ok(VaultProcessGuard(file))
}

#[tauri::command]
fn memory_inspector_vault_status(state: State<'_, AppState>) -> VaultGatewayStatus {
    state.vault.gateway_status()
}

#[tauri::command]
async fn memory_inspector_vault_unlock_with_system(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<VaultGatewayStatus, CoreError> {
    #[cfg(target_os = "macos")]
    {
        let vault_path = app
            .path()
            .app_data_dir()
            .map_err(|_| CoreError::InvalidRequest("无法定位应用数据目录".to_owned()))?
            .join("memory-inspector.vault");
        let owned_state = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            unlock_with_keychain(&owned_state, &vault_path)
        })
        .await
        .map_err(|_| CoreError::BackendUnavailable)?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (state, app);
        Err(CoreError::NotImplemented)
    }
}

#[tauri::command]
fn memory_inspector_vault_lock(state: State<'_, AppState>) -> VaultGatewayStatus {
    let _guard = state
        .unlock_guard
        .lock()
        .expect("vault lifecycle mutex poisoned");
    state.vault.lock();
    state.vault.gateway_status()
}

fn vault_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, CoreError> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("memory-inspector.vault"))
        .map_err(|_| CoreError::InvalidRequest("无法定位应用数据目录".to_owned()))
}

#[tauri::command]
fn memory_inspector_project_read(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<VaultProjectResponse, CoreError> {
    let document = state.vault.read_project(&vault_path(&app)?)?;
    Ok(VaultProjectResponse {
        revision: document.revision,
        schema_version: document.schema_version,
        project: document.project,
    })
}

#[tauri::command]
fn memory_inspector_project_write(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: VaultProjectWriteRequest,
) -> Result<VaultProjectResponse, CoreError> {
    let serialized = serde_json::to_vec(&request.project)
        .map_err(|_| CoreError::InvalidRequest("项目无法序列化".to_owned()))?;
    if serialized.len() > limits::MAX_FILE_BYTES as usize {
        return Err(CoreError::FileTooLarge);
    }
    let document = state.vault.write_project(
        &vault_path(&app)?,
        request.expected_revision,
        request.project,
    )?;
    Ok(VaultProjectResponse {
        revision: document.revision,
        schema_version: document.schema_version,
        project: document.project,
    })
}

#[tauri::command]
fn memory_inspector_project_clear(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: VaultProjectClearRequest,
) -> Result<VaultProjectResponse, CoreError> {
    let document = state
        .vault
        .clear_project(&vault_path(&app)?, request.expected_revision)?;
    Ok(VaultProjectResponse {
        revision: document.revision,
        schema_version: document.schema_version,
        project: document.project,
    })
}

fn selected_native_path(
    path: tauri_plugin_dialog::FilePath,
) -> Result<std::path::PathBuf, CoreError> {
    path.into_path()
        .map_err(|_| CoreError::InvalidRequest("所选位置不是本机文件路径".to_owned()))
}

#[tauri::command]
async fn memory_inspector_import_pick_and_read(
    app: tauri::AppHandle,
) -> Result<NativeImportSelectionResponse, CoreError> {
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "可导入的记忆文件",
            &["md", "markdown", "txt", "json", "jsonl", "ndjson"],
        )
        .set_title("选择要在本机检查的记忆文件")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(NativeImportSelectionResponse::cancelled());
    };
    let path = selected_native_path(selected)?;
    let file = tauri::async_runtime::spawn_blocking(move || import::read_authorized_path(&path))
        .await
        .map_err(|_| CoreError::BackendUnavailable)??;
    Ok(NativeImportSelectionResponse::selected(file))
}

#[tauri::command]
async fn memory_inspector_backup_export(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: VaultBackupExportRequest,
) -> Result<VaultBackupOperationResponse, CoreError> {
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "AI Memory Inspector 加密备份",
            &[backup::BACKUP_FILE_EXTENSION],
        )
        .set_file_name("ai-memory-inspector-backup.amibackup")
        .set_title("导出完整加密备份")
        .blocking_save_file();
    let Some(selected) = selected else {
        return Ok(VaultBackupOperationResponse {
            completed: false,
            cancelled: true,
            revision: 0,
            schema_version: vault::CURRENT_SCHEMA_VERSION,
        });
    };
    let path = selected_native_path(selected)?;
    let document = state.vault.read_project(&vault_path(&app)?)?;
    let revision = document.revision;
    let schema_version = document.schema_version;
    tauri::async_runtime::spawn_blocking(move || {
        backup::backup_document_to_file(&path, &document, request.passphrase)
    })
    .await
    .map_err(|_| CoreError::BackendUnavailable)??;
    Ok(VaultBackupOperationResponse {
        completed: true,
        cancelled: false,
        revision,
        schema_version,
    })
}

#[tauri::command]
async fn memory_inspector_backup_restore(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    request: VaultBackupRestoreRequest,
) -> Result<VaultBackupOperationResponse, CoreError> {
    let selected = app
        .dialog()
        .file()
        .add_filter(
            "AI Memory Inspector 加密备份",
            &[backup::BACKUP_FILE_EXTENSION],
        )
        .set_title("恢复完整加密备份")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(VaultBackupOperationResponse {
            completed: false,
            cancelled: true,
            revision: 0,
            schema_version: vault::CURRENT_SCHEMA_VERSION,
        });
    };
    let path = selected_native_path(selected)?;
    let document = tauri::async_runtime::spawn_blocking(move || {
        backup::restore_document_from_file(&path, request.passphrase)
    })
    .await
    .map_err(|_| CoreError::BackendUnavailable)??;
    let restored = state.vault.restore_project(&vault_path(&app)?, document)?;
    Ok(VaultBackupOperationResponse {
        completed: true,
        cancelled: false,
        revision: restored.revision,
        schema_version: restored.schema_version,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Keep this first: a later plugin must never observe or initialize a
        // second process before the single-instance guard rejects it.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            app.manage(AppState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            memory_inspector_vault_status,
            memory_inspector_vault_unlock_with_system,
            memory_inspector_vault_lock,
            memory_inspector_project_read,
            memory_inspector_project_write,
            memory_inspector_project_clear,
            memory_inspector_import_pick_and_read,
            memory_inspector_backup_export,
            memory_inspector_backup_restore
        ])
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running AI Memory Inspector");
}
