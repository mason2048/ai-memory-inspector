const COMMANDS: &[&str] = &[
    "memory_inspector_vault_status",
    "memory_inspector_vault_unlock_with_system",
    "memory_inspector_vault_lock",
    "memory_inspector_project_read",
    "memory_inspector_project_write",
    "memory_inspector_project_clear",
    "memory_inspector_import_pick_and_read",
    "memory_inspector_backup_export",
    "memory_inspector_backup_restore",
];

fn main() {
    // The reviewed checked-in icon set is generated from the documented
    // 1024px source. Do not rewrite tracked assets during a build: a build
    // must be a reproducible read of source, not a mutation of the candidate.
    let icon = std::path::Path::new("icons/icon.png");
    assert!(icon.is_file(), "missing required Tauri icon");
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to build Tauri application metadata");
}
