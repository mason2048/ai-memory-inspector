# Contributing to AI Memory Inspector

Thank you for helping improve the source preview. Changes must preserve the local-first privacy
boundary, fail-closed desktop behavior, and the `MIT OR Apache-2.0` licensing model.

## Before opening an issue

- Search existing issues and documentation first.
- Use only fictional, minimal reproduction data. Never attach a memory export, local vault,
  `.amibackup`, credential, personal identifier, private path, or screenshot containing user data.
- Report vulnerabilities through
  [GitHub private vulnerability reporting](https://github.com/mason2048/ai-memory-inspector/security/advisories/new),
  not a public issue.
- Use the privacy issue form only for non-sensitive product-boundary questions or proposals.

## Development setup

Use Node.js 24.14.1, npm 11.11.0, and the committed lockfile:

```bash
npm ci --ignore-scripts
npm run dev -- --host 127.0.0.1 --port 4173
```

Native changes also require Rust 1.85 or newer, Xcode Command Line Tools, and the Tauri 2 macOS
prerequisites.

## Change requirements

- Keep imports local and user-initiated; do not add telemetry, remote processing, provider login, or
  external network access without a separately reviewed product and privacy change.
- Treat imported files, rules, paths, native errors, and backup content as untrusted.
- Preserve independent redaction at import, display/persistence, and export boundaries.
- Do not claim that a local suggestion changed or deleted provider-side data.
- Do not add signing credentials, update private keys, real endpoints, certificates, generated
  `.app`/DMG files, `target/`, coverage, or test reports.
- Keep Tauri capabilities and IPC commands allow-listed. A renderer-supplied arbitrary path is not
  acceptable for native import or backup.
- Update English and Chinese user-facing documentation together when behavior changes.

## Verification

For frontend, documentation, and TypeScript changes:

```bash
npm run check:offline
```

For browser-flow changes, install the three Playwright browsers and run the full gate:

```bash
npm exec playwright install chromium firefox webkit
npm run check
```

For Rust/Tauri changes, also run:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --features sqlcipher
cargo build --locked --release
```

If an environment prevents a command from running, state that explicitly in the pull request; do
not report an unrun check as passed.

## Pull requests

Keep each pull request focused and include:

- the user-visible problem and chosen boundary;
- tests added or changed;
- exact commands run and their results;
- privacy/security impact;
- screenshots only when they contain fictional data; and
- documentation updates in both languages when applicable.

Do not commit generated dependency, build, coverage, browser-report, application, certificate, or
release-overlay files. Contributions are accepted under the repository's dual license: you may use
the project under either MIT or Apache-2.0.
