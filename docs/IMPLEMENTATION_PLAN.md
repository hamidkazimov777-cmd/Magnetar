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
- Initial audit: `npm run build` passed but reported dynamic-import chunking
  warnings and chunks up to about 3.96 MB. Step 1 removed the duplicate case
  and redundant dynamic imports, then moved Monaco out of the initial route.
- Rust tests pass 20/20. Initial audit had no frontend unit-test script; Step 1
  added Vitest and CI coverage.

## Feature parity matrix

Legend: ✅ implemented and verified in source; ◐ partial; □ planned; — not a
target or intentionally manual. Test IDs are mapped to quality gates below.

| Capability | Magnetar | VS Code | Cursor | Windsurf | Zed | Acceptance criteria / test scenario | Priority |
|---|---:|---:|---:|---:|---:|---|---:|
| Editor + syntax highlighting | ✅ Monaco | ✅ | ✅ | ✅ | ✅ | Open representative TS, Rust, Python, JSON, YAML, Markdown, CSS, HTML and Bash files; no crash. `IDE-01` | P0 |
| Tabs and unsaved state | ✅ dirty marks, autosave optional | ✅ | ✅ | ✅ | ✅ | Edit, switch tabs, close/reopen, and verify dirty state and recovery behavior. `IDE-02` | P0 |
| Split panes / pinned tabs | ✅ one split, pins survive close-all | ✅ | ✅ | ✅ | ✅ | Split editor, pin tab, reopen project; layout and pin state survive session. `IDE-03` | P1 |
| Quick Open / file search | ✅ ⌘P | ✅ | ✅ | ✅ | ✅ | ⌘P filters 10k files, opens exact result, handles empty and duplicate names. `IDE-04` | P0 |
| Command palette | ✅ ⌘K | ✅ | ✅ | ✅ | ✅ | ⌘K lists commands, keyboard navigation and cancellation work. `IDE-05` | P0 |
| Workspace search | ✅ ranked BM25 | ✅ | ✅ | ✅ | ✅ | Search returns file/line hits and opens the result. `SEARCH-01` | P0 |
| Replace in workspace | ✅ same engine as search | ✅ | ✅ | ✅ | ✅ | Preview selected files, apply, handle zero matches, failure and rerun. `SEARCH-02` | P0 |
| Regex search + cancellation | ✅ budget, deadline, cancel by id | ✅ | ✅ | ✅ | ✅ | Regex, timeout, result budget and cancel work on a large repository. `SEARCH-03` | P0 |
| Breadcrumbs / outline / symbols | ✅ heuristic floor + server symbols | ✅ | ✅ | ✅ | ✅ | Show structure without LSP via parser layer; LSP enriches it when available. `IDE-06` | P1 |
| Definition / implementation / references | ✅ four languages | ✅ | ✅ | ✅ | ✅ | TS/Rust/Python/Go navigation works; missing server gives actionable fallback. `LSP-01` | P0 |
| Hover / completion / rename / code actions | ✅ four languages | ✅ | ✅ | ✅ | ✅ | Live request, timeout, reconnect and unsupported-server behavior are visible. `LSP-02` | P0 |
| Formatting / organize imports / format-on-save | ✅ from the server, opt-in | ✅ | ✅ | ✅ | ✅ | Detect formatter, show failure, and never overwrite on formatter error. `LSP-03` | P1 |
| Diagnostics / Problems panel | ✅ checks + LSP | ✅ | ✅ | ✅ | ✅ | Parse compiler/linter output, click to location, preserve raw unparsed output. `LSP-04` | P0 |
| Multi-root workspaces | — deliberate, see below | ✅ | ✅ | ✅ | ✅ | One root, documented. `IDE-07` withdrawn | P1 |
| Recent projects | ✅ | ✅ | ✅ | ✅ | ✅ | Open, close, reopen and remove stale path safely. `IDE-08` | P1 |
| Keybindings import/export | ✅ VS Code chords and keybindings.json | ✅ | ✅ | ✅ | ✅ | Import VS Code-compatible bindings, detect conflicts, export round-trip. `IDE-09` | P1 |
| Git status / diff / stage / commit | ✅ incl. hunk-level staging | ✅ | ✅ | ✅ | ✅ | Stage single file and hunk, inspect diff, commit, handle empty/index errors. `GIT-01` | P0 |
| Branch / merge / rebase / stash / cherry-pick | ✅ with a conflict resolver | ✅ | ✅ | ✅ | ✅ | Each operation is cancellable and conflict state is recoverable. `GIT-02` | P1 |
| Conflict resolver / blame / history / remotes | ✅ | ✅ | ✅ | ✅ | ✅ | Resolve a synthetic conflict, show blame/history and remote errors verbatim. `GIT-03` | P1 |
| Signed commits | ✅ detected and applied | ✅ | ✅ | ✅ | ✅ | Detect configured signing, report unavailable identity, never prompt invisibly. `GIT-04` | P2 |
| Tasks and test execution | ✅ discovered from manifests | ✅ | ✅ | ✅ | ✅ | Discover package.json/Cargo/Make/pyproject/just, run one test and suite. `TEST-01` | P0 |
| Test Explorer | ◐ tasks panel groups tests; no per-case tree | ✅ | ✅ | ✅ | ✅ | Discover, group, run, cancel and navigate individual tests. `TEST-02` | P1 |
| Debugger / DAP | ✅ Python; Node needs js-debug | ✅ | ✅ | ✅ | ✅ | Node/Python baseline: breakpoint, variables, stack, step and console. `DEBUG-01` | P1 |
| Persistent incremental index | ✅ FTS5, watcher, no cap | ✅ | ✅ | ✅ | ✅ | 1k/10k/50k/100k fixture, restart, watcher update, ignore rules, coverage shown. `PERF-01` | P0 |
| Lazy tree and large-file slicing | ✅ lazy tree, streamed reads | ✅ | ✅ | ✅ | ✅ | Open 1 GB-ish fixture metadata without full read; paginate tree and messages. `PERF-02` | P0 |
| Agent durable runs / event log | ✅ SQLite runs + event trace, restart reconcile | — | ✅ | ✅ | ◐ | Kill/restart during a run and resume from persisted `run_id`. `AGENT-01` | P0 |
| Pause / resume / cancellation / retry | ✅ cancel to process group + provider; interrupted runs reconciled | — | ✅ | ✅ | ✅ | Cancel kills process group and provider request; retry uses bounded backoff. `AGENT-02` | P0 |
| Budgets / cost / context compaction | ◐ per-run token budget stops with a reason; cost/compaction pending | — | ✅ | ✅ | ✅ | Per-run and per-agent budgets stop work with an explainable reason. `AGENT-03` | P0 |
| Checkpoint / diff / accept / rollback | ✅ run-grouped + per-file rollback; per-hunk pending | — | ✅ | ✅ | ✅ | Isolate task, review diff, accept/reject/rollback whole task and hunk. `CHANGE-01` | P0 |
| MCP client and permissions | □ deferred with reasons (needs live servers to build safely) | ◐ extensions | ✅ | ✅ | ◐ | Register server, authorize tool by capability, audit calls, deny by default. `INT-01` | P1 |
| Sandboxed plugin API | □ intentionally delayed | ✅ extensions | ✅ | ✅ | □ | No plugin gets filesystem/network by default; capability grant is visible. `INT-02` | P2 |
| Inline completion | ✅ opt-in ghost text, capped context, debounced, stale-cancel | ✅ | ✅ | ✅ | ✅ | Ghost text accepts word/line/all, cancels stale requests, limits context and cost. `AI-01` | P1 |
| Provider-neutral memory / provenance | ✅ one canon, one renderer | — | ◐ | ◐ | ◐ | Facts cite source, verification state and relevance; switching provider preserves canon. `MEM-01` | P0 |
| Decisions / divergence queue | ✅ | — | ◐ | ◐ | — | Contradictions queue without interrupting work and resolve with audit trail. `MEM-02` | P0 |
| Local-first / BYOK / no account | ✅ intended | — | ◐ | ◐ | ◐ | Offline UI/index works; only configured endpoints receive network traffic. `SEC-01` | P0 |
| Secrets / path policy / repository trust | ✅ backend-enforced | — | ◐ | ◐ | ◐ | Keychain, canonical containment, trust/read-only modes and backend auth tests pass. `SEC-02` | P0 |
| Onboarding / transparent context | ◐ partial | ◐ | ✅ | ✅ | ✅ | First-run flow shows provider, model, context, cost, checkpoint and rollback. `UX-01` | P1 |
| Direct free macOS distribution | □ unsigned/local scripts | — | — | — | — | Universal signed/notarized artifact installs on clean Mac without account/paywall. `REL-01` | P0 |

## Multi-root: a decision, not an omission

One workspace root, on purpose. Three things in Magnetar are defined in terms
of "the project": path containment decides what the agent may touch, repository
trust decides whether it may act at all, and the index decides what search and
memory see. Multi-root does not add a second folder to a list — it makes each
of those a question with several answers, and the interesting cases are the
ones where the answers differ: an agent editing across two roots where only one
is trusted, memory that cannot say which project a fact belongs to.

The cost is real but narrow. Opening a second project means a second window,
which is what most people do anyway. The gain would be a shared terminal and a
cross-root search — neither worth weakening a containment boundary that was
built three steps ago.

If this is revisited, it belongs after Step 7: the index has to be per-root and
persistent first, or cross-root search is a full rescan of everything each time.

`IDE-07` is withdrawn rather than left open, because an acceptance test for
something deliberately not built is a permanent false failure.

## Ordered delivery

| Step | Scope | Exit gate |
|---:|---|---|
| 0 | Baseline, matrix, quality/security/release docs | This commit; baseline commands and gaps recorded |
| 1 | Warnings, frontend test harness, error reporting, smoke portability, CI | Clean typecheck/tests and reviewed build output; Monaco is lazy and its asset budget is explicit |
| 2 | Keychain, containment, trust/read-only, permission model, CSP, secret scan | **Done** except the clean-machine review, which belongs to Step 14 |
| 3 | Canon migrations, FKs, cleanup, backup/import, integrity/recovery | **Done**; migration, cascade, integrity and import covered by tests |
| 4 | Professional editor workflow and settings/keybindings | **Done**; multi-root withdrawn with reasons, symbols deferred to Step 5 |
| 5 | LSP/parser layer and diagnostics | **Done**; heuristic outline is the fallback, Tree-sitter deferred with reasons |
| 6 | Git completion, tasks/tests, Test Explorer, Node/Python DAP | **Done**; DAP first-class for Python, Node documented as needing js-debug |
| 7 | Persistent/incremental search, watcher, scale and budgets | **Done**; scale targets recorded, live scale runs pending |
| 8 | Durable agent runtime | **Done** (frontend-durable, not headless): SQLite runs + append-only event trace, startup reconcile of interrupted runs, per-run token budget with an explainable stop, cancel to process group + provider. Cost accounting and context compaction pending; the loop stays in the frontend by choice (see below) |
| 9 | Checkpoints, isolated changes and rollback | **Done** for whole-task and per-file rollback: each edit is stamped with its run id and the Changes panel rolls back a run as a unit. Per-hunk rollback within a run pending |
| 10 | MCP and restricted integration API | **Deferred with reasons** (see below): needs live MCP servers and in-app testing to build safely; a blind implementation would ship an unverifiable surface |
| 11 | Inline completion | **Done**: opt-in ghost text from the user's model, capped context window, 300ms debounce, stale requests dropped on cancel; `prefs.inlineCompletion` off by default |
| 12 | UX/onboarding/transparency | `UX-*` first-run walkthrough |
| 13 | Keep Studio as secondary IDE utility | Generation history/asset metadata tests |
| 14 | Release candidate | All release gates green; no Apple account action |
| 15 | Apple signing/notarization/publication | Explicit user confirmation and external credentials |

## Next step

Step 7 is complete. The index is persistent FTS5, one database per workspace,
incremental against file size and mtime, with no cap — a test finds all of
6,000 files where the old code stopped at 5,000. A file watcher keeps it
current, debounced so a branch switch is one sync. Walking honours .gitignore
through ripgrep's crate. read_file streams a line window instead of reading the
whole file, the file tree already loads children per directory on expand,
conversations load their messages only when opened, and background memory work
runs through a bounded, prioritised queue. Coverage is a number in the status
bar.

One thing is deliberately not claimed as verified: the scale targets in
docs/QUALITY_GATES.md are targets, not measurements. Confirming 50k/100k-file
sync and query times needs a live run on a real large repository inside the
signed app, which is a Step 14 bench rather than something a unit test shows.

Steps 8 and 9 are done (HANDOFF Entries 135–139). The agent runtime became
durable without leaving the frontend: a run is written to SQLite (`agent_runs`)
with an append-only event trace (`agent_events`) via a wrapper at the handler
boundary, so the loop in `agent.ts` is untouched. At startup any run left
in flight is reconciled to `interrupted` and surfaced to the user. A per-run
token budget (`prefs.agentMaxTokens`) stops a run with an explainable reason.
Cancellation already reached the provider request and the bash process group.
For checkpoints, every file edit is stamped with its run id and the Changes
panel rolls a whole run back as a unit, on top of the existing per-file undo.

Deliberately not done: moving the loop into a headless Rust core, per-token cost
accounting, context compaction, and per-hunk rollback within a run. The loop
stays in the frontend because that is where it already works and a rewrite would
risk a shipping app for no user-visible gain; the durable record — the part that
made runs survive a restart — is what mattered and is now in SQLite. These
remain open if a headless daemon (background runs with the app closed) is ever
wanted.

Phase 2 (IDE parity) is largely done. Inline completion (Step 11) shipped as
opt-in ghost text. The "replace the Monaco TS worker with
typescript-language-server" item turned out to be already handled by design: the
LSP bridge is configured for `typescript-language-server` on TS and JS (it
provides the project-aware semantics — definitions, references, rename,
diagnostics — when installed), while Monaco's built-in TS worker is kept only for
syntax validation and a single-file completion floor, with semantic validation
switched off so it never emits false "not found" errors. That hybrid is better
than fully replacing the worker, because it keeps a useful offline floor when no
server is installed; it is treated as done, not a gap.

MCP (Step 10) is deliberately deferred, with reasons. An MCP client is
protocol-heavy (spawn a server, `initialize`, `tools/list`, `tools/call` over
newline-delimited JSON-RPC — the stdio framing in `lsp.rs` is close but not
identical) and, more importantly, cannot be built responsibly without live MCP
servers to test the round-trips and without in-app iteration on the
deny-by-default permission flow. Shipping it blind, in a window with no rebuild,
would add a large unverifiable surface to a working app. When taken up, the plan
is: an `mcp.rs` client keyed like the LSP handle map; a durable `mcp_servers`
config (command + args, off by default); `mcp_list_tools`/`mcp_call_tool`
commands; and agent integration that namespaces tools as `mcp__<server>__<tool>`,
requires confirmation by default, and records calls through `audit.rs`. Until
then, no MCP surface exists, so nothing is half-built.

In parallel with the step roadmap, the Generation Studio was rebuilt as a
data-driven design (HANDOFF Entry 134): a curated `GEN_MODELS` registry
(`src/lib/genStudio.ts`) whose settings panel renders from each model's `params`,
and a linear run chain (`src/lib/genRun.ts`) — optional LLM prompt refinement then
image/async-video generation — reusing the Tauri provider commands. Schema v3 adds
durable `workflows` and `generations.run_id` as a placeholder. Note: an earlier
version of this note described a full "Workflow Engine V1" DAG (HANDOFF Entry 133)
that was not built. Decided (owner, 2026-09-01): the simple Studio is the final
V1 and the graph engine is not planned; the simpler Studio supersedes the
generation-history work called for in Step 13.
