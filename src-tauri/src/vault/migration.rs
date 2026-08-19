use crate::error::CoreError;
use serde::{Deserialize, Serialize};

use super::CURRENT_SCHEMA_VERSION;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDocument {
    pub schema_version: u32,
    /// Opaque, application-owned JSON document. Rust authenticates and
    /// versions it; the renderer never receives the encryption key.
    #[serde(default, alias = "records")]
    pub project: serde_json::Value,
    #[serde(default)]
    pub revision: u64,
    pub migrations: Vec<u32>,
}

impl Default for VaultDocument {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            project: serde_json::Value::Null,
            revision: 0,
            migrations: vec![CURRENT_SCHEMA_VERSION],
        }
    }
}

pub fn migrate(mut document: VaultDocument) -> Result<VaultDocument, CoreError> {
    if document.schema_version == 0 || document.schema_version > CURRENT_SCHEMA_VERSION {
        return Err(CoreError::MigrationFailed);
    }
    while document.schema_version < CURRENT_SCHEMA_VERSION {
        match document.schema_version {
            1 => {
                if document.project.is_array() {
                    document.project = serde_json::json!({
                        "version": 2,
                        "name": "已迁移的本地记忆检查",
                        "importedAt": "1970-01-01T00:00:00.000Z",
                        "records": document.project,
                        "dispositions": {},
                        "revisions": [],
                        "snapshots": [],
                        "manualCleanupIds": []
                    });
                }
                document.schema_version = 2;
            }
            _ => return Err(CoreError::MigrationFailed),
        }
        document.migrations.push(document.schema_version);
    }
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_future_schema() {
        let document = VaultDocument {
            schema_version: CURRENT_SCHEMA_VERSION + 1,
            project: serde_json::Value::Null,
            revision: 0,
            migrations: vec![],
        };
        assert!(matches!(migrate(document), Err(CoreError::MigrationFailed)));
    }

    #[test]
    fn migrates_legacy_records_array_into_a_complete_project() {
        let legacy = VaultDocument {
            schema_version: 1,
            project: serde_json::json!([{ "id": "fictional", "content": "demo" }]),
            revision: 4,
            migrations: vec![1],
        };
        let migrated = migrate(legacy).unwrap();
        assert_eq!(migrated.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(migrated.revision, 4);
        assert_eq!(migrated.project["version"], 2);
        assert!(migrated.project["records"].is_array());
        assert_eq!(migrated.migrations, vec![1, 2]);
    }
}
