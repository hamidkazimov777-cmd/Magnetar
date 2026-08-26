# Magnetar — implementation plan and parity matrix

Status: baseline captured 2026-08-26. This document is the executable plan; it
does not replace code-level verification.

## Rules of truth

- A feature is **implemented** only when code, automated coverage, edge-case
  coverage, documentation, and a passing build exist.
- **Partial** means the happy path exists but a production requirement is
  missing. **Planned** means no usable implementation exists yet.
- Competitor columns describe the established capability, not a promise about
  a particular vendor release. The acceptance criteria are Magnetar's contract.
- No subscription, paywall, mandatory account, proxy billing, or hidden web
  automation is in scope. BYOK and local providers remain first-class.

## Baseline audit

Inspected source, package manifests, Tauri configuration, existing handoffs,
release plan, test scripts, and git history on 2026-08-26.

Audit documents named in the request were not present in the repository or the
available attachment directory. They are therefore recorded as unavailable,
not treated as evidence. Existing handoff claims were reconciled against the
current source.

Key facts found in code:

- Tauri v2 + Rust backend, React 19 + TypeScript + Vite frontend, Monaco,
  SQLite/rusqlite, PTY, provider adapters for OpenAI-compatible, Anthropic and
  GigaChat, plus frontend generation adapters.
- Canonical sessions, messages, projects, facts, decisions, divergences, tasks
  and generation history are in SQLite. Connections/preferences remain partly
  in Zustand persistence.
- Agent tools include read/write/edit/list/grep/search, bash, git, delegation,
  decisions, memory flags and attachments. File edits and shell use frontend
  confirmation gates; backend authorization is not yet complete.
- LSP bridge exists for Rust, Python, Go and TypeScript/JavaScript with graceful
  fallback. This is not yet equivalent to a complete IDE intelligence layer.
- `src-tauri/src/index.rs` is an in-memory BM25 index with a hard 5,000-file cap.
- Provider secrets are currently stored in `secrets.json` mode 0600, with a
  one-time Keychain migration. This does not satisfy the production Keychain
  requirement and is a Step 2 blocker.
- `src-tauri/tauri.conf.json` currently has `csp: null`; this is a release
  blocker.
- `npm run build` passes but reports an unreachable duplicate `new_project`
  switch case, dynamic-import chunking warnings, and chunks up to about 3.96 MB.
- Rust tests pass 20/20. There is no frontend unit-test script in `package.json`.

## Feature parity matrix

Legend: ✅ implemented and verified in source; ◐ partial; □ planned; — not a
target or intentionally manual. Test IDs are mapped to quality gates below.

| Capability | Magnetar | VS Code | Cursor | Windsurf | Zed | Acceptance criteria / test scenario | Priority |
|---|---:|---:|---:|---:|---:|---|---:|
| Editor + syntax highlighting | ✅ Monaco | ✅ | ✅ | ✅ | ✅ | Open representative TS, Rust, Python, JSON, YAML, Markdown, CSS, HTML and Bash files; no crash. `IDE-01` | P0 |
| Tabs and unsaved state | ◐ | ✅ | ✅ | ✅ | ✅ | Edit, switch tabs, close/reopen, and verify dirty state and recovery behavior. `IDE-02` | P0 |
| Split panes / pinned tabs | □ | ✅ | ✅ | ✅ | ✅ | Split editor, pin tab, reopen project; layout and pin state survive session. `IDE-03` | P1 |
| Quick Open / file search | ✅ ⌘P | ✅ | ✅ | ✅ | ✅ | ⌘P filters 10k files, opens exact result, handles empty and duplicate names. `IDE-04` | P0 |
| Command palette | ✅ ⌘K | ✅ | ✅ | ✅ | ✅ | ⌘K lists commands, keyboard navigation and cancellation work. `IDE-05` | P0 |
| Workspace search | ✅ ranked BM25 | ✅ | ✅ | ✅ | ✅ | Search returns file/line hits and opens the result. `SEARCH-01` | P0 |
| Replace in workspace | ◐ exact, no regex | ✅ | ✅ | ✅ | ✅ | Preview selected files, apply, handle zero matches, failure and rerun. `SEARCH-02` | P0 |
| Regex search + cancellation | □ | ✅ | ✅ | ✅ | ✅ | Regex, timeout, result budget and cancel work on a large repository. `SEARCH-03` | P0 |
| Breadcrumbs / outline / symbols | ◐ LSP-dependent | ✅ | ✅ | ✅ | ✅ | Show structure without LSP via parser layer; LSP enriches it when available. `IDE-06` | P1 |
| Definition / implementation / references | ◐ LSP bridge | ✅ | ✅ | ✅ | ✅ | TS/Rust/Python/Go navigation works; missing server gives actionable fallback. `LSP-01` | P0 |
| Hover / completion / rename / code actions | ◐ LSP bridge | ✅ | ✅ | ✅ | ✅ | Live request, timeout, reconnect and unsupported-server behavior are visible. `LSP-02` | P0 |
| Formatting / organize imports / format-on-save | □ | ✅ | ✅ | ✅ | ✅ | Detect formatter, show failure, and never overwrite on formatter error. `LSP-03` | P1 |
| Diagnostics / Problems panel | ✅ checks + LSP | ✅ | ✅ | ✅ | ✅ | Parse compiler/linter output, click to location, preserve raw unparsed output. `LSP-04` | P0 |
| Multi-root workspaces | □ | ✅ | ✅ | ✅ | ✅ | Two roots have separate containment, index, diagnostics and file identity. `IDE-07` | P1 |
| Recent projects | ✅ | ✅ | ✅ | ✅ | ✅ | Open, close, reopen and remove stale path safely. `IDE-08` | P1 |
| Keybindings import/export | □ | ✅ | ✅ | ✅ | ✅ | Import VS Code-compatible bindings, detect conflicts, export round-trip. `IDE-09` | P1 |
| Git status / diff / stage / commit | ◐ status/diff/stage paths | ✅ | ✅ | ✅ | ✅ | Stage single file and hunk, inspect diff, commit, handle empty/index errors. `GIT-01` | P0 |
| Branch / merge / rebase / stash / cherry-pick | ◐ basic branch actions | ✅ | ✅ | ✅ | ✅ | Each operation is cancellable and conflict state is recoverable. `GIT-02` | P1 |
| Conflict resolver / blame / history / remotes | □ | ✅ | ✅ | ✅ | ✅ | Resolve a synthetic conflict, show blame/history and remote errors verbatim. `GIT-03` | P1 |
| Signed commits | □ | ✅ | ✅ | ✅ | ✅ | Detect configured signing, report unavailable identity, never prompt invisibly. `GIT-04` | P2 |
| Tasks and test execution | ◐ checks/scripts | ✅ | ✅ | ✅ | ✅ | Discover package.json/Cargo/Make/pyproject/just, run one test and suite. `TEST-01` | P0 |
| Test Explorer | □ | ✅ | ✅ | ✅ | ✅ | Discover, group, run, cancel and navigate individual tests. `TEST-02` | P1 |
| Debugger / DAP | □ | ✅ | ✅ | ✅ | ✅ | Node/Python baseline: breakpoint, variables, stack, step and console. `DEBUG-01` | P1 |
| Persistent incremental index | ◐ in-memory, capped | ✅ | ✅ | ✅ | ✅ | 1k/10k/50k/100k fixture, restart, watcher update, ignore rules, coverage shown. `PERF-01` | P0 |
| Lazy tree and large-file slicing | ◐ partial | ✅ | ✅ | ✅ | ✅ | Open 1 GB-ish fixture metadata without full read; paginate tree and messages. `PERF-02` | P0 |
| Agent durable runs / event log | ◐ UI loop/events | — | ✅ | ✅ | ◐ | Kill/restart during a run and resume from persisted `run_id`. `AGENT-01` | P0 |
| Pause / resume / cancellation / retry | ◐ frontend stop | — | ✅ | ✅ | ✅ | Cancel kills process group and provider request; retry uses bounded backoff. `AGENT-02` | P0 |
| Budgets / cost / context compaction | ◐ token stats/summary | — | ✅ | ✅ | ✅ | Per-run and per-agent budgets stop work with an explainable reason. `AGENT-03` | P0 |
| Checkpoint / diff / accept / rollback | ◐ file change undo | — | ✅ | ✅ | ✅ | Isolate task, review diff, accept/reject/rollback whole task and hunk. `CHANGE-01` | P0 |
| MCP client and permissions | □ | ◐ extensions | ✅ | ✅ | ◐ | Register server, authorize tool by capability, audit calls, deny by default. `INT-01` | P1 |
| Sandboxed plugin API | □ intentionally delayed | ✅ extensions | ✅ | ✅ | □ | No plugin gets filesystem/network by default; capability grant is visible. `INT-02` | P2 |
| Inline completion | □ | ✅ | ✅ | ✅ | ✅ | Ghost text accepts word/line/all, cancels stale requests, limits context and cost. `AI-01` | P1 |
| Provider-neutral memory / provenance | ✅ core identity | — | ◐ | ◐ | ◐ | Facts cite source, verification state and relevance; switching provider preserves canon. `MEM-01` | P0 |
| Decisions / divergence queue | ✅ | — | ◐ | ◐ | — | Contradictions queue without interrupting work and resolve with audit trail. `MEM-02` | P0 |
| Local-first / BYOK / no account | ✅ intended | — | ◐ | ◐ | ◐ | Offline UI/index works; only configured endpoints receive network traffic. `SEC-01` | P0 |
| Secrets / path policy / repository trust | ◐ frontend gates | — | ◐ | ◐ | ◐ | Keychain, canonical containment, trust/read-only modes and backend auth tests pass. `SEC-02` | P0 |
| Onboarding / transparent context | ◐ partial | ◐ | ✅ | ✅ | ✅ | First-run flow shows provider, model, context, cost, checkpoint and rollback. `UX-01` | P1 |
| Direct free macOS distribution | □ unsigned/local scripts | — | — | — | — | Universal signed/notarized artifact installs on clean Mac without account/paywall. `REL-01` | P0 |

## Ordered delivery

| Step | Scope | Exit gate |
|---:|---|---|
| 0 | Baseline, matrix, quality/security/release docs | This commit; baseline commands and gaps recorded |
| 1 | Warnings, frontend test harness, error reporting, smoke portability, CI | Clean typecheck/build/tests; no known compiler/build warnings |
| 2 | Keychain, containment, trust/read-only, permission model, CSP, secret scan | Security tests and clean-machine review |
| 3 | Canon migrations, FKs, cleanup, backup/import, integrity/recovery | Migration and crash-recovery tests |
| 4 | Professional editor workflow and settings/keybindings | `IDE-*` acceptance suite |
| 5 | LSP/parser layer and diagnostics | `LSP-*` acceptance suite for four languages plus graceful fallback |
| 6 | Git completion, tasks/tests, Test Explorer, Node/Python DAP | `GIT-*`, `TEST-*`, `DEBUG-*` |
| 7 | Persistent/incremental search, watcher, scale and budgets | `PERF-*` scale runs |
| 8 | Headless durable agent runtime | `AGENT-*` crash/resume/budget suite |
| 9 | Checkpoints, isolated changes and rollback | `CHANGE-*` whole-task/hunk recovery |
| 10 | MCP and restricted integration API | `INT-*` deny-by-default tests |
| 11 | Inline completion | `AI-*` privacy/cancellation/cost tests |
| 12 | UX/onboarding/transparency | `UX-*` first-run walkthrough |
| 13 | Keep Studio as secondary IDE utility | Generation history/asset metadata tests |
| 14 | Release candidate | All release gates green; no Apple account action |
| 15 | Apple signing/notarization/publication | Explicit user confirmation and external credentials |

## Next step

Start Step 1 with the known duplicate switch case and a minimal frontend test
harness. Do not broaden the change until those gates are green.
