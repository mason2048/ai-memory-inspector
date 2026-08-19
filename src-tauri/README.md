# Rust and Tauri security core

This directory contains the macOS desktop shell and native security boundary for the local-first
product. It does not contain signing credentials, notarization, deployment, cloud sync, account
access, or AI-provider automation.

The checked-in icon set is generated from `../assets/app-icon-1024.png`; provenance is documented in
`../ASSET_PROVENANCE.md`. The source, ICNS size, and entitlements are checked by
`npm run release:assets:check`. Visual review in Finder, Dock, About, and a final signed DMG is still
required before binary distribution.

## Backends

- Default: authenticated encrypted container using Argon2id and AES-256-GCM. This is intentionally small and testable; it stores one encrypted JSON payload atomically.
- Optional `sqlcipher` feature: compiled against vendored SQLCipher and implements schema migration primitives. It is not enabled by default and is not represented as the shipped backend until durability, backup, rekey, and recovery tests are complete.

## System-authenticated master key

On macOS, `memory_inspector_vault_unlock_with_system` reads a random 32-byte master key from the Data Protection Keychain. The item uses `AccessibleWhenPasscodeSetThisDeviceOnly` plus `userPresence`, so Security.framework must complete system authentication before releasing it. The key and derived container passphrase stay in Rust and are never returned to the renderer.

On first use, the command creates the protected key, then immediately reads it back through the protected Keychain. The vault is created only after that read succeeds; cancellation and authentication errors keep the vault locked. This is a real native code path, but it still requires signed-app testing on Touch ID and non-Touch ID macOS devices before GA.

The renderer contract is:

- `memory_inspector_vault_status` -> `{ state: "locked" | "unlocked", changedAt?: string }`
- `memory_inspector_vault_unlock_with_system` -> the same DTO only after Keychain user-presence authentication and authenticated container open succeeds
- `memory_inspector_vault_lock` -> the same DTO

No general filesystem, shell, HTTP, or clipboard plugin is installed. The dialog plugin is present
only for the reviewed native import, backup-export, and backup-restore commands. Those commands open
the operating-system picker inside Rust; the renderer never supplies or receives a filesystem path.
Selected imports are preflighted and bounded before content crosses the IPC boundary. The strict
production CSP contains no `unsafe-inline`.

## Verification

```bash
cargo fmt --check
cargo test --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo check --locked --no-default-features --features sqlcipher
```

Never use real credentials in tests. The fixtures are syntactically fake.
