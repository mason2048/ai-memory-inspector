use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidRequest,
    UnsupportedFormat,
    FileTooLarge,
    TooManyRecords,
    RecordTooLarge,
    JsonTooDeep,
    InvalidUtf8,
    IoError,
    VaultLocked,
    VaultAlreadyExists,
    VaultNotFound,
    InvalidPassphrase,
    AuthenticationFailed,
    InvalidVault,
    MigrationFailed,
    BackendUnavailable,
    AuthenticationCancelled,
    RevisionConflict,
    NotImplemented,
}

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("请求无效：{0}")]
    InvalidRequest(String),
    #[error("不支持的文件格式")]
    UnsupportedFormat,
    #[error("文件超过安全大小限制")]
    FileTooLarge,
    #[error("记录数量超过安全限制")]
    TooManyRecords,
    #[error("单条记录超过安全大小限制")]
    RecordTooLarge,
    #[error("JSON 嵌套层级超过安全限制")]
    JsonTooDeep,
    #[error("文件不是有效的 UTF-8 文本")]
    InvalidUtf8,
    #[error("无法读取本地文件")]
    Io(#[from] std::io::Error),
    #[error("资料库当前已锁定")]
    VaultLocked,
    #[error("资料库已经存在")]
    VaultAlreadyExists,
    #[error("资料库不存在")]
    VaultNotFound,
    #[error("解锁口令必须为 12-1024 字节")]
    InvalidPassphrase,
    #[error("资料库身份验证失败")]
    AuthenticationFailed,
    #[error("资料库格式无效或不受支持")]
    InvalidVault,
    #[error("资料库迁移失败")]
    MigrationFailed,
    #[error("请求的加密后端在此构建中不可用")]
    BackendUnavailable,
    #[error("系统身份验证已取消")]
    AuthenticationCancelled,
    #[error("资料库已被另一操作更新，请重新载入")]
    RevisionConflict,
    #[error("NOT_IMPLEMENTED：系统认证与 Keychain userPresence 解锁尚未实现")]
    NotImplemented,
}

impl CoreError {
    pub const fn code(&self) -> ErrorCode {
        match self {
            Self::InvalidRequest(_) => ErrorCode::InvalidRequest,
            Self::UnsupportedFormat => ErrorCode::UnsupportedFormat,
            Self::FileTooLarge => ErrorCode::FileTooLarge,
            Self::TooManyRecords => ErrorCode::TooManyRecords,
            Self::RecordTooLarge => ErrorCode::RecordTooLarge,
            Self::JsonTooDeep => ErrorCode::JsonTooDeep,
            Self::InvalidUtf8 => ErrorCode::InvalidUtf8,
            Self::Io(_) => ErrorCode::IoError,
            Self::VaultLocked => ErrorCode::VaultLocked,
            Self::VaultAlreadyExists => ErrorCode::VaultAlreadyExists,
            Self::VaultNotFound => ErrorCode::VaultNotFound,
            Self::InvalidPassphrase => ErrorCode::InvalidPassphrase,
            Self::AuthenticationFailed => ErrorCode::AuthenticationFailed,
            Self::InvalidVault => ErrorCode::InvalidVault,
            Self::MigrationFailed => ErrorCode::MigrationFailed,
            Self::BackendUnavailable => ErrorCode::BackendUnavailable,
            Self::AuthenticationCancelled => ErrorCode::AuthenticationCancelled,
            Self::RevisionConflict => ErrorCode::RevisionConflict,
            Self::NotImplemented => ErrorCode::NotImplemented,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: ErrorCode,
    message: String,
}

impl Serialize for CoreError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
