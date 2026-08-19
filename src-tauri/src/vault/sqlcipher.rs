//! Optional SQLCipher backend primitives.
//!
//! This feature proves the crate can link a vendored SQLCipher build and apply
//! versioned schema migrations. It is deliberately not selected by the Tauri
//! commands yet: backup/rekey/recovery and OS-keychain integration remain
//! production blockers and are documented as incomplete.

use crate::error::CoreError;
use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroizing;

use super::CURRENT_SCHEMA_VERSION;

const MIGRATIONS: &[(u32, &str)] = &[
    (
        1,
        "CREATE TABLE IF NOT EXISTS vault_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);\
         CREATE TABLE IF NOT EXISTS encrypted_documents (id TEXT PRIMARY KEY NOT NULL, ciphertext BLOB NOT NULL, nonce BLOB NOT NULL, created_at TEXT NOT NULL);",
    ),
    (
        2,
        "INSERT OR IGNORE INTO vault_meta (key, value) VALUES ('project_schema', '2');",
    ),
];

pub fn open_and_migrate(path: &Path, key: &[u8; 32]) -> Result<Connection, CoreError> {
    let mut connection = Connection::open(path).map_err(|_| CoreError::InvalidVault)?;
    let key_hex = Zeroizing::new(
        key.iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    );
    connection
        .pragma_update(None, "key", format!("x'{}'", key_hex.as_str()))
        .map_err(|_| CoreError::AuthenticationFailed)?;
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))
        .map_err(|_| CoreError::AuthenticationFailed)?;
    let current: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| CoreError::MigrationFailed)?;
    if current > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::MigrationFailed);
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
        let transaction = connection
            .transaction()
            .map_err(|_| CoreError::MigrationFailed)?;
        transaction
            .execute_batch(sql)
            .map_err(|_| CoreError::MigrationFailed)?;
        transaction
            .pragma_update(None, "user_version", version)
            .map_err(|_| CoreError::MigrationFailed)?;
        transaction
            .commit()
            .map_err(|_| CoreError::MigrationFailed)?;
    }
    Ok(connection)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlcipher_migrations_are_versioned_and_keyed() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlcipher");
        let connection = open_and_migrate(&path, &[7_u8; 32]).unwrap();
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        drop(connection);
        assert!(open_and_migrate(&path, &[8_u8; 32]).is_err());
    }
}
