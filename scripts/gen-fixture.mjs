#!/usr/bin/env node
/* Deterministic fixture project for the build smoke run.
 *
 * Generates an OS-temp fixture — a project large enough that the
 * virtualized panels actually have something to virtualize:
 *   - a wide/deep file tree (file-tree virtualization),
 *   - a Rust crate with 300 deliberate type errors (problems-list
 *     virtualization via `cargo check`, no network, cargo is already required
 *     to build the app itself).
 *
 * Idempotent: wipes and recreates from scratch every run; the content is
 * byte-identical thanks to a seeded PRNG, so "works / broke" is comparable
 * between builds.
 *
 * Run: node scripts/gen-fixture.mjs
 * Override location with MAGNETAR_FIXTURE_DIR for manual UI testing.
 */

import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/* The fixture lives in a VISIBLE folder (no dot-directories) so it can be
 * opened from the standard folder picker, next to real Magnetar projects. */
const FIXTURE = process.env.MAGNETAR_FIXTURE_DIR ?? join(tmpdir(), "magnetar-fixture");

/* Deterministic PRNG (mulberry32) so the fixture never changes between runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w) => String(n).padStart(w, "0");

rmSync(FIXTURE, { recursive: true, force: true });
mkdirSync(FIXTURE, { recursive: true });

/* --- Rust crate: 300 deliberate type errors ------------------------------ */
const ERROR_COUNT = 300;
const lines = ["fn main() {}"];
for (let i = 0; i < ERROR_COUNT; i++) lines.push(`const _V${pad(i, 3)}: u32 = "x";`);
mkdirSync(join(FIXTURE, "src"), { recursive: true });
writeFileSync(join(FIXTURE, "src", "main.rs"), lines.join("\n") + "\n");
writeFileSync(
  join(FIXTURE, "Cargo.toml"),
  '[package]\nname = "fixture"\nversion = "0.1.0"\nedition = "2021"\n',
);

/* --- Wide + deep file tree ------------------------------------------------ */
const rnd = mulberry32(20260824);
const bulk = join(FIXTURE, "bulk");
mkdirSync(bulk, { recursive: true });

for (let i = 0; i < 300; i++) {
  writeFileSync(join(bulk, `f${pad(i, 3)}.txt`), `file ${i}\n${rnd()}\n`);
}
for (let d = 0; d < 40; d++) {
  const dir = join(bulk, `dir${pad(d, 2)}`);
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < 10; f++) {
    writeFileSync(join(dir, `n${pad(f, 2)}.md`), `# ${d}-${f}\n\n${rnd()}\n`);
  }
}

let deep = join(FIXTURE, "deep");
mkdirSync(deep, { recursive: true });
for (let i = 0; i < 12; i++) {
  deep = join(deep, `level${pad(i, 2)}`);
  mkdirSync(deep, { recursive: true });
}
writeFileSync(join(deep, "leaf.txt"), "bottom of a deep chain\n");

/* Dotfiles: .env is surfaced by the tree, the rest are hidden. */
writeFileSync(join(FIXTURE, ".env"), "FIXTURE_SECRET=not-a-real-secret\n");
mkdirSync(join(FIXTURE, ".hidden"), { recursive: true });
writeFileSync(join(FIXTURE, ".hidden", "invisible.txt"), "hidden\n");
writeFileSync(join(FIXTURE, ".gitignore"), "target/\n");

/* --- summary -------------------------------------------------------------- */
let files = 0;
let dirs = 0;
(function walk(p) {
  for (const e of readdirSync(p)) {
    if (e === "target" || e === ".git") continue;
    const full = join(p, e);
    if (statSync(full).isDirectory()) {
      dirs += 1;
      walk(full);
    } else {
      files += 1;
    }
  }
})(FIXTURE);

console.log(`Фикстура готова: ${FIXTURE}`);
console.log(`  файлов: ${files}, папок: ${dirs}, ошибок в src/main.rs: ${ERROR_COUNT}`);
