# AI Memory Inspector

[简体中文](README.zh-CN.md) · [User guide](docs/USER_GUIDE.md) ·
[Security](SECURITY.md) · [Privacy](PRIVACY.md)

AI Memory Inspector is a local-first tool for examining memory records that you deliberately
provide. It finds duplicates, selected conflicts, stale or unsourced items, and known sensitive
patterns; lets you inspect timelines and compare snapshots; and produces redacted exports and
manual cleanup checklists.

> **Source preview v0.3.0.** This repository publishes source code only. It does not offer a
> downloadable application, signed DMG, GitHub Release, production service, or automatic updater.
> The macOS shell remains unsigned and unnotarized until the external release gates in
> [GA_READINESS.md](GA_READINESS.md) are completed.

The app cannot read hidden memories inside ChatGPT, Claude, Codex, or any other provider. It does
not read browser cookies, log in to provider accounts, or prove that a provider-side record was
changed or deleted.

## What is included

- Import Markdown, TXT, JSON, JSONL, NDJSON, and Context Package v0.1 files, or paste text.
- Inspect every normalized record, source metadata, findings, corrections, and a local timeline.
- Compare two import snapshots and review added, removed, modified, and unchanged records.
- Detect and redact known credential and personal-data patterns before display, storage, and export.
- Export a redacted Context Package, migration Markdown, and a platform-by-platform manual cleanup
  checklist. Records classified as `secret` are excluded by default.
- Run declarative local rules with a bounded, allow-listed schema; imported content is never
  executed as code.
- Use either the browser development build or the macOS Tauri source candidate.

## Browser and desktop boundaries

| Mode                         | Persistence                                                                                 | Native capabilities                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Browser development build    | Sanitized project data in browser `localStorage`                                            | No system authentication, native vault, or full encrypted backup                                             |
| macOS Tauri source candidate | One AES-256-GCM encrypted project container; device key protected by Keychain user presence | Native file picker, system unlock, lock/privacy shield, and passphrase-protected `.amibackup` export/restore |

The browser build has no application server, account, analytics, advertising, or third-party API.
The production CSP blocks outbound connections. A native build must fail closed if its security
bridge is unavailable; it must not fall back to browser storage.

## Quick start: browser development mode

Prerequisites: Node.js 24.14.1 and npm 11.11.0.

```bash
git clone https://github.com/mason2048/ai-memory-inspector.git
cd ai-memory-inspector
npm ci --ignore-scripts
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`. Stop the server with `Ctrl+C`. No example data is loaded
automatically; import a fictional file from `examples/` for a safe walkthrough.

## Run the macOS Tauri source candidate

Install the same Node/npm versions, Rust 1.85 or newer, Xcode Command Line Tools, and the Tauri 2
macOS prerequisites. Then run:

```bash
npm ci --ignore-scripts
npm exec tauri -- dev
```

The operating system should request user presence before the encrypted vault opens. Native import
and backup dialogs are opened by Rust; the renderer neither supplies nor receives filesystem paths.
This development run is not a signed or notarized application.

See [the full user guide](docs/USER_GUIDE.md) for first use, inspection, timeline, comparison,
correction, redaction, export, backup, restore, clearing data, and troubleshooting. Chinese readers
can use [完整中文操作说明](docs/USER_GUIDE.zh-CN.md).

## Verification

Run the deterministic frontend and supply-chain gate without requiring a local browser server:

```bash
npm run check:offline
```

When the machine can listen on `127.0.0.1`, has the Playwright browsers installed, and can reach the
npm advisory service, run the full browser gate:

```bash
npm exec playwright install chromium firefox webkit
npm run check
```

Verify the native core separately:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --features sqlcipher
cargo build --locked --release
```

Passing source checks does not establish signing, notarization, Gatekeeper acceptance, real-device
compatibility, updater security, or production readiness.

## Security and privacy

- Import only data you are authorized to process, and use fictional data in bug reports.
- Redaction is a safety layer, not a guarantee that every credential or personal identifier will be
  detected.
- “Suggest delete” and exported cleanup steps are recommendations, not provider deletion receipts.
- “Clear all local data” covers only storage managed by this app, not downloads, backups, browser or
  operating-system snapshots, or provider data.
- Do not open a public issue for a vulnerability or include memory exports, credentials, or personal
  data. Use [GitHub private vulnerability reporting](https://github.com/mason2048/ai-memory-inspector/security/advisories/new).

Read [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), and
[THREAT_MODEL.md](THREAT_MODEL.md) before using the project with sensitive test material.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. This project is dual-licensed,
at your option, under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE). Third-party production
dependencies and their locked license metadata are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
