# Magnetar architecture baseline

## Runtime shape

```text
React UI / Zustand stores
        │  agent loop (lib/agent.ts) · generation run chain (lib/genRun.ts)
        │ Tauri invoke + events
Rust commands and domain modules
        ├─ provider adapters (OpenAI-compatible, Anthropic, GigaChat)
        ├─ SQLite canonical store (rusqlite, WAL)
        ├─ workspace/memory/decisions/tasks
        ├─ agent tools, Git and process groups
        ├─ PTY and LSP subprocess bridges
        └─ persistent SQLite FTS5 code index
```

The provider-neutral canon is the product boundary: provider adapters translate
the same conversation and metadata into provider-specific wire formats.
Project facts, decisions, divergences and provenance are separate durable
entities. The UI owns the agent loop and the generation run chain — both
reuse the Tauri provider commands rather than maintaining a second runtime; Step 8
moves durable agent run state and event handling into a headless core.

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
tasks and generation history; a `workflows` table and `generations.run_id` exist
as a durable placeholder the current Studio does not yet use. Zustand persistence is
reserved for local UI preferences; secrets are in the Keychain (see
`SECURITY.md`).

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

## Generation Studio (V1)

Generation is a full-screen Studio, shipped as a simple linear design in two
files — not a graph engine. `src/lib/genStudio.ts` holds `GEN_MODELS`, a curated
registry where each model is one JSON entry with a `params` list; the Studio's
settings panel renders from `params`, so switching model rebuilds the UI with no
per-model hardcoding. Three wire shapes are supported: `openai_images`,
`chat_image` and `video_poll` (async task then polling).

`src/lib/genRun.ts` is the run chain: an optional LLM prompt-refinement step
(a toggle) → generation (image or async video poll) → a URL/data-URI result. It
runs in the frontend and reuses the Tauri provider commands (`complete`,
`generate*`) rather than adding a second runtime.

> **Divergence (found 2026-09-01).** Earlier revisions of this section described
> a "Workflow Engine V1" — a linear DAG of `input`/`llm`/`generation`/`output`
> nodes with `ModelRef`, `src/lib/modelRegistry.ts`, `src/lib/workflow.ts` and
> `src/lib/workflowEngine.ts`. **That engine is not built** (the files do not
> exist); the simple Studio above is what ships. **Decided (owner, 2026-09-01):
> the simple Studio is the final V1; the graph engine is not planned.**

## Trust boundaries

The webview is untrusted presentation code; Rust commands are the security
boundary. Path authorization, capabilities, trust/read-only state and CSP are
now enforced in Rust and covered by tests (see `SECURITY.md`). Model output,
repository text and embedded browser content are untrusted inputs.

## Planned evolution

- Step 1: make failures observable and testable.
- Step 2: enforce security in Rust and harden the webview.
- Step 3: make schema migrations and recovery explicit.
- Steps 4–7: complete IDE primitives and replace capped in-memory search with a
  persistent incremental index.
- Steps 8–10: make agent runs durable, reviewable and capability-scoped.
- Steps 11–14: add non-blocking completion, onboarding and release packaging.
