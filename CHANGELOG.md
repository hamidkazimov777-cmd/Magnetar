# Changelog

## Unreleased

### Added

- Step 0 baseline implementation plan with feature-parity matrix and acceptance IDs.
- Quality gates, security policy, architecture baseline and release checklist.
- Frontend Vitest harness with initial guard, relevance and adaptive-routing tests.

### Documented gaps

- Current in-memory 5,000-file index limit.
- Plaintext-at-rest `secrets.json` development posture pending Keychain hardening.
- Missing frontend unit-test script, backend authorization boundary and CSP.
- Existing build warnings and large Monaco-related chunks.
- Initial sandbox npm audit was unavailable; a networked review now identifies
  2 moderate/low DOMPurify issues pulled through Monaco.
- Removed redundant dynamic-import warnings; only the known Monaco chunk-size
  warning remains. Networked audit identifies DOMPurify issues via Monaco.
- Routed store persistence and hydration failures through the shared redacted
  error reporter instead of silently swallowing DB errors.
- Removed the confirmed unreachable duplicate `new_project` agent case.
- Made the smoke fixture portable by defaulting it to the OS temp directory.
- Added shared redacted error normalization/reporting and a frontend/Rust CI workflow.
- Added bounded transient retry with AbortSignal cancellation coverage; routed
  background memory, graph and LSP failures through redacted reporting.
- Moved the editor route and Monaco engine out of the initial workspace chunk;
  initial entry is ~408.75 KB gzip, with the lazy Monaco budget documented.
