# Magnetar security baseline and target policy

Status: baseline audit 2026-08-26. This is a security contract, not evidence
that every target control is already implemented.

## Product boundary

Magnetar is local-first and BYOK. It has no mandatory account, subscription,
paywall, billing proxy, telemetry, or hidden automation of third-party web
subscriptions. Network calls are allowed only to endpoints explicitly
configured by the user or to a local provider.

## Observed implementation

- Provider credentials are stored in the macOS Keychain. A release build will
  not write a key to disk in the clear under any circumstance: if the Keychain
  refuses, the operation fails with an explanation instead of silently
  downgrading protection. The 0600 `secrets.json` remains only as a
  **debug-build fallback**, and reading it is still allowed everywhere so that
  existing keys migrate into the Keychain and the plaintext copy is removed.
  Settings reports the real location per connection rather than claiming the
  Keychain unconditionally, which is what it did while the keys were in a file.
- SQLite stores provider metadata but should not store credential material.
- File paths are authorized in the backend (see below). Shell and Git commands
  are now gated on their working directory and recorded, but a command is an
  opaque string: containment can say where `bash` starts, not where it goes, and
  a command is free to `cd` elsewhere. That residual reach is covered by the
  audit record rather than by prevention, and must be read that way.
- `read_file` currently reads the complete file before slicing, so large-file
  memory use is a known risk.
- Path resolution now exists as a tested Rust primitive (`src-tauri/src/paths.rs`):
  it collapses `.`/`..` lexically, canonicalises the deepest existing ancestor so
  a target that does not exist yet still resolves, and reports whether the result
  lands inside the workspace root. Symlinks out of the tree, parent traversal and
  a sibling directory sharing the root's name prefix are all covered by tests.
  It is now enforced: the backend holds the workspace root (set by
  `set_workspace_root`, not readable or movable from the store), every file
  command resolves through it, and a path landing outside requires a grant.
  Grants are asked for in a **native dialog drawn by Rust**, so a compromised
  webview can neither skip the question nor answer it, and are kept in memory
  only — a grant never survives a restart or a change of folder.
- Read-only mode is implemented in the backend: `policy::require` gates every
  file and process command, and the switch is held in Rust so a compromised page
  cannot turn it off. Execution is refused alongside writing, deliberately — a
  shell command is opaque, so treating `sh build.sh` as a read would make the
  mode a promise the app cannot keep. It defaults off and is not persisted: a
  control that survives launches becomes a setting nobody notices instead of a
  choice somebody makes.
- Every file and process command now declares what it does — `Access::Read`,
  `Write` or `Execute` — at the command itself, so the classification is
  readable as a policy rather than appearing only where something is forbidden.
- Repository trust mode is still absent. Opening an untrusted repository grants
  it the same access as your own work.
- A restrictive CSP is now configured in `src-tauri/tauri.conf.json` and guarded
  by `config_tests` in `src-tauri/src/lib.rs`, so it cannot silently return to
  `null` or gain `'unsafe-inline'`/`'unsafe-eval'` in `script-src`. Verified
  against the production bundle served with the policy as a real header: inline
  script injection and cross-origin script loading are refused, outbound
  `fetch` is refused, and same-origin/blob workers and injected styles — which
  Monaco needs — still work. `img-src`/`media-src` keep `https:` only because
  generation providers return a remote URL for the finished asset; Step 13
  moves assets to disk and should then drop it.
- The Tauri capability set has been reviewed and reduced. A correction to an
  earlier note in this file: `fs:default` was never broad — it grants read
  access to the app's own directories only, and arbitrary files became readable
  because the dialog plugin adds each *picked* path to the fs scope at runtime.
  The real problem was that this was a second policy running beside path
  containment, deciding the same question by different rules and leaving no
  audit record — and it did not cover drag-and-drop, which is not a pick.
  Attachment reads and the file picker are now backend commands subject to
  containment, the fs plugin is granted nothing and is no longer registered or
  shipped, and a test keeps `fs:` out of the capability file.
- Webview isolation for the embedded browser window is still unreviewed, and no
  Tauri command performs per-capability authorization of its own.
- `npm audit --omit=dev --audit-level=high` currently reports 2 moderate/low
  vulnerabilities in DOMPurify pulled by Monaco. The available fix would force
  a breaking Monaco downgrade, so dependency remediation needs a deliberate
  compatibility decision and security review.
- Bash and Git have output/time limits and process-group handling. They now
  also resolve their working directory through the same containment gate as the
  file tools — with no directory given they run in the open project rather than
  wherever the app was launched from — and every invocation, including a refused
  one, is appended to `audit.log` in the app data directory (mode 0600, rotated
  at 2 MB, one generation kept). Credentials are stripped before anything is
  written: the log is precisely where a pasted key would otherwise land. There
  is no UI for reading the log yet.

## Required controls

1. Store secrets only in macOS Keychain for production builds (done). The dev
   fallback is compile-time gated on `debug_assertions`, labeled in the UI, and
   cannot be reached by a release artifact.
2. Redact secrets before logs, error strings, prompt assembly, tool traces,
   crash reports, screenshots and exports. Scan diffs and release bundles.
3. Canonicalize workspace roots and every requested path. Deny traversal,
   symlink escapes and external paths by default; explicit user grants are
   scoped and auditable.
4. Enforce read/write/execute/network capabilities in Rust commands, not just
   in React (read/write/execute done; network is not yet a declared capability).
   Read-only mode is a backend decision (done); repository trust is not yet
   implemented.
5. Run shell commands with bounded timeout, process group cancellation,
   output budgets, non-interactive defaults, confirmation for risky commands,
   and an append-only local audit record without sensitive arguments.
6. Set a restrictive CSP (done) and review webview/browser isolation and the
   Tauri capability set (outstanding). External pages must not gain access to
   Tauri commands or project files.
7. Treat model output and repository content as untrusted input. Show
   prompt-injection warnings and require confirmation before privilege changes,
   credential access or external network use.
8. Add dependency/license and clean-machine reviews before publication.

## Security acceptance

Step 2 is complete only when `SEC-01` proves offline/local operation and
`SEC-02` covers Keychain, redaction, path/symlink containment, trust/read-only,
permissions, shell cancellation, CSP and injected-content cases on a clean
profile. A passing happy-path agent run is not sufficient.
