use crate::limits::SecurityLimits;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    Markdown,
    Text,
    Json,
    Jsonl,
    Ndjson,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreflightResponse {
    pub basename: String,
    pub format: ImportFormat,
    pub size_bytes: u64,
    pub estimated_records: u64,
    pub secret_findings: u64,
    pub contains_secret: bool,
    pub limits: SecurityLimits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportFileResponse {
    #[serde(flatten)]
    pub preflight: ImportPreflightResponse,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportSelectionResponse {
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<NativeImportFileResponse>,
}

impl NativeImportSelectionResponse {
    pub const fn cancelled() -> Self {
        Self {
            cancelled: true,
            file: None,
        }
    }

    pub const fn selected(file: NativeImportFileResponse) -> Self {
        Self {
            cancelled: false,
            file: Some(file),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub exists: bool,
    pub locked: bool,
    pub schema_version: u32,
    pub backend: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultLockState {
    Locked,
    Unlocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultGatewayStatus {
    pub state: VaultLockState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultProjectResponse {
    pub revision: u64,
    pub schema_version: u32,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultProjectWriteRequest {
    pub expected_revision: u64,
    pub project: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultProjectClearRequest {
    pub expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultBackupExportRequest {
    pub passphrase: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VaultBackupRestoreRequest {
    pub passphrase: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultBackupOperationResponse {
    pub completed: bool,
    pub cancelled: bool,
    pub revision: u64,
    pub schema_version: u32,
}
