use crate::{
    dto::{ImportFormat, ImportPreflightResponse, NativeImportFileResponse},
    error::CoreError,
    limits::{
        SecurityLimits, MAX_FILE_BYTES, MAX_JSON_DEPTH, MAX_RECORDS, MAX_RECORD_BYTES,
        PREFLIGHT_CHUNK_BYTES,
    },
    secret::scan_secrets,
};
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

fn format_from_path(path: &Path) -> Result<ImportFormat, CoreError> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => Ok(ImportFormat::Markdown),
        Some("txt") => Ok(ImportFormat::Text),
        Some("json") => Ok(ImportFormat::Json),
        Some("jsonl") => Ok(ImportFormat::Jsonl),
        Some("ndjson") => Ok(ImportFormat::Ndjson),
        _ => Err(CoreError::UnsupportedFormat),
    }
}

fn safe_basename(path: &Path) -> Result<String, CoreError> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| CoreError::InvalidRequest("文件名无效".to_owned()))
}

#[derive(Default)]
struct JsonBudget {
    depth: usize,
    max_depth: usize,
    object_count: u64,
    current_record_bytes: usize,
    in_string: bool,
    escaped: bool,
}

impl JsonBudget {
    fn consume(&mut self, byte: u8) -> Result<(), CoreError> {
        if self.in_string {
            if self.escaped {
                self.escaped = false;
            } else if byte == b'\\' {
                self.escaped = true;
            } else if byte == b'"' {
                self.in_string = false;
            }
        } else {
            match byte {
                b'"' => self.in_string = true,
                b'{' | b'[' => {
                    self.depth += 1;
                    self.max_depth = self.max_depth.max(self.depth);
                    if byte == b'{' {
                        self.object_count += 1;
                        self.current_record_bytes = 0;
                    }
                }
                b'}' | b']' => self.depth = self.depth.saturating_sub(1),
                _ => {}
            }
        }
        self.current_record_bytes += 1;
        if self.max_depth > MAX_JSON_DEPTH {
            return Err(CoreError::JsonTooDeep);
        }
        if self.object_count > MAX_RECORDS {
            return Err(CoreError::TooManyRecords);
        }
        if self.current_record_bytes > MAX_RECORD_BYTES {
            return Err(CoreError::RecordTooLarge);
        }
        Ok(())
    }
}

fn scan_json<R: Read>(mut reader: R) -> Result<(u64, u64), CoreError> {
    let mut buffer = vec![0_u8; PREFLIGHT_CHUNK_BYTES];
    let mut budget = JsonBudget::default();
    let mut findings = 0_u64;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        for byte in &buffer[..count] {
            budget.consume(*byte)?;
        }
        findings += scan_secrets(&String::from_utf8_lossy(&buffer[..count])).finding_count as u64;
    }
    Ok((budget.object_count.max(1), findings))
}

fn scan_lines<R: BufRead>(reader: R, record_per_line: bool) -> Result<(u64, u64), CoreError> {
    let mut records = 0_u64;
    let mut findings = 0_u64;
    for line in reader.split(b'\n') {
        let line = line?;
        if line.len() > MAX_RECORD_BYTES {
            return Err(CoreError::RecordTooLarge);
        }
        if line.iter().any(|byte| !byte.is_ascii_whitespace()) {
            if record_per_line || line.starts_with(b"-") || line.starts_with(b"#") {
                records += 1;
            }
            findings += scan_secrets(&String::from_utf8_lossy(&line)).finding_count as u64;
        }
        if records > MAX_RECORDS {
            return Err(CoreError::TooManyRecords);
        }
    }
    Ok((records.max(1), findings))
}

fn open_regular_file(path: &Path) -> Result<(File, u64), CoreError> {
    let selected_metadata = std::fs::symlink_metadata(path)?;
    if selected_metadata.file_type().is_symlink() {
        return Err(CoreError::InvalidRequest("不接受符号链接文件".to_owned()));
    }
    if !selected_metadata.file_type().is_file() {
        return Err(CoreError::InvalidRequest("所选路径不是普通文件".to_owned()));
    }
    if selected_metadata.len() > MAX_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let file = options.open(path)?;
    let opened_metadata = file.metadata()?;
    if !opened_metadata.is_file() {
        return Err(CoreError::InvalidRequest("所选路径不是普通文件".to_owned()));
    }
    #[cfg(unix)]
    if selected_metadata.dev() != opened_metadata.dev()
        || selected_metadata.ino() != opened_metadata.ino()
    {
        return Err(CoreError::InvalidRequest("文件在选择后发生变化".to_owned()));
    }
    if opened_metadata.len() > MAX_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    Ok((file, opened_metadata.len()))
}

fn preflight_open_file(
    path: &Path,
    file: &mut File,
    size_bytes: u64,
) -> Result<ImportPreflightResponse, CoreError> {
    let format = format_from_path(path)?;
    let basename = safe_basename(path)?;
    file.seek(SeekFrom::Start(0))?;
    let (estimated_records, secret_findings) = match format {
        ImportFormat::Json => scan_json(BufReader::new(&mut *file))?,
        ImportFormat::Jsonl | ImportFormat::Ndjson => scan_lines(BufReader::new(&mut *file), true)?,
        ImportFormat::Markdown | ImportFormat::Text => {
            scan_lines(BufReader::new(&mut *file), false)?
        }
    };

    Ok(ImportPreflightResponse {
        basename,
        format,
        size_bytes,
        estimated_records,
        secret_findings,
        contains_secret: secret_findings > 0,
        limits: SecurityLimits::default(),
    })
}

pub fn preflight_path(path: &Path) -> Result<ImportPreflightResponse, CoreError> {
    let (mut file, size_bytes) = open_regular_file(path)?;
    preflight_open_file(path, &mut file, size_bytes)
}

pub fn read_authorized_path(path: &Path) -> Result<NativeImportFileResponse, CoreError> {
    let (mut file, size_bytes) = open_regular_file(path)?;
    let preflight = preflight_open_file(path, &mut file, size_bytes)?;

    file.seek(SeekFrom::Start(0))?;
    let mut bytes = Vec::with_capacity(size_bytes as usize);
    (&mut file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(CoreError::FileTooLarge);
    }
    if bytes.len() as u64 != size_bytes {
        return Err(CoreError::InvalidRequest("文件在预检后发生变化".to_owned()));
    }
    let content = String::from_utf8(bytes).map_err(|_| CoreError::InvalidUtf8)?;
    Ok(NativeImportFileResponse { preflight, content })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn response_never_returns_the_parent_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("memories.jsonl");
        std::fs::write(&path, "{\"content\":\"ordinary\"}\n").unwrap();
        let response = preflight_path(&path).unwrap();
        assert_eq!(response.basename, "memories.jsonl");
        assert!(!serde_json::to_string(&response)
            .unwrap()
            .contains(&directory.path().to_string_lossy().to_string()));
    }

    #[test]
    fn detects_fake_secret_without_returning_it() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("fake.txt");
        let fake = "password: fictitious-pass-123";
        std::fs::write(&path, fake).unwrap();
        let response = preflight_path(&path).unwrap();
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(response.contains_secret);
        assert!(!serialized.contains("fictitious-pass-123"));
    }

    #[test]
    fn rejects_oversized_record_and_deep_json() {
        let directory = tempfile::tempdir().unwrap();
        let long_path = directory.path().join("long.jsonl");
        let mut file = File::create(&long_path).unwrap();
        file.write_all(&vec![b'a'; MAX_RECORD_BYTES + 1]).unwrap();
        assert!(matches!(
            preflight_path(&long_path),
            Err(CoreError::RecordTooLarge)
        ));

        let deep_path = directory.path().join("deep.json");
        std::fs::write(&deep_path, format!("{}0{}", "[".repeat(33), "]".repeat(33))).unwrap();
        assert!(matches!(
            preflight_path(&deep_path),
            Err(CoreError::JsonTooDeep)
        ));
    }

    #[test]
    fn bounded_read_returns_utf8_content_without_the_parent_path() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("safe.md");
        std::fs::write(&path, "# 完全虚构的记忆\n").unwrap();

        let response = read_authorized_path(&path).unwrap();
        assert_eq!(response.preflight.basename, "safe.md");
        assert_eq!(response.content, "# 完全虚构的记忆\n");
        assert!(!serde_json::to_string(&response)
            .unwrap()
            .contains(&directory.path().to_string_lossy().to_string()));
    }

    #[test]
    fn rejects_non_files_invalid_utf8_and_oversized_files() {
        let directory = tempfile::tempdir().unwrap();
        assert!(matches!(
            read_authorized_path(directory.path()),
            Err(CoreError::InvalidRequest(_))
        ));

        let invalid_utf8 = directory.path().join("invalid.txt");
        std::fs::write(&invalid_utf8, [0xff, 0xfe]).unwrap();
        assert!(matches!(
            read_authorized_path(&invalid_utf8),
            Err(CoreError::InvalidUtf8)
        ));

        let oversized = directory.path().join("oversized.txt");
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_FILE_BYTES + 1)
            .unwrap();
        assert!(matches!(
            read_authorized_path(&oversized),
            Err(CoreError::FileTooLarge)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target.txt");
        let link = directory.path().join("link.txt");
        std::fs::write(&target, "ordinary").unwrap();
        symlink(&target, &link).unwrap();

        assert!(matches!(
            read_authorized_path(&link),
            Err(CoreError::InvalidRequest(_))
        ));
    }
}
