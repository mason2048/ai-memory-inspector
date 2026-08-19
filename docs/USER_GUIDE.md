# AI Memory Inspector user guide

[中文操作说明](USER_GUIDE.zh-CN.md)

This guide covers the browser development build and the macOS Tauri source candidate. The current
interface is in Simplified Chinese, so important button names are shown in Chinese in quotation
marks. This repository does not provide a signed application or production service.

## 1. Install and start

### Browser development build

Install Node.js 24.14.1 and npm 11.11.0, then run:

```bash
git clone https://github.com/mason2048/ai-memory-inspector.git
cd ai-memory-inspector
npm ci --ignore-scripts
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`. Keep that terminal open while using the app. Press `Ctrl+C` in the
terminal to stop it.

To inspect the production build locally with the repository's restrictive security headers:

```bash
npm run build
npm run mock:web
```

Open `http://127.0.0.1:4399`, then press `Ctrl+C` to stop the local server. This remains a local
source check, not deployment.

### macOS Tauri source candidate

Install Node/npm as above, Rust 1.85 or newer, Xcode Command Line Tools, and the Tauri 2 macOS
prerequisites. From the repository root run:

```bash
npm ci --ignore-scripts
npm exec tauri -- dev
```

Stop the development process with `Ctrl+C`. The source candidate is unsigned and unnotarized. Do
not redistribute its local `.app` output as a release.

On first desktop use, select “使用系统验证解锁”. macOS should perform user-presence
authentication before the encrypted vault opens. Canceling or failing authentication keeps the
vault locked. When the window loses focus, the content is covered; select “继续查看” to remove the
privacy shield. The vault automatically locks after inactivity.

## 2. First safe walkthrough

Use only data you are authorized to process. For the first run, use the repository's fictional
fixtures:

1. Select “导入记忆”.
2. In browser mode, choose or drag `examples/fictional-memory-export.json`. In desktop mode, select
   “使用系统窗口选择文件” and choose the same file.
3. Wait for local normalization and redaction to finish. The app creates a snapshot for every
   successful import.
4. Alternatively, paste a fictional summary into the text area and select “检查粘贴内容”.
5. Import a second version or a different fixture to enable snapshot comparison.

Supported file types are Markdown (`.md`, `.markdown`), TXT, JSON, JSONL, NDJSON, and Context
Package v0.1. Imported files are treated as data, not instructions or executable code.

## 3. Inspect records and findings

The four workspace tabs can be used with the pointer or the arrow, Home, and End keys.

- “检查报告” lists duplicate, selected conflict, stale, unsourced, and sensitive-pattern findings.
  Search and filter results, open a finding, and inspect every cited source before deciding what to
  do.
- Mark a finding as keep, ignore, suggest delete, or corrected. “Suggest delete” creates a local
  recommendation only; it does not contact or modify a provider.
- “全部记忆” shows normalized records even when they produced no finding. Open a record to inspect
  its type, scope, confidence, sensitivity, tags, source URI, locator, platform, revision, observed
  time, import time, and snapshot membership.
- Secret-classified content and associated metadata are represented by fixed placeholders and
  cannot be opened in the correction form.

## 4. Review the timeline and correct a local copy

Open a record under “全部记忆”. Its timeline combines import, snapshot, and local revision events in
time order. This is the history known to this local project, not a provider audit log.

For a non-secret record, select “本地修正” or “修正”, update the title/content/scope, enter a required
reason, and save. The previous and corrected values remain in local revision history. The source
provider is not changed; use the cleanup checklist to track any provider-side follow-up.

## 5. Compare snapshots

After at least two imports, open “快照对比”:

1. Choose the earlier and newer snapshots, or use the swap button.
2. Review added, removed, modified, and unchanged counts.
3. Select a row to inspect field-level differences and source metadata.
4. For a changed record, “采用较新版本” applies that version to the local project and records the
   correction. “加入清理清单” adds a manual follow-up step.

Stable record IDs are matched first. If an ID changed, the comparison may fall back to source URI
and locator. Always verify inferred matches manually.

## 6. Local rules and cleanup checklist

Open “规则与清单” to enable/disable rules or select “导入规则 JSON”. The example
`examples/custom-rules.json` demonstrates the data-only schema. Unknown fields, executable content,
unsafe regular expressions, excessive complexity, and secrets in rule display/match values are
rejected.

The right-hand platform checklist groups manual verify/correct/delete steps. Select “导出” to save a
Markdown copy. A generated step is not proof that an external platform action happened.

## 7. Redact and export

- “导出脱敏包” creates a Context Package containing export-safe records. Secret records are
  excluded, and the exporter independently scans for known plaintext secret patterns.
- “导出迁移 Markdown” creates a human-readable migration document with the same safety boundary.
- Cleanup checklist export creates manual instructions grouped by source platform.

Inspect every downloaded file before sharing it. Pattern-based redaction cannot recognize every
credential or personal identifier. Downloads are outside the app's later clear-data operation.

## 8. Desktop backup and restore

These controls are available only in the Tauri source candidate after the native vault is unlocked.

### Create a backup

1. Select “完整加密备份”.
2. Enter and confirm a unique recovery passphrase between 12 and 1,024 characters.
3. Select “选择位置并导出” and choose an `.amibackup` destination.
4. Store the passphrase separately. The app neither stores nor recovers it, and the device Keychain
   key is not copied into the backup.

### Restore a backup

1. Back up the current project if it must be retained.
2. Select “恢复备份”, enter the original recovery passphrase, and choose the `.amibackup` file.
3. The native core validates the format, authentication tag, passphrase, bounds, and schema before
   atomically replacing the local project. A wrong passphrase or altered/truncated file is rejected.

Restore replaces this app's local vault only. It does not modify ChatGPT, Claude, Codex, or source
files. Cross-device and signed-app GUI recovery remain release validation items.

## 9. Clear local data

- “仅清除搜索索引” removes the app-managed index while retaining records and snapshots.
- “清除全部本地数据” removes the app-managed project, snapshots, revision history, custom rules,
  and index after confirmation.

In browser mode, the action clears the app's keys in `localStorage`. In desktop mode, it clears the
encrypted project through the native vault. It does not erase exports, downloads, `.amibackup`
files, browser/OS backups, source files, or provider-side data. Delete those separately if required.

## 10. Verify a source checkout

```bash
npm run check:offline
```

For the full three-browser gate and online npm advisory audit:

```bash
npm exec playwright install chromium firefox webkit
npm run check
```

For the native security core:

```bash
cd src-tauri
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo test --locked --features sqlcipher
cargo build --locked --release
```

These commands verify source behavior on the current machine. They do not sign, notarize, publish,
or validate a downloadable application.

## 11. Troubleshooting

| Symptom                                    | What to check                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci` reports a version mismatch        | Use Node 24.14.1 and npm 11.11.0, then run `npm ci --ignore-scripts` again. Do not delete the lockfile.                                                                         |
| Port 4173 or 4399 is already in use        | Stop the existing local process, or give Vite a different port. Playwright expects 4399 for its automated gate.                                                                 |
| Browser data disappears                    | Storage may be blocked, private, or at quota. Export a safe copy before closing; the UI warns when persistence is unavailable.                                                  |
| An import is rejected                      | Confirm its extension/format, use valid UTF-8, stay within the displayed limits, and remove unsupported executable structures. Never weaken bounds to import an untrusted file. |
| A record is unexpectedly hidden            | It matched a sensitive pattern or was declared `secret`. Review the original authorized source; do not bypass the redaction layer.                                              |
| Desktop remains locked                     | Confirm macOS 13+, Keychain/login passcode availability, Xcode/Rust prerequisites, and that the Tauri process is the source candidate. Cancellation must remain fail-closed.    |
| Native file or backup dialog does not open | Confirm you are in Tauri mode, not the browser build. Check terminal diagnostics without posting paths or memory content publicly.                                              |
| Backup restore fails                       | Verify the exact recovery passphrase and use an unmodified `.amibackup`. The app intentionally rejects wrong, corrupt, truncated, oversized, or future-schema files.            |
| Playwright cannot start                    | Install the three browsers, ensure `127.0.0.1:4399` can be bound, and stop any stale mock server.                                                                               |
| A security concern is found                | Do not open a public issue. Use [private vulnerability reporting](https://github.com/mason2048/ai-memory-inspector/security/advisories/new) with fictional reproduction data.   |
