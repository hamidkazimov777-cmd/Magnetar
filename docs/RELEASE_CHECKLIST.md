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
- [ ] Frontend unit, integration and security tests are in CI.
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
