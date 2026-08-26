# Magnetar architecture baseline

## Runtime shape

```text
React UI / Zustand stores
        │ Tauri invoke + events
Rust commands and domain modules
        ├─ provider adapters (OpenAI-compatible, Anthropic, GigaChat)
        ├─ SQLite canonical store (rusqlite, WAL)
        ├─ workspace/memory/decisions/tasks
        ├─ agent tools, Git and process groups
        ├─ PTY and LSP subprocess bridges
        └─ in-memory BM25 index (temporary; Step 7 replaces it)
```

The provider-neutral canon is the product boundary: provider adapters translate
the same conversation and metadata into provider-specific wire formats.
Project facts, decisions, divergences and provenance are separate durable
entities. The UI currently owns parts of agent orchestration and routing; Step 8
moves durable run state and event handling into a headless core.

## Frontend state

One Zustand store, composed from domain slices in `src/lib/stores/`: providers,
shell, workspace, editor, sessions, projects, memory, diagnostics, agent run and
startup. `src/lib/store.ts` composes them and owns persistence; `stores/state.ts`
is the sum type every slice is written against.

It is one store rather than ten because the domains genuinely touch each other —
closing a folder clears editor tabs and unreviewed changes, selecting a project
re-points the live conversation, revealing a problem opens a tab. Separate
stores would move that coupling somewhere harder to see. Those cross-domain
actions are covered by `src/lib/store.test.ts`.

## Durable data

SQLite holds sessions/messages, projects, memory facts, decisions, divergences,
tasks and generation history. Zustand persistence is reserved for local UI
preferences; secrets are in the Keychain (see `SECURITY.md`).

Project-scoped tables declare a foreign key to `projects` with `ON DELETE
CASCADE`, so deleting a project removes what belonged to it instead of leaving
rows nothing can show and nothing can remove.

Memory has one shape and one renderer. Facts and decisions are the canon; the
prose columns on `projects` are read as a fallback for unmigrated projects and
are never written. `buildMemorySection` renders them for every consumer — the
agent, plain chat, and the subscription bridge — because three renderings meant
three answers to the same question depending on where you stood.

Large payloads stay out of rows that are read constantly: attachment metadata
lives in the message row and its bytes in a file under the app data directory,
fetched when the attachment is actually rendered.

## Trust boundaries

The webview is untrusted presentation code; Rust commands are the security
boundary. That boundary is incomplete today: path authorization, capabilities,
trust/read-only state and CSP are Step 2 work. Model output, repository text,
MCP data and embedded browser content are untrusted inputs.

## Planned evolution

- Step 1: make failures observable and testable.
- Step 2: enforce security in Rust and harden the webview.
- Step 3: make schema migrations and recovery explicit.
- Steps 4–7: complete IDE primitives and replace capped in-memory search with a
  persistent incremental index.
- Steps 8–10: make agent runs durable, reviewable and capability-scoped.
- Steps 11–14: add non-blocking completion, onboarding and release packaging.
