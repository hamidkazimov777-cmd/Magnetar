#!/usr/bin/env node
/* One-command build verification: frontend type-check + build, Rust tests, and
 * a deterministic fixture — then a short human checklist. No API keys or
 * network needed.
 *
 * Run: npm run smoke
 *
 * Live API checks stay manual (they cost tokens): node scripts/e2e-test.mjs
 * and node scripts/agent-e2e.mjs "<task>".
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, ".magnetar-test", "fixture");

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;

/* `cargo` lives under ~/.cargo/bin, which is not always on PATH in a fresh
 * shell — resolve it the way the app's own build does. */
function cargoBin() {
  if (spawnSync("cargo", ["--version"], { stdio: "ignore" }).status === 0) return "cargo";
  const alt = join(homedir(), ".cargo", "bin", "cargo");
  return existsSync(alt) ? alt : "cargo";
}

const results = [];
function run(name, cmd, args, cwd = ROOT) {
  console.log(`\n${bold("▶ " + name)}${dim(`  ${[cmd, ...args].join(" ")}`)}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  const pass = r.status === 0;
  results.push({ name, pass });
  console.log(`  ${pass ? green("PASS") : red("FAIL")}  ${name}`);
  return pass;
}

console.log(bold("\n🧲 Magnetar — прогон сборки\n"));

let ok = true;
ok = run("TypeScript (noEmit)", join(ROOT, "node_modules", ".bin", "tsc"), ["--noEmit"]) && ok;
ok = run("Vite build", "npm", ["run", "build"]) && ok;
ok = run("Rust tests", cargoBin(), ["test"], join(ROOT, "src-tauri")) && ok;
ok = run("Фикстура", "node", ["scripts/gen-fixture.mjs"]) && ok;

console.log(bold("\nСтупень 2 — проверь в приложении (2–3 мин):"));
console.log(`  1. Открыть папку (⌘K → «Открыть папку»): ${FIXTURE}`);
console.log("  2. Дерево: раскрыть bulk/ → 300+ файлов скроллятся плавно; свернуть/раскрыть dirNN;");
console.log("     deep/ — цепочка из 12 уровней; .env виден, прочие dotfiles скрыты.");
console.log("  3. Проблемы: панель «Проблемы» → «Запустить все» → cargo check даёт ~300 ошибок;");
console.log("     клик по ошибке открывает src/main.rs на нужной строке.");
console.log("  4. Чат (по желанию): длинный ответ → скролл и автоскролл к низу.");

if (existsSync(join(ROOT, ".magnetar-test", "keys.json"))) {
  console.log(dim("\nЕсть keys.json — живой API-прогон отдельно:"));
  console.log(dim("  node scripts/e2e-test.mjs"));
  console.log(dim('  node scripts/agent-e2e.mjs "<задача>"'));
} else {
  console.log(dim("\nНет keys.json — живой API-прогон пропущен. Чтобы включить:"));
  console.log(dim("  cp .magnetar-test/keys.example.json .magnetar-test/keys.json"));
}

const failed = results.filter((r) => !r.pass).length;
const total = results.length;
console.log(
  `\n${bold(ok ? green(`Авто-проверки: ${total - failed}/${total} пройдены`) : red(`Авто-проверки: упало ${failed} из ${total}`))}\n`,
);
process.exit(ok ? 0 : 1);
