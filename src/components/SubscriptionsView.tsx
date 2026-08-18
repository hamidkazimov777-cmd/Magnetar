import { useState } from "react";
import { Globe, Copy, Check, ClipboardPaste, ArrowDownToLine } from "lucide-react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore } from "../lib/store";
import { db } from "../lib/db";
import { useT } from "../lib/i18n";
import { LogoMark } from "./Logo";

const PROVIDERS = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com", color: "#10a37f" },
  { id: "claude", name: "Claude", url: "https://claude.ai", color: "#c96442" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", color: "#4285f4" },
  { id: "grok", name: "Grok", url: "https://grok.com", color: "#888" },
];

/** Build a portable project brief the user can paste into a subscription AI. */
async function buildProjectContext(): Promise<string> {
  const st = useStore.getState();
  const p = st.projects.find((x) => x.id === st.activeProjectId);
  const session = st.sessions.find((s) => s.id === st.activeSessionId);
  const parts: string[] = ["# Project context (exported from Magnetar)"];

  if (p) {
    parts.push(`## Project: ${p.name}`);
    if (p.description) parts.push(`Description: ${p.description}`);
    if (p.techStack) parts.push(`Tech stack:\n${p.techStack}`);
    if (p.architectureNotes) parts.push(`Architecture:\n${p.architectureNotes}`);
    if (p.decisions) parts.push(`Key decisions:\n${p.decisions}`);
    if (p.codingStandards) parts.push(`Coding standards:\n${p.codingStandards}`);
    try {
      const tasks = await db.listTasks(p.id);
      const open = tasks.filter((t) => (t.status || "").toUpperCase() !== "DONE");
      if (open.length)
        parts.push(
          `## Open tasks\n${open.map((t) => `- [${t.status}] ${t.title}`).join("\n")}`,
        );
    } catch {
      /* ignore */
    }
  }

  if (session?.summary) parts.push(`## Conversation summary so far\n${session.summary}`);
  if (session) {
    const tail = session.messages
      .slice(-6)
      .filter((m) => m.content)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    if (tail) parts.push(`## Recent messages\n${tail}`);
  }

  parts.push(
    "\n---\nUse this context to continue the work. Reply with your analysis or changes.",
  );
  return parts.join("\n\n");
}

export function SubscriptionsView() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [imported, setImported] = useState(false);

  const openProvider = async (id: string, url: string, name: string) => {
    const label = `subs-${id}`;
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return;
      }
    } catch {
      /* ignore */
    }
    const w = new WebviewWindow(label, {
      url,
      title: name,
      width: 960,
      height: 800,
    });
    w.once("tauri://error", (e) => console.error("webview error", e));
  };

  const copyContext = async () => {
    const ctx = await buildProjectContext();
    try {
      await navigator.clipboard.writeText(ctx);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  const importReply = () => {
    const text = reply.trim();
    if (!text) return;
    const st = useStore.getState();
    let sid = st.activeSessionId;
    if (!sid) sid = st.newSession();
    st.addMessage(sid, {
      role: "assistant",
      content: text,
      model: "external-subscription",
    });
    st.persistMessage(sid, st.sessions.find((s) => s.id === sid)!.messages.slice(-1)[0].id);
    setReply("");
    setImported(true);
    setTimeout(() => setImported(false), 1500);
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark size={30} />
          <div>
            <h1 className="text-lg font-semibold">{t("subscriptions")}</h1>
            <p className="text-sm text-[var(--color-text-dim)]">{t("subsIntro")}</p>
          </div>
        </div>

        {/* In-app browser */}
        <div className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-[var(--color-text-dim)]">
            {t("subsOpenTitle")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => openProvider(p.id, p.url, p.name)}
                className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]"
              >
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg"
                  style={{ background: `${p.color}22`, color: p.color }}
                >
                  <Globe size={18} />
                </span>
                <span className="text-sm text-[var(--color-text)]">{p.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-dim)]">{t("subsHint")}</p>
        </div>

        {/* Context bridge */}
        <div className="space-y-4 rounded-xl border border-[var(--color-border)] p-5">
          <div className="text-sm font-medium">{t("subsBridgeTitle")}</div>

          <button
            onClick={copyContext}
            className="flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t("subsCopied") : t("subsCopyContext")}
          </button>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-dim)]">
              <ClipboardPaste size={15} />
              {t("subsPasteLabel")}
            </div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              placeholder={t("subsPastePlaceholder")}
              className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={importReply}
              disabled={!reply.trim()}
              className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-3.5 py-2 text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            >
              {imported ? <Check size={15} /> : <ArrowDownToLine size={15} />}
              {imported ? t("subsImported") : t("subsImport")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
