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
- Cross-domain store tests covering folder close, reveal-in-file, project
  adoption, model-per-conversation, track switching and the memory queue.

### Security

- Replaced `csp: null` with a deny-by-default content security policy, and
  guarded it with Rust tests so it cannot silently weaken. Verified against the
  production bundle: inline and cross-origin scripts are refused and the webview
  cannot open its own network connections, while Monaco's workers and injected
  styles keep working.

### Changed

- Removed the confirmed unreachable duplicate `new_project` agent case and the
  redundant dynamic imports; only the known Monaco chunk-size warning remains.
- Routed store persistence/hydration and background memory, graph and LSP
  failures through the redacted error reporter instead of swallowing them.
- Made the smoke fixture portable by defaulting it to the OS temp directory.
- Moved the editor route and Monaco engine out of the initial workspace chunk;
  initial entry is ~408.9 KB gzip, with the lazy Monaco budget documented.
- Split the 1,373-line `src/lib/store.ts` into ten domain slices under
  `src/lib/stores/`; `store.ts` now holds composition and persistence only.

### Known gaps

- In-memory index capped at 5,000 files, with no persistence or watcher.
- Plaintext-at-rest `secrets.json` development posture pending Keychain hardening.
- No backend authorization boundary or path containment policy; the Tauri
  capability set still grants `fs:default` and no command authorizes itself.
- Networked npm audit identifies 2 moderate/low DOMPurify advisories pulled
  through Monaco; no forced downgrade has been applied.
