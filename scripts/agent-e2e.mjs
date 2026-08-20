// A control-group agent run: the app's real system prompt and real tool
// definitions, driven straight against the provider's HTTP API with none of
// Magnetar's frontend in between.
//
// The point is differential: the user runs the same prompt inside the app on
// the same model. Whatever the model does here is what the model is capable of;
// anything the app does differently is the app's doing, not the model's.
//
// Run:  node scripts/agent-e2e.mjs "<task>" [sandbox-dir]
// Keys: .magnetar-test/keys.json (gitignored)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const conns = JSON.parse(readFileSync(join(ROOT, ".magnetar-test/keys.json"), "utf8"));
const c = conns[0];

const TASK = process.argv[2] ?? "Say hello.";
const SANDBOX = process.argv[3] ?? "/tmp/magnetar-e2e";
mkdirSync(SANDBOX, { recursive: true });

/* ---------------------------------------------------------------------------
   The prompt and the tool list are READ OUT OF THE APP'S SOURCE, not copied.
   A copy drifts, and then the control group stops being a control group.
   --------------------------------------------------------------------------- */
const agentSrc = readFileSync(join(ROOT, "src/lib/agent.ts"), "utf8");

const SYSTEM = (() => {
  const m = agentSrc.match(/export const AGENT_SYSTEM = `([\s\S]*?)`;\n/);
  if (!m) throw new Error("AGENT_SYSTEM not found in agent.ts");
  return m[1].replace(/\\`/g, "`").replace(/\\\$/g, "$");
})();

const TOOLS = (() => {
  const m = agentSrc.match(/export const AGENT_TOOLS: ToolDef\[\] = (\[[\s\S]*?\n\]);\n/);
  if (!m) throw new Error("AGENT_TOOLS not found in agent.ts");
  const defs = new Function(`return ${m[1]}`)();
  return defs.map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.parameters },
  }));
})();

/* --------------------------------------------------------------------------- */

const log = [];
const say = (line) => {
  console.log(line);
  log.push(line);
};

const resolve = (p) => {
  const s = String(p ?? "").trim();
  if (!s || s === "." || s === "/" || s === "./") return SANDBOX;
  if (s.startsWith("/")) return s.startsWith(SANDBOX) ? s : join(SANDBOX, s);
  return join(SANDBOX, s.replace(/^\.\//, ""));
};

// The model gets a shell. It gets it inside the sandbox, and it does not get
// the handful of commands that are destructive outside it.
const FORBIDDEN = /\b(sudo|rm\s+-rf\s+\/(?!tmp)|pkill|killall|shutdown|mkfs|dd\s+if=|git\s+push|:\(\)\s*\{)/;

function sh(cmd, cwd, timeoutMs = 120000) {
  return new Promise((res) => {
    execFile("/bin/bash", ["-lc", cmd], { cwd, timeout: timeoutMs, maxBuffer: 4e6 }, (err, stdout, stderr) => {
      const code = err?.code ?? 0;
      res(`exit ${code}\n--- stdout\n${stdout.slice(0, 4000)}\n--- stderr\n${(stderr || "").slice(0, 2000)}`);
    });
  });
}

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name.startsWith(".venv")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

async function execTool(name, args) {
  try {
    switch (name) {
      case "read_file": {
        const t = readFileSync(resolve(args.path), "utf8").split("\n");
        const from = args.offset ? Number(args.offset) - 1 : 0;
        const to = args.limit ? from + Number(args.limit) : t.length;
        return t.slice(from, to).join("\n");
      }
      case "list_dir": {
        const d = resolve(args.path);
        return (
          readdirSync(d, { withFileTypes: true })
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .join("\n") || "(empty)"
        );
      }
      case "grep":
      case "search_code": {
        const pat = String(args.pattern ?? args.query ?? "");
        const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const hits = [];
        for (const f of walk(resolve(args.path ?? "."))) {
          if (statSync(f).size > 400000) continue;
          let txt = "";
          try { txt = readFileSync(f, "utf8"); } catch { continue; }
          txt.split("\n").forEach((line, i) => {
            if (re.test(line) && hits.length < 40)
              hits.push(`${relative(SANDBOX, f)}:${i + 1}: ${line.trim().slice(0, 160)}`);
          });
        }
        return hits.join("\n") || "(no matches)";
      }
      case "write_file": {
        const p = resolve(args.path);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, String(args.content ?? ""));
        return `wrote ${String(args.content ?? "").length} bytes`;
      }
      case "edit_file": {
        const p = resolve(args.path);
        const src = readFileSync(p, "utf8");
        const oldS = String(args.old_string ?? "");
        if (!src.includes(oldS)) return "error: old_string not found";
        writeFileSync(p, src.replace(oldS, String(args.new_string ?? "")));
        return "replaced 1";
      }
      case "run_bash": {
        const cmd = String(args.command ?? "");
        if (FORBIDDEN.test(cmd)) return "error: refused by the harness (destructive outside the sandbox)";
        return await sh(cmd, resolve(args.cwd ?? "."));
      }
      case "ask_decision": {
        // The control group answers the way a reasonable user would, and says
        // so in the log, so the comparison stays honest.
        const answer = "Choose whatever is simplest and most standard; do not add dependencies beyond what is needed.";
        say(`  ?? ask_decision: ${args.question}`);
        say(`     → answered: ${answer}`);
        return `The user answered: ${answer}`;
      }
      case "flag_memory": {
        say(`  !! flag_memory: ${String(args.summary).slice(0, 120)}`);
        return "Noted for the user to review. Carry on.";
      }
      case "attach_file":
        return `attached ${args.path}`;
      default:
        return `unknown tool: ${name}`;
    }
  } catch (e) {
    return `error: ${String(e).slice(0, 300)}`;
  }
}

async function chat(messages) {
  const body = {
    model: c.model,
    messages,
    stream: false,
    // Kimi's models reject every temperature but their own; the app retries
    // without the field, so the control group sends it the same way.
    temperature: 1,
    tools: TOOLS,
    tool_choice: "auto",
  };
  const r = await fetch(`${c.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/* --------------------------------------------------------------------------- */

const started = Date.now();
const messages = [
  { role: "system", content: `${SYSTEM}\n\n## Workspace root\n${SANDBOX}\nAll relative paths resolve here.` },
  { role: "user", content: TASK },
];

let steps = 0;
let inTok = 0;
let outTok = 0;
const MAX_STEPS = 40;

say(`\n=== control run · ${c.model} · ${SANDBOX}\n`);

for (let i = 0; i < MAX_STEPS; i++) {
  let d;
  try {
    d = await chat(messages);
  } catch (e) {
    say(`\n!! provider error: ${String(e).slice(0, 400)}`);
    break;
  }
  const u = d.usage ?? {};
  inTok += u.prompt_tokens ?? 0;
  outTok += u.completion_tokens ?? 0;
  const msg = d.choices?.[0]?.message ?? {};
  const calls = msg.tool_calls ?? [];

  if (msg.content?.trim()) say(`\n[${i + 1}] ${msg.content.trim().slice(0, 600)}`);

  if (!calls.length) {
    say(`\n=== finished after ${i + 1} model turns`);
    break;
  }

  messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });

  for (const tc of calls) {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
    steps += 1;
    const brief = JSON.stringify(args).slice(0, 140);
    say(`  → ${tc.function.name} ${brief}`);
    const result = await execTool(tc.function.name, args);
    say(`     ${result.split("\n")[0].slice(0, 120)}`);
    messages.push({ role: "tool", tool_call_id: tc.id, content: result.slice(0, 12000) });
  }
}

const files = existsSync(SANDBOX) ? walk(SANDBOX).map((f) => relative(SANDBOX, f)) : [];
say(`\n=== summary`);
say(`tool calls: ${steps}`);
say(`tokens: in ${inTok} / out ${outTok}`);
say(`seconds: ${Math.round((Date.now() - started) / 1000)}`);
say(`files created (${files.length}):\n${files.map((f) => "  " + f).join("\n")}`);

writeFileSync(join(SANDBOX, "..", "magnetar-e2e-log.txt"), log.join("\n"));
