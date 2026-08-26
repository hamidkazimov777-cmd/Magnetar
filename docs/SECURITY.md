# Magnetar security baseline and target policy

Status: baseline audit 2026-08-26. This is a security contract, not evidence
that every target control is already implemented.

## Product boundary

Magnetar is local-first and BYOK. It has no mandatory account, subscription,
paywall, billing proxy, telemetry, or hidden automation of third-party web
subscriptions. Network calls are allowed only to endpoints explicitly
configured by the user or to a local provider.

## Observed implementation

- Provider credentials are currently in app-data `secrets.json` with mode 0600;
  the code can migrate legacy Keychain entries once. This is weaker than the
  required production posture and must be replaced in Step 2.
- SQLite stores provider metadata but should not store credential material.
- File and shell mutations have frontend confirmation preferences. Frontend
  confirmation is not a sufficient authorization boundary because a client can
  be tampered with; backend enforcement is a Step 2 requirement.
- `read_file` currently reads the complete file before slicing, so large-file
  memory use is a known risk.
- Path containment, symlink policy, repository trust, read-only mode and
  per-capability authorization are not yet a complete backend policy.
- Tauri CSP is currently `null`; release cannot proceed with this value.
- `npm audit --omit=dev --audit-level=high` currently reports 2 moderate/low
  vulnerabilities in DOMPurify pulled by Monaco. The available fix would force
  a breaking Monaco downgrade, so dependency remediation needs a deliberate
  compatibility decision and security review.
- Bash and Git have output/time limits and process-group handling, but the
  policy still needs a uniform audit record, cancellation contract and explicit
  external-path authorization.

## Required controls

1. Store secrets only in macOS Keychain for production builds. Dev fallback,
   if retained, must be compile-time/dev-only, clearly labeled, and never used
   by a release artifact.
2. Redact secrets before logs, error strings, prompt assembly, tool traces,
   crash reports, screenshots and exports. Scan diffs and release bundles.
3. Canonicalize workspace roots and every requested path. Deny traversal,
   symlink escapes and external paths by default; explicit user grants are
   scoped and auditable.
4. Enforce read/write/execute/network capabilities in Rust commands, not just
   in React. Repository trust and read-only mode must be backend decisions.
5. Run shell commands with bounded timeout, process group cancellation,
   output budgets, non-interactive defaults, confirmation for risky commands,
   and an append-only local audit record without sensitive arguments.
6. Set a restrictive CSP and review webview/browser isolation. External pages
   must not gain access to Tauri commands or project files.
7. Treat model output and repository content as untrusted input. Show
   prompt-injection warnings and require confirmation before privilege changes,
   credential access or external network use.
8. Add dependency/license and clean-machine reviews before publication.

## Security acceptance

Step 2 is complete only when `SEC-01` proves offline/local operation and
`SEC-02` covers Keychain, redaction, path/symlink containment, trust/read-only,
permissions, shell cancellation, CSP and injected-content cases on a clean
profile. A passing happy-path agent run is not sufficient.
