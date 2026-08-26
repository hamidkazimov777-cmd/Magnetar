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

## Durable data

SQLite currently holds sessions/messages, projects, memory facts, decisions,
divergences, tasks and generation history. Zustand persistence is reserved for
local UI preferences and connection metadata, subject to the Step 2 secret
policy. Attachments and generated assets require explicit metadata/file
boundaries before release.

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
