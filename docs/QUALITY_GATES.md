# Magnetar quality gates

Baseline date: 2026-08-26. A check marked “current” is observed, not a release
claim.

## Required commands

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke
```

The frontend test harness is Vitest; the required command set is:

```bash
npm run typecheck
npm run test:unit -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run scan:secrets
npm run smoke
```

`npm run smoke` runs the secret scan itself, after the build, so it sees `dist/`
as well as the working tree — a key inlined by a build step is invisible in the
source.

Live provider checks are opt-in only and must use a gitignored fixture. They are
never required for an offline build.

## Current baseline

- Rust: 86 tests passed, covering tools, DB migrations, LSP framing, UTF-8
  streaming, the workspace/memory round trip and the BM25 index (tokenising,
  skip rules, ranking, result budget and rebuild-on-root-change), plus the
  Step 2 security controls: path containment and symlink escape, the read-only
  and trust policy, credential redaction in the audit log, the content security
  policy and the capability file, plus the schema migration that gives a project
  ownership of its memory, the database health check and the backup.
- Migration rehearsal: `MAGNETAR_MIGRATE_FIXTURE=<copy> cargo test
  an_existing_database` runs the real migration against a copy of an existing
  database and fails if any row that belonged to a project is lost. It skips
  when the variable is unset, so it never depends on anyone's private data.
  Make the copy with `VACUUM INTO`, not `cp`: on 2026-08-27 a plain file copy
  of the live database contained 22 projects, 434 facts and no messages, while
  `VACUUM INTO` of the same database gave 24, 495 and 7 — the difference was
  sitting in the write-ahead log.
- Frontend: 149 tests passed across 16 files, covering redaction, retry and
  cancellation, agent guards and text-tool-call recovery, memory prompt
  assembly and background-model selection, handoff/summarisation, fact
  provenance and rendering, machine verification, verify-spec construction and
  file leases, the store's cross-domain actions after the slice split, and the
  prompt-injection detector including its false-positive cases, memory import
  and attachment persistence.
- Frontend production build: passed.
- Build warning: the lazy Monaco engine chunk is ~3.96 MB; the initial route is
  ~1.4 MB raw / 408.75 KB gzip. Duplicate agent and redundant dynamic-import
  warnings were removed in Step 1; the lazy asset budget remains explicit.
- Smoke script exists; its fixture defaults to the OS temp directory and can be
  overridden with `MAGNETAR_FIXTURE_DIR`. Some UI checks remain manual.
- CI workflow now runs frontend typecheck/unit/build and macOS Rust test/check;
  integration, security, performance and packaging jobs remain to be added.

## Targets

| Gate | Target | Evidence |
|---|---|---|
| TypeScript | zero errors | `npm run typecheck` |
| Rust | zero warnings in check/clippy for release scope | `cargo check`, `cargo clippy` |
| Unit tests | all deterministic tests pass, including error/empty/retry/cancel cases | Vitest + Rust tests |
| Smoke | clean fixture, no user-specific absolute paths | `npm run smoke` |
| Build | no actionable warnings; gzip JS budget ≤ 600 KB initial route | Vite report |
| Startup | first useful UI ≤ 2 s on reference Mac after warm cache | recorded benchmark |
| Search | 1k files ≤ 1 s, 10k ≤ 3 s, 50k ≤ 8 s initial; incremental update ≤ 500 ms | `PERF-01` |
| File open | bounded memory and no full read for sliced agent requests | `PERF-02` |
| Agent | cancellation reaches provider/process group; no orphan child | `AGENT-02` |
| Security | no secret in logs, DB, localStorage, prompt, trace or git | `SEC-01/02` |
| Release | universal signed/notarized artifact installs on a clean supported Mac | `REL-01` |

Performance measurements must record machine, OS, repository fixture, cold vs
warm state, and command version. Do not hide a regression by raising a budget.

## Acceptance-test IDs

The authoritative feature scenarios are in `docs/IMPLEMENTATION_PLAN.md`. Each
step adds automated coverage for the IDs it closes and links the test file from
the handoff entry.
