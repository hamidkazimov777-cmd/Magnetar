import { useState } from "react";
import {
  Globe,
  Copy,
  Check,
  ClipboardPaste,
  ArrowDownToLine,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore } from "../lib/store";
import { db } from "../lib/db";
import { useT } from "../lib/i18n";
import { LogoMark } from "./Logo";

interface ProviderDef {
  id: string;
  name: string;
  url: string;
  color: string;
}

/** Google refuses OAuth from anything it recognises as an embedded webview
 *  ("this browser may not be secure"), and presenting Safari's user agent is
 *  what gets that sign-in through. It is not free: some apps then serve a
 *  Safari-specific bundle that misbehaves inside the webview — ChatGPT loads
 *  but its composer stays dead. So it is a per-site switch: turn it on to sign
 *  in, turn it off to work. */
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const PROVIDERS: ProviderDef[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com", color: "#10a37f" },
  { id: "claude", name: "Claude", url: "https://claude.ai", color: "#c96442" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", color: "#4285f4" },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com", color: "#4d6bfe" },
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
  const safariUa = useStore((s) => s.subsSafariUa);
  const setSafariUa = useStore((s) => s.setSubsSafariUa);
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [imported, setImported] = useState(false);

  const openProvider = async (p: ProviderDef) => {
    const { id, url, name } = p;
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
      width: 1100,
      height: 860,
      ...(useStore.getState().subsSafariUa[p.id] ? { userAgent: DESKTOP_UA } : {}),
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
      <div className="mx-auto w-full max-w-[760px] px-8 pb-12 pt-10">
        <div data-tauri-drag-region className="mb-7 flex items-center gap-3">
          <LogoMark size={32} />
          <div className="min-w-0">
            <h1 className="text-[length:var(--fs-xl)] font-semibold">
              {t("subscriptions")}
            </h1>
            <p className="mt-1 text-[length:var(--fs-md)] text-[var(--color-text-dim)]">
              {t("subsIntro")}
            </p>
          </div>
        </div>

        {/* In-app browser */}
        <div className="mb-8">
          <h2 className="section-label px-0">{t("subsOpenTitle")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PROVIDERS.map((p) => (
              <div
                key={p.id}
                className="group/prov relative flex flex-col items-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 transition-colors hover:border-[var(--color-border-strong)]"
              >
                <button
                  onClick={() => void openProvider(p)}
                  className="flex flex-col items-center gap-2"
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-[var(--r-md)]"
                    style={{ background: `${p.color}22`, color: p.color }}
                  >
                    <Globe size={18} />
                  </span>
                  <span className="text-[length:var(--fs-base)]">{p.name}</span>
                </button>
                {/* Escape hatch: the embedded webview is not a full browser, and
                    some of these apps only behave in a real one. */}
                <button
                  onClick={() => void openUrl(p.url).catch(() => {})}
                  title={t("subsOpenExternal")}
                  className="icon-btn absolute right-1 top-1 h-6 w-6 opacity-0 group-hover/prov:opacity-100"
                >
                  <ExternalLink size={12} />
                </button>
                <button
                  onClick={() => setSafariUa(p.id, !safariUa[p.id])}
                  title={t("subsSafariUa")}
                  data-active={Boolean(safariUa[p.id])}
                  className="icon-btn absolute left-1 top-1 h-6 w-6 opacity-0 data-[active=true]:opacity-100 group-hover/prov:opacity-100"
                >
                  <ShieldCheck size={12} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
            {t("subsHint")}
          </p>
          <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
            {t("subsSafariUaHint")}
          </p>
        </div>

        {/* Context bridge */}
        <div className="panel space-y-4 p-5">
          <div className="text-[length:var(--fs-md)] font-semibold">
            {t("subsBridgeTitle")}
          </div>

          <button onClick={copyContext} className="btn btn-primary">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t("subsCopied") : t("subsCopyContext")}
          </button>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
              <ClipboardPaste size={15} />
              {t("subsPasteLabel")}
            </div>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={5}
              placeholder={t("subsPastePlaceholder")}
              className="input"
            />
            <button
              onClick={importReply}
              disabled={!reply.trim()}
              className="btn btn-secondary"
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
