// End-to-end verification of Magnetar's INTENDED behavior against your real
// models. Reads connections from .magnetar-test/keys.json (gitignored — never
// commit keys). Replicates the exact request shapes the app uses.
//
// Run:  node scripts/e2e-test.mjs
//
// keys.json format (OpenAI-compatible endpoints):
// [
//   { "name": "Qwen",     "baseUrl": "https://openrouter.ai/api/v1", "key": "sk-...", "model": "qwen/qwen-2.5-72b-instruct" },
//   { "name": "DeepSeek", "baseUrl": "https://api.deepseek.com",     "key": "sk-...", "model": "deepseek-chat" },
//   { "name": "GLM",      "baseUrl": "...",                          "key": "...",   "model": "..." }
// ]

import { readFileSync } from "node:fs";

const KEYS_PATH = new URL("../.magnetar-test/keys.json", import.meta.url);
let conns;
try {
  conns = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
} catch {
  console.error(
    "\n❌ Не найден .magnetar-test/keys.json\n" +
      "   Скопируй .magnetar-test/keys.example.json → keys.json и впиши свои ключи.\n",
  );
  process.exit(1);
}

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const ok = (b) => (b ? green("PASS") : red("FAIL"));

const ep = (base, p) => `${base.replace(/\/$/, "")}/${p}`;

async function listModels(c) {
  const r = await fetch(ep(c.baseUrl, "models"), {
    headers: { Authorization: `Bearer ${c.key}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  const arr = j.data ?? j;
  return (arr || []).map((m) => m.id).filter(Boolean);
}

async function chat(c, messages, { tools, temperature = 0.2 } = {}) {
  const body = { model: c.model, messages, stream: false, temperature };
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const r = await fetch(ep(c.baseUrl, "chat/completions"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message ?? {};
}

const results = [];
const rec = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`  ${ok(pass)}  ${name}${detail ? dim("  — " + detail) : ""}`);
};

console.log(bold("\n🧲 Magnetar — проверка задуманного поведения\n"));

// Per-connection basics.
for (const c of conns) {
  console.log(bold(`● ${c.name}`) + dim(`  ${c.baseUrl}`));
  try {
    const models = await listModels(c);
    rec(`${c.name}: /models`, models.length > 0, `${models.length} моделей`);
    if (!c.model) c.model = models[0];
  } catch (e) {
    rec(`${c.name}: /models`, false, String(e).slice(0, 120));
  }
  try {
    const m = await chat(c, [{ role: "user", content: "Reply with exactly: OK" }]);
    rec(`${c.name}: чат-ответ`, /ok/i.test(m.content || ""), (m.content || "").slice(0, 40));
  } catch (e) {
    rec(`${c.name}: чат-ответ`, false, String(e).slice(0, 120));
  }
  try {
    const tools = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
    ];
    const m = await chat(
      c,
      [{ role: "user", content: "Read the file ./README.md using your tool." }],
      { tools },
    );
    const called = (m.tool_calls?.length ?? 0) > 0;
    rec(`${c.name}: tool-use (агент)`, called, called ? "вернул tool_call" : "без tool_call → пойдёт ReAct");
  } catch (e) {
    rec(`${c.name}: tool-use (агент)`, false, String(e).slice(0, 120));
  }
  console.log();
}

// Cross-model handoff: info given to model A must be recalled by model B via the
// shared canon (this is the whole point of the app).
if (conns.length >= 2) {
  console.log(bold("● Межмодельный handoff (память между моделями)"));
  const A = conns[0];
  const B = conns[1];
  const token = "ZX-" + Math.floor(1000 + Math.random() * 9000);
  try {
    const a = await chat(A, [
      { role: "user", content: `Запомни секретный токен проекта: ${token}. Ответь коротко «принято».` },
    ]);
    // Build the provider-neutral canon (as Magnetar stores it) and hand it to B.
    const canon = [
      { role: "user", content: `Запомни секретный токен проекта: ${token}. Ответь коротко «принято».` },
      { role: "assistant", content: a.content || "принято" },
      { role: "user", content: "Какой секретный токен проекта я называл ранее? Ответь только токеном." },
    ];
    const b = await chat(B, canon);
    const recalled = (b.content || "").includes(token);
    rec(
      `${A.name} → ${B.name}: новая модель помнит контекст`,
      recalled,
      recalled ? `вспомнила ${token}` : `ответ: ${(b.content || "").slice(0, 40)}`,
    );
  } catch (e) {
    rec(`handoff ${A.name} → ${B.name}`, false, String(e).slice(0, 120));
  }

  // Memory-first: give B only a SUMMARY (not the full history) and check recall —
  // proves the rolling-summary/brain approach carries context cheaply.
  try {
    const summary = `Проект: локальный сайт. Решение: секретный токен = ${token}. Следующий шаг: добавить футер.`;
    const b = await chat(B, [
      { role: "system", content: `## Память проекта (handoff)\n${summary}\nПродолжай из памяти, не переспрашивай.` },
      { role: "user", content: "Какой секретный токен в памяти проекта? Ответь только токеном." },
    ]);
    const recalled = (b.content || "").includes(token);
    rec(`${B.name}: работа из памяти (summary)`, recalled, recalled ? `вспомнила ${token}` : (b.content || "").slice(0, 40));
  } catch (e) {
    rec(`${B.name}: работа из памяти`, false, String(e).slice(0, 120));
  }
  console.log();
}

const passed = results.filter((r) => r.pass).length;
console.log(bold(`Итог: ${passed}/${results.length} проверок пройдено\n`));
process.exit(passed === results.length ? 0 : 1);
