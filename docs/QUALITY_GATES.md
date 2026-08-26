# Magnetar quality gates

Baseline date: 2026-08-26. A check marked “current” is observed, not a release
claim.

## Required commands

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke
```

The frontend currently has no unit-test script. Step 1 must add Vitest and a
`test:unit` script, then the required command set becomes:

```bash
npm run typecheck
npm run test:unit -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run smoke
```

Live provider checks are opt-in only and must use a gitignored fixture. They are
never required for an offline build.

## Current baseline

- Rust: 20 tests passed.
- Frontend production build: passed.
- Build warning: large Monaco-related chunks (largest observed ~3.96 MB).
  Duplicate agent and redundant dynamic-import warnings were removed in Step 1.
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
