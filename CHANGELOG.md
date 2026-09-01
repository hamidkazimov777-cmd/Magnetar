# Changelog

## Unreleased

### Added

- Durable agent runs. A run is recorded in SQLite (schema v4: `agent_runs` plus
  an append-only `agent_events` trace) so it survives a restart instead of
  vanishing with the store; the record carries status, steps, tokens and budgets.
- Startup reconciliation: runs left in flight when the app closed are marked
  `interrupted` and surfaced as a dismissible banner (ru/en/es).
- Per-run token budget (`agentMaxTokens`, Settings slider, default 400k, 0 = off)
  that stops a run with an explainable reason before it burns tokens unbounded.
- Roll back a whole agent run: every edit is stamped with its run id and the
  Changes panel groups a run's edits under one "roll back the whole run" action,
  alongside the existing per-file undo.
- Opt-in AI inline completion (ghost text) in the editor, from the user's own
  model, with a capped context window, debounced requests and stale-request
  cancellation (`agentMaxTokens` unaffected; `inlineCompletion` off by default).
- The generation Studio gallery is now durable: results are saved to SQLite and
  restored when the Studio reopens, instead of vanishing with the session.

### Fixed

- Indexing a large project no longer takes minutes. The initial index build was
  quadratic (a per-file FTS5 delete that scanned a growing index); a 50k-file
  first sync dropped from ~10 minutes to ~5.6 seconds. Incremental re-sync and
  query times were already fast and are unchanged.

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
- Generation Studio (data-driven): a curated `GEN_MODELS` registry
  (`src/lib/genStudio.ts`) where each model is one JSON entry and the settings
  panel renders from its `params` — switching model rebuilds the UI with no
  per-model hardcoding (`openai_images` / `chat_image` / `video_poll` wire shapes).
- A generation run chain (`src/lib/genRun.ts`): an optional LLM prompt-refinement
  step, then image or async-video generation, reusing the Tauri provider commands.
- SQLite schema v3 adds a durable `workflows` table and `generations.run_id` as a
  placeholder for a future graph engine (not yet used by the Studio). Note: an
  earlier changelog entry described a full "Workflow Engine V1" DAG that was not
  built; the shipped Studio is the simpler linear design above.

### Git, tasks and debugging

- Stage, unstage and discard individual hunks, not only whole files.
- Branches: switch, create, delete, check out a remote branch locally, and
  merge or rebase between them.
- Stashes: push, pop, drop.
- A conflict banner during a merge, rebase or cherry-pick: it lists the
  conflicted files and offers continue (once resolved) or abort.
- Blame on the current line, file history, and remote management.
- Commits are signed when the repository is configured to.
- A Tasks panel discovers commands from package.json, Cargo, Makefile,
  pyproject and justfile, and runs them in the terminal.
- A debugger over DAP: breakpoints, call stack, variables, watches, stepping
  and a debug console. First-class for Python via debugpy; Node needs js-debug.

### Language intelligence

- Formatting and format-on-save, taken from the language server because the
  formatter is the project's decision. Off by default.
- Code actions and organize imports.
- Document symbols from the server, and workspace symbol search on ⌘T that asks
  every running server rather than only the current file's.
- Semantic tokens, remapped from each server's own legend.
- Outline and breadcrumbs work without a language server at all, for
  TypeScript, JavaScript, Rust, Python, Go, shell, Markdown, JSON and YAML.
- The Problems panel reports what each language server is doing, with the
  install line when one is missing and a restart button when one has given up.

### Performance

- The code index is persistent (SQLite FTS5), one database per workspace,
  incremental, and no longer capped at 5,000 files. A file watcher keeps it
  current; .gitignore is honoured.
- Index coverage — files indexed and skipped — shows in the status bar.
- `read_file` streams a line window instead of reading the whole file first.
- Launching no longer loads every message of every conversation; a
  conversation's messages load when it is opened.
- Background memory work (summaries, extraction) runs through a bounded,
  prioritised queue instead of racing as unbounded promises.

### Editor and search

- Project search has a real engine: regex or literal, case and whole-word, with
  a result budget, a deadline and cancellation. It reports which of the three
  stopped it instead of returning a short list that looks complete.
- Replace runs on the same engine, so the list shown before a replace is the
  list that gets replaced, and a truncated scan says so before anything is
  written.
- Tabs can be pinned: pinned tabs sort first and survive "close all".
- A second file can be opened beside the first.
- Optional autosave, off by default, debounced so a file is written when the
  edits stop rather than mid-word.
- Breadcrumbs show where the open file lives.
- VS Code chords work alongside Magnetar's own — ⌘⇧P opens the command palette
  — and a `keybindings.json` can be imported, with anything unhonourable named.
- Settings export and import as a file: preferences, bindings, theme and
  language, and nothing secret.

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

- Generation Studio: fixed dropdown list clipping in the settings sidebar.
- Generation Studio: dynamic models loading for OpenRouter/TokenRouter, allowing generation through `chat-proxy` for all multimodal API models instead of hardcoding `openai/dall-e-3`.
- Settings: fixed the provider model count hardcoding so proxy providers display the correct number of fetched models.
- Generation Studio: the model picker now selects a provider first and lists only
  that provider's generative models, instead of showing every OpenRouter text
  model. The LLM node picker applies the same provider-first filtering.


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

- (UI) Moved the track switcher (Chat / Agent / Generation) from the left Activity Bar directly into the headers of the Agent/Chat and Studio panels for better contextual UX.
- (Fix) Fixed a stale closure bug in the Monaco editor where pressing Cmd+S would save an empty string, breaking Project Memory fact extraction for newly created files.

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
