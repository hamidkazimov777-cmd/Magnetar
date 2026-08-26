# Changelog

## Unreleased

### Added

- Step 0 baseline implementation plan with feature-parity matrix and acceptance IDs.
- Quality gates, security policy, architecture baseline and release checklist.
- Frontend Vitest harness and a frontend/Rust CI workflow.
- Shared redacted error normalization and reporting, plus bounded transient
  retry with `AbortSignal` cancellation.
- Vitest coverage for the agent's text-tool-call recovery and confirmation
  rules, project-memory prompt assembly and background-model selection,
  handoff/summarisation, fact provenance and rendering, machine verification,
  verify-spec construction and file leases.
- Rust unit tests for the BM25 index: tokenising, binary/lockfile and skip-dir
  rules, oversized-file skipping, ranking with snippet line numbers, the result
  budget and rebuild-on-root-change.
- README section documenting the five offline verification gates.

### Changed

- Removed the confirmed unreachable duplicate `new_project` agent case and the
  redundant dynamic imports; only the known Monaco chunk-size warning remains.
- Routed store persistence/hydration and background memory, graph and LSP
  failures through the redacted error reporter instead of swallowing them.
- Made the smoke fixture portable by defaulting it to the OS temp directory.
- Moved the editor route and Monaco engine out of the initial workspace chunk;
  initial entry is ~408.75 KB gzip, with the lazy Monaco budget documented.

### Known gaps

- `src/lib/store.ts` is still a single 1,373-line store awaiting a domain split.
- In-memory index capped at 5,000 files, with no persistence or watcher.
- Plaintext-at-rest `secrets.json` development posture pending Keychain hardening.
- No backend authorization boundary, path containment policy or CSP.
- Networked npm audit identifies 2 moderate/low DOMPurify advisories pulled
  through Monaco; no forced downgrade has been applied.
