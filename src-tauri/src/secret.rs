use regex::{Captures, Regex, RegexSet};
use std::sync::OnceLock;

const PRIVATE_KEY_REPLACEMENT: &str = "[PRIVATE KEY REDACTED]";
const SECRET_REPLACEMENT: &str = "[SECRET REDACTED]";
const PASSWORD_REPLACEMENT: &str = "$label: [SECRET REDACTED]";

const PATTERNS: &[&str] = &[
    r"(?m)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    r"\bsk-(?:test[_-]?)?[A-Za-z0-9_-]{12,}\b",
    r"\bghp_[A-Za-z0-9]{20,}\b",
    r"\bAIza[A-Za-z0-9_-]{20,}\b",
    r"\bAKIA[A-Z0-9]{16}\b",
    r"\b(?:Bearer|Authorization)\s+[A-Za-z0-9._~+/=-]{16,}\b",
    r"(?i)(?:password|passwd|pwd|密码)\s*[:=：]\s*[^\s,，;；]{4,}",
    r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
];

fn detector() -> &'static RegexSet {
    static DETECTOR: OnceLock<RegexSet> = OnceLock::new();
    DETECTOR.get_or_init(|| RegexSet::new(PATTERNS).expect("static secret patterns must compile"))
}

fn private_key() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?ms)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----").expect("static private-key pattern must compile"))
}

fn tokens() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"(?x)
        \bsk-(?:test[_-]?)?[A-Za-z0-9_-]{12,}\b|
        \bghp_[A-Za-z0-9]{20,}\b|
        \bAIza[A-Za-z0-9_-]{20,}\b|
        \bAKIA[A-Z0-9]{16}\b|
        \b(?:Bearer|Authorization)\s+[A-Za-z0-9._~+/=-]{16,}\b|
        \beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b
    ",
        )
        .expect("static token pattern must compile")
    })
}

fn passwords() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)(?P<label>password|passwd|pwd|密码)\s*[:=：]\s*[^\s,，;；]{4,}")
            .expect("static password pattern must compile")
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretScan {
    pub contains_secret: bool,
    pub finding_count: usize,
}

pub fn scan_secrets(input: &str) -> SecretScan {
    let matches = detector().matches(input);
    SecretScan {
        contains_secret: matches.matched_any(),
        finding_count: matches.iter().count(),
    }
}

pub fn mask_secrets(input: &str, declared_secret: bool) -> String {
    if declared_secret {
        return SECRET_REPLACEMENT.to_owned();
    }
    let masked = private_key().replace_all(input, PRIVATE_KEY_REPLACEMENT);
    let masked = tokens().replace_all(&masked, SECRET_REPLACEMENT);
    passwords()
        .replace_all(&masked, |captures: &Captures<'_>| {
            PASSWORD_REPLACEMENT.replace("$label", &captures["label"])
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_masks_fake_secret_fixtures() {
        let fake = [
            "password: fictitious-pass-123 sk-",
            "test_abcdefghijklmnopqrstuvwxyz7Qx",
        ]
        .concat();
        assert!(scan_secrets(&fake).contains_secret);
        let masked = mask_secrets(&fake, false);
        assert!(!masked.contains("fictitious-pass-123"));
        assert!(!masked.contains("abcdefghijklmnopqrstuvwxyz7Qx"));
    }

    #[test]
    fn declared_secret_is_always_fully_hidden() {
        let unknown_pattern = "CLASSIFIED-BUT-NOT-A-KNOWN-TOKEN-94731";
        assert_eq!(mask_secrets(unknown_pattern, true), SECRET_REPLACEMENT);
    }
}
