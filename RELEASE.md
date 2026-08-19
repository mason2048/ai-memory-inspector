# Release and Rollback Runbook

## Candidate preparation

1. Freeze a semantic version, protected source revision, Node 24.14.1, npm 11.11.0, and the lockfile.
2. Run `npm ci --ignore-scripts` and `npm run check` in a clean environment.
3. Confirm the same candidate passes macOS desktop tests, backup/restore, migration, CSP and
   capability review. CI also builds and inspects an **unsigned** universal internal `.app`; it does
   not yet exercise the native GUI, LocalAuthentication, Keychain, updater, signed DMG or recovery
   flow on real devices.
4. Run `npm run license:check`, Cargo audit, and the pinned Cargo CycloneDX generator for both macOS
   architectures. Keep the npm/Rust SBOMs and committed `THIRD_PARTY_NOTICES.md` with the candidate.
5. Generate checksums, provenance, complete attribution notices where dependency terms require
   them, and release notes; the generated license inventory does not replace legal review.
6. Store evidence with the candidate. A successful workflow is not authorization to publish.

## macOS DMG signing and notarization prerequisites

Production DMGs require an Apple Developer organization, Developer ID Application certificate,
notarization authorization, an approved bundle identifier, hardened runtime, and reviewed
entitlements. These credentials must live in an approved release secret manager or dedicated
signing service and must never be placed in source, workflow YAML, logs, local examples, or the
application bundle.

The release operator must sign all nested executables, verify the code signature and entitlements,
build the DMG, submit it to Apple notarization, wait for acceptance, staple the ticket, and validate
the stapled artifact on a clean supported macOS device. Record the artifact SHA-256, source revision,
SBOM digest, signature identity, and notarization request identifier without recording credentials.

## Automatic update prerequisites

The base Tauri configuration intentionally keeps automatic updates disabled. Release configuration
is generated only from `AMI_UPDATER_ENDPOINT` and `AMI_UPDATER_PUBLIC_KEY`; both are public build
inputs. The generator requires exactly one public HTTPS endpoint with no credentials, query, hash,
local/private host or placeholder, and an outer-Base64 encoded Minisign public-key file. It writes
an atomic overlay under the operating-system temporary directory by default, enables updater
artifacts, and pins every dangerous transport/TLS option to `false`.

After an approved production endpoint and public key exist, prepare and verify the ephemeral
overlay without committing it:

```bash
npm run updater:release-config:prepare
npm run updater:release-config:verify
```

For a release runner with an explicit temporary path:

```bash
npm run updater:release-config:prepare -- --output "$RUNNER_TEMP/tauri.release.conf.json"
npm run updater:release-config:verify -- --overlay "$RUNNER_TEMP/tauri.release.conf.json"
npm exec tauri -- build --config "$RUNNER_TEMP/tauri.release.conf.json"
```

These scripts never read the updater private signing key. That private key must remain offline or in
an approved signing service, separate from Apple notarization credentials. The static gate is also
covered by `npm run updater:release-config:check` using synthetic public fixtures, so ordinary
`npm run check` does not need real release values.

Automatic updates remain blocked until the real endpoint, embedded public key, offline-signed
manifest format, channel policy, staged rollout, minimum supported version and emergency revocation
process are approved and tested. Passing the overlay verifier proves configuration shape only; it
does not prove that hosting, signatures, rollout or rollback work.

Test fresh install, upgrade from the two preceding data schemas, interrupted download, corrupt
signature, unavailable endpoint, downgrade rejection, and offline startup. No update may migrate
data irreversibly without a verified pre-migration backup and compatible rollback path.

## Promotion

Promote the exact signed and notarized candidate already tested in staging; do not rebuild it.
Require independent release approval, verify checksums and signatures, then use a staged rollout.
Run post-release smoke checks without real user data. Target rollback readiness is 15 minutes and
monthly availability is 99.9% once an external distribution service exists.

## Rollback

Stop rollout and revoke the update manifest when crash, data-integrity, privacy, signature, or
high-severity security gates fail. Restore the preceding signed artifact and compatible update
manifest. Do not ask users to clear their data as a rollback strategy. If the schema cannot be read
by the preceding version, switch the affected version to recovery-only mode and ship a forward fix.

After rollback, preserve content-free logs and build evidence, rotate any exposed release
credentials, document impact and remediation, and rehearse restore before resuming distribution.

## Current external blockers

This repository does not contain or use Apple signing certificates, notarization authorization,
an updater private signing key, a real updater endpoint/public key, release hosting, monitoring
credentials, or publishing access. Consequently, the implemented workflow can validate a candidate,
produce an SBOM and fail closed on updater release configuration, but it cannot sign, notarize,
publish, deploy, or enable automatic updates.
