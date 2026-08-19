# Privacy Notice and Engineering Rules

## Product data flow

The application processes files and pasted text selected by the user. Analysis, rules, snapshots,
history, and search indexes run in the local application context. The web build has no application
server, account system, third-party API, advertising, analytics, or remote error reporting.

Imported content may contain highly sensitive data. Redaction reduces accidental disclosure but is
not a guarantee that every possible credential or personal identifier will be detected. Users must
only import data they are authorized to process.

## Local storage and deletion

The web build persists sanitized records, revisions, snapshots, rules, and indexes in browser storage.
The user can clear the index alone or all application-managed local data. Downloads, browser
backups, operating-system snapshots, extensions, and forensic recovery are outside the application's
deletion boundary.

The desktop candidate persists the complete project in one authenticated AES-256-GCM container.
Its 32-byte device key is released by macOS Keychain user-presence policy and never crosses into the
renderer. A portable backup uses a separate recovery passphrase; that passphrase is neither stored
nor recoverable by the application. Signed-device validation is still required before real-user
rollout. A future change that
introduces remote processing requires a new privacy review, data inventory, retention schedule,
processor agreement, and explicit user disclosure before implementation.

## Diagnostics and telemetry

Remote telemetry is disabled by default. CI reports contain test fixtures and build metadata only.
Production diagnostics may include a version, platform, capability flags, coarse counters, and an
error code; they must never include imported content, filenames, source URIs, rules, local-storage
values, exports, screenshots, or session replay.

If opt-in remote reporting is added later, consent must precede every transmission, withdrawal must
be available in-product, payloads must be schema allow-listed and redacted, and retention and
processing regions must be documented. No production monitoring credential may be embedded in the
client bundle.

## Ownership and review

The release owner maintains the data inventory and validates deletion and recovery during every
schema migration. Security and privacy review is required for storage, parser, updater, telemetry,
or external-network changes.
