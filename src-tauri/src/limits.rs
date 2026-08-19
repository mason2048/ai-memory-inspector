use serde::{Deserialize, Serialize};

// Keep the native preflight stricter-or-equal to the renderer parser. A file
// must not become acceptable merely because it crossed the IPC boundary.
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_RECORDS: u64 = 5_000;
pub const MAX_RECORD_BYTES: usize = 256 * 1024;
pub const MAX_JSON_DEPTH: usize = 32;
pub const MAX_RULES: usize = 100;
pub const MAX_RULE_BYTES: usize = 256 * 1024;
pub const MIN_PASSPHRASE_BYTES: usize = 12;
pub const MAX_PASSPHRASE_BYTES: usize = 1024;
pub const PREFLIGHT_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityLimits {
    pub max_file_bytes: u64,
    pub max_records: u64,
    pub max_record_bytes: usize,
    pub max_json_depth: usize,
    pub max_rules: usize,
    pub max_rule_bytes: usize,
}

impl Default for SecurityLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: MAX_FILE_BYTES,
            max_records: MAX_RECORDS,
            max_record_bytes: MAX_RECORD_BYTES,
            max_json_depth: MAX_JSON_DEPTH,
            max_rules: MAX_RULES,
            max_rule_bytes: MAX_RULE_BYTES,
        }
    }
}
