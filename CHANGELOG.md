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

### Memory and data

- Project memory has one renderer. The agent, plain chat and the subscription
  bridge were each building it differently — two of them from prose fields that
  could not say where anything came from — so the same question produced
  different answers depending on which tab you were in.
- The background extractor writes facts and decisions instead of appending
  prose that grew without limit and carried no provenance.
- The knowledge graph is out of the interface. Its retrieval was substring
  matching over the last three messages, and it was a third representation of
  the same conversation carrying neither provenance nor verification. Its data
  and tables are untouched.
- Project-scoped tables now declare a foreign key with `ON DELETE CASCADE`.
  Deleting a project used to set a timestamp and leave its facts, decisions,
  contradictions, proposals, tasks and timeline in the database for good.
- Memory exports can be imported. Import is additive, reports what it skipped,
  and never carries a verification across machines.
- Added a database backup (`VACUUM INTO`, refuses to overwrite) and a health
  check that reports and never repairs.
- Attachments survive a restart: metadata in the message row, bytes in a file,
  fetched when the image is actually rendered.

### Fixed

- Path containment and repository trust were inert after a restart: the
  workspace root is restored from local storage, but the backend only heard
  about it through a user action. The first signed run found this.
- Provider keys are kept in a single Keychain item instead of one per
  connection, so a rebuild costs one password prompt rather than one per key.
- Dragging a file onto the window no longer asks permission to work outside the
  project folder: the drop is now observed by the backend, which grants it the
  same way the file picker does.
- The audit redactor matched credential markers inside other words, so a
  provider hostname was recorded as `api.token[REDACTED]` and
  `git checkout secrets.ts` would have been mangled the same way.

### Security

- Path containment is now enforced in the backend: the workspace root is held
  in Rust, every file command resolves `.`/`..` and symlinks before acting, and
  a path outside the open folder requires the user's approval in a native
  dialog the webview cannot draw, answer or skip. Grants live in memory only and
  are dropped when the folder changes.
- `grep`, `run_bash` and `git` with no directory given now act on the open
  project rather than whatever directory the app was launched from.
- Every provider host contacted is recorded once per run in the audit log, host
  and port only.
- Tool results that appear to address the model — attempts to override its
  instructions, reassign its role, hide activity from the user or exfiltrate a
  key — are marked as data before the agent reads them, and the system prompt
  states the rule regardless of whether detection fired.
- Added `npm run scan:secrets`: scans the working tree and the built bundle for
  provider keys, cloud credentials and private-key blocks, and fails if a
  credential file is tracked by git. Runs in smoke and CI.
- Added repository trust: a folder that has not been vouched for can be read
  but not written to, and no command runs in it. A banner offers to trust it;
  the choice is remembered per folder.
- Added read-only mode: the app can read the project but not change it or run
  commands. Enforced in Rust, toggled from the status bar, off by default.
- Every file and process command declares whether it reads, writes or executes.
- `npm run build:app` builds and signs in one step, so an unsigned rebuild can
  no longer reset the Keychain's permission.
- Provider keys are stored in the macOS Keychain again, and existing keys
  migrate out of `secrets.json` on first read. A release build refuses to write
  a key to disk in the clear; the plaintext file survives only as a debug
  fallback. Settings now reports where a key actually is instead of always
  saying "Keychain".
- Attachment reads and the attachment file picker moved into backend commands,
  so they answer to path containment like every other file operation. The `fs`
  plugin is no longer granted, registered or shipped.
- Fixed: dragging an image into the composer could not be read, because the
  runtime file-scope grant only covers a path chosen through the picker.
- Shell and Git invocations are recorded to a local, owner-only `audit.log`,
  with credentials stripped before writing. Refused commands are recorded too.

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
