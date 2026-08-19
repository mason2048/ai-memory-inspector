# Security policy

## Supported versions

AI Memory Inspector is currently a source preview, not a production release. Security fixes are
applied to the latest revision on `main`. No downloadable application, signed DMG, hosted service,
or updater is currently supported.

## Report a vulnerability privately

Use
[GitHub private vulnerability reporting](https://github.com/mason2048/ai-memory-inspector/security/advisories/new)
for suspected vulnerabilities. Do not open a public issue, discussion, or pull request containing a
vulnerability, credential, memory export, backup, vault, local path, screenshot, or other personal
data. If the private-report button is unavailable, open a content-free public issue asking the owner
to enable a private channel; do not include technical details.

Use a minimal reproduction built from fictional data. A useful report includes:

- affected source revision and runtime mode;
- impact and preconditions;
- deterministic reproduction steps using synthetic fixtures;
- whether the browser or native fail-closed boundary was bypassed; and
- a suggested remediation, if known.

The project aims to acknowledge a private report within two business days and provide an initial
severity assessment within five business days. These are response targets, not a service-level
agreement.

## Security boundaries

- The app processes only files or text deliberately supplied by the user. It cannot inspect hidden
  provider memory, cookies, or logged-in accounts.
- Browser mode stores sanitized project state in local browser storage. It has no system vault or
  full encrypted backup.
- The macOS source candidate uses a Keychain-protected device key and authenticated encrypted
  project container. Native security bridge failure must remain locked and must never fall back to
  browser storage.
- Native import and backup commands open the operating-system picker inside Rust. The renderer
  cannot supply or receive arbitrary filesystem paths.
- Redaction reduces accidental disclosure but cannot guarantee detection of every credential or
  personal identifier.
- Cleanup suggestions are not provider actions or deletion receipts.

See [THREAT_MODEL.md](THREAT_MODEL.md), [PRIVACY.md](PRIVACY.md), and
[RELEASE.md](RELEASE.md) for the complete boundaries.

## Source and release gates

Every source candidate must pass locked installation, formatting, lint, type checking, coverage,
production build, repository secret scan, three-engine browser tests, dependency audit, CycloneDX
SBOM validation, and license checks. Rust/Tauri changes must also pass formatting, Clippy with
warnings denied, default and SQLCipher tests, release compilation, and Rust dependency audit.

Tauri's Linux-only GTK dependency graph remains in `Cargo.lock` for reproducibility but is not
compiled into either supported macOS build. `src-tauri/.cargo/audit.toml` contains one exact
exception for `RUSTSEC-2024-0429` (`glib` 0.18.5) after `cargo tree --target all -i glib` confirmed
that it is reachable only through the Linux GTK branch. Adding Linux support, or a Tauri release
that moves this branch to `glib` 0.20+, requires removing and re-evaluating that exception. No
advisory family, severity, or dependency category is ignored.

The GitHub workflow has read-only repository permissions. It does not sign, notarize, release,
deploy, publish packages, or use production secrets. Generated unsigned applications are internal
verification outputs only and are not uploaded for distribution.

Production artifacts require a separately approved protected revision, checksums, SBOM, Developer
ID signing, Apple notarization and stapling, Gatekeeper verification, real-device validation, and a
reviewed update/rollback process. Passing source CI does not satisfy those gates.

## Security response

For a confirmed exposure, stop affected distribution, preserve only content-free diagnostics,
rotate any affected release credentials, revoke affected update metadata, and publish remediation
guidance without exposing reporter or user data. Never request a reporter's raw memory export unless
a separately approved secure transfer and deletion process exists.
