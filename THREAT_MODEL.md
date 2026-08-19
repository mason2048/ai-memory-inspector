# Threat Model

## Assets and trust boundaries

Protected assets are imported memory content, credentials embedded in it, rules, revisions,
snapshots, indexes, encrypted project backups, signing identities, and update metadata. Trust
boundaries exist at file/paste import, browser or desktop persistence, export/download, CI artifacts,
desktop IPC, release signing, and automatic update delivery.

The product assumes the user's operating system account is trusted. It does not claim protection
from a compromised endpoint, malicious browser extension, developer tools, memory forensics, or an
attacker with access to the user's unlocked session.

## Primary threats and required controls

| Threat                                                        | Required controls                                                                                             | Verification                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Malicious or oversized import exhausts CPU/memory             | Strict size/count limits, bounded parser and regex rules, cancellation, worker isolation                      | Boundary, fuzz, timeout, and large-fixture tests |
| Imported secret leaks to DOM, storage, export, log, or report | Normalize and redact at ingress and persistence; allow-listed diagnostics; secret exclusion from share export | Canary-secret tests across each sink             |
| Script or markup executes from imported data                  | React text rendering, no HTML injection, data-only rule schema, restrictive CSP                               | E2E payload fixtures and CSP checks              |
| Corrupt or partial storage destroys the project               | Versioned schema, transactional migration, backup checkpoint, fail-closed recovery                            | Interrupted migration and restore tests          |
| Cross-tab or updater race overwrites newer data               | Version checks, atomic writes, explicit conflict UI                                                           | Concurrent-write and rollback tests              |
| Supply-chain dependency or workflow is compromised            | Exact versions and lockfile, `npm ci --ignore-scripts`, pinned CI actions, audit, SBOM, signed release        | Mandatory protected-branch quality gate          |
| Desktop IPC exposes filesystem or command execution           | Minimal allowlist capabilities, path canonicalization, no shell plugin, CSP, least privilege                  | Tauri capability review and negative IPC tests   |
| Forged desktop update is installed                            | Offline signing key, notarization, TLS update endpoint, signed manifest, rollback plan                        | Staging update and signature-failure tests       |
| Telemetry collects private content                            | Default-off telemetry, explicit opt-in, payload allowlist, no replay or breadcrumbs                           | Network and payload contract tests               |

## Abuse and failure cases

- A file extension, MIME type, or JSON field is attacker-controlled and must not grant capability.
- A redaction miss is possible; raw imports must therefore receive the same protection as secrets.
- A valid but adversarial rule must be bounded in length, input size, and execution time.
- Deletion success only means application-managed stores are cleared; the UI must not claim that
  source platforms, downloads, operating-system backups, or forensic copies were deleted.
- A signed application can still contain a vulnerable dependency; signing never replaces the
  quality and security gates.

## Residual risks and review triggers

Regex-based detection cannot guarantee discovery of all secrets or personal data. Browser storage
is not encrypted against local access and is explicitly a development/MVP boundary. The desktop
candidate has an encrypted persistence and recovery implementation, but signed-device Keychain,
crash, migration, multi-process, and update validation still block real-user production rollout.

Repeat this threat model whenever parsers, persistence, IPC permissions, external connections,
telemetry, signing, or automatic updates change.
