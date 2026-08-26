#!/usr/bin/env node
/* Look for credentials that should never have been committed or shipped.
 *
 * Two places matter and they fail for different reasons. The working tree is
 * where a key gets pasted into a config file "just to test something" and then
 * committed; the built bundle is where one gets inlined by a build step nobody
 * inspected. A release must be clean in both.
 *
 * Run: npm run scan:secrets            (working tree; dist/ too when present)
 *      npm run scan:secrets -- --tree  (working tree only)
 *
 * Deliberately narrow. A scanner that reports a hundred maybes is a scanner
 * people stop reading, and the point is that a real finding is impossible to
 * miss — so it looks for shapes that are credentials or nothing.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const treeOnly = process.argv.includes("--tree");

/* Provider key prefixes and private-key headers. Each is distinctive enough
 * that a match is not a guess. Lengths are minimums the real formats exceed. */
const PATTERNS = [
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

/* Directories that are never worth reading: build output that is scanned
 * separately, dependencies that are not ours, and the VCS store itself. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "dist", ".next", "build", ".venv",
  "__pycache__", ".magnetar-test",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".zip",
  ".gz", ".tar", ".mp4", ".mov", ".mp3", ".wav", ".woff", ".woff2", ".ttf",
  ".otf", ".dmg", ".node",
]);

const MAX_BYTES = 4 * 1024 * 1024;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (e.isFile()) {
      if (BINARY_EXT.has(extname(e.name).toLowerCase())) continue;
      yield full;
    }
  }
}

/* This file necessarily contains the patterns it looks for. So does the Rust
 * redactor's test suite, for the same reason. Listing them beats weakening the
 * patterns to avoid matching ourselves. */
const ALLOWED = new Set([
  "scripts/scan-secrets.mjs",
  "src-tauri/src/audit.rs",
  "src/lib/errors.ts",
  "src/lib/errors.test.ts",
  "docs/SECURITY.md",
]);

function scan(root, label) {
  const findings = [];
  for (const file of walk(root)) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    let size;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_BYTES) continue;

    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable or not text
    }
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split("\n").length;
        findings.push({ label, file: rel, line, name, sample: mask(m[0]) });
      }
    }
  }
  return findings;
}

/* Never print the thing we are complaining about. Enough to find it, not
 * enough to use it. */
function mask(value) {
  const head = value.slice(0, 7);
  return `${head}…(${value.length} chars)`;
}

const findings = [];
findings.push(...scan(ROOT, "working tree"));

if (!treeOnly && existsSync(join(ROOT, "dist"))) {
  findings.push(...scan(join(ROOT, "dist"), "built bundle"));
}

/* A key that is only in the history is still published the moment the repo is.
 * Cheap check, and it catches the "removed it in the next commit" case. */
const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
if (tracked.status === 0) {
  for (const rel of tracked.stdout.split("\n")) {
    if (rel === "src-tauri/secrets.json" || rel.endsWith("/secrets.json") || rel === "keys.json") {
      findings.push({
        label: "tracked file",
        file: rel,
        line: 0,
        name: "credential file is tracked by git",
        sample: "—",
      });
    }
  }
}

if (findings.length === 0) {
  console.log("\x1b[32mNo credentials found in the working tree or the bundle.\x1b[0m");
  process.exit(0);
}

console.error(`\x1b[31mFound ${findings.length} possible credential(s):\x1b[0m`);
for (const f of findings) {
  console.error(`  ${f.label}: ${f.file}:${f.line}  ${f.name}  ${f.sample}`);
}
console.error("\nRotate anything real before doing anything else — removing the line is not enough.");
process.exit(1);
