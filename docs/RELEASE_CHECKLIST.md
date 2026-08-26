# Magnetar release checklist

Current status: development build only. No public release is claimed.

## Product and policy

- [x] Free direct-download model documented; no subscription/paywall/account/billing.
- [x] BYOK and local-provider path retained.
- [ ] Privacy policy and support documentation published.
- [ ] Provider compatibility matrix published.
- [ ] Dependency/license inventory generated.
- [ ] IP and architecture handoff prepared.

## Engineering gates

- [x] `npm run build` passes at baseline.
- [x] Rust tests pass 20/20 at baseline.
- [ ] No actionable TypeScript/Vite/Rust warnings.
- [x] Frontend unit tests are in CI.
- [ ] Integration, security and performance tests are in CI.
- [ ] Smoke fixture is independent of a specific user directory.
- [ ] Persistent incremental index passes 1k/10k/50k/100k scenarios.
- [ ] Agent crash recovery, cancellation, budgets and rollback pass.
- [ ] Clean migration, backup/import, integrity and recovery pass.

## Security gates

- [ ] Production secrets use macOS Keychain only.
- [ ] No secrets in plaintext files, SQLite, localStorage, prompts, traces or logs.
- [ ] Backend path containment, symlink policy, trust and read-only mode pass.
- [ ] Backend read/write/execute/network authorization passes.
- [ ] Bash/Git timeout, process groups, audit and external-path policy pass.
- [ ] Restrictive CSP and embedded-browser isolation reviewed.
- [ ] Prompt-injection warnings and secret scanning pass.

## Packaging gates

- [ ] Universal macOS artifact built reproducibly.
- [ ] Developer ID signing completed.
- [ ] Notarization completed and ticket stapled.
- [ ] Clean-machine install, launch, update, uninstall and revert tested.
- [ ] Release notes and checksums published on the official website.

Apple Developer Program and Apple Account actions are intentionally excluded
until every preceding checkbox is green and the user explicitly confirms the
publication step.

## Verified only on a running signed build

These Step 2 controls are covered by unit tests but not end to end, because
they need a signed app and a person. The first launch of the next signed build
must confirm each, and a failure here is a release blocker:

- [ ] Keychain migration: existing keys move out of `secrets.json`, the
      password prompt appears at most once per key, and "Always Allow" sticks
      across a rebuild signed with the same identity.
- [ ] Settings reports "Key in Keychain", not the debug fallback.
- [ ] Trust banner appears for a folder opened for the first time; writes and
      commands are refused until it is dismissed by trusting the folder.
- [ ] Read-only mode actually refuses a write and a shell command.
- [ ] Path grant: an agent write outside the open folder raises the native
      dialog, and denying it refuses the write.
- [ ] Attachment picker and drag-and-drop both attach an image.
- [ ] `audit.log` exists, is mode 0600, and contains a redacted command line and
      a contacted host.
