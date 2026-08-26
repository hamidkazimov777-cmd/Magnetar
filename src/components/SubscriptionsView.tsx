import { useEffect, useState } from "react";
import {
  Globe,
  Copy,
  Check,
  ClipboardPaste,
  ArrowDownToLine,
  ExternalLink,
  ShieldCheck,
  Plus,
} from "./icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore } from "../lib/store";
import { db } from "../lib/db";
import { useT } from "../lib/i18n";
import { copyText } from "../lib/clipboard";
import { LogoMark } from "./Logo";

interface ProviderDef {
  id: string;
  name: string;
  url: string;
  color: string;
  /** Open in the system browser instead of the embedded webview.
   *
   *  ChatGPT is the case this exists for: inside WKWebView it loads the shell
   *  but its composer never becomes usable — with the Safari user agent and
   *  without it alike. Rather than hand the user a window they cannot type in,
   *  it opens in a real browser. The context bridge below is unaffected: it
   *  moves text through the clipboard, not through the window. */
  external?: boolean;
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
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com", color: "#10a37f", external: true },
  { id: "claude", name: "Claude", url: "https://claude.ai", color: "#c96442" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", color: "#4285f4" },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com", color: "#4d6bfe" },
];

/** Which slices of context to export. The whole point of the bridge is pasting
 *  into someone else's chat window, where length costs you — so this is a
 *  choice, not a fixed dump. */
export interface ContextParts {
  memory: boolean;
  tasks: boolean;
  summary: boolean;
  recent: boolean;
}

const DEFAULT_PARTS: ContextParts = {
  memory: true,
  tasks: true,
  summary: true,
  recent: false,
};

/** Build a portable project brief the user can paste into a subscription AI. */
async function buildProjectContext(parts: ContextParts): Promise<string> {
  const st = useStore.getState();
  const p = st.projects.find((x) => x.id === st.activeProjectId);
  const session = st.sessions.find((s) => s.id === st.activeSessionId);
  const out: string[] = ["# Project context (exported from Magnetar)"];

  if (p && parts.memory) {
    out.push(`## Project: ${p.name}`);
    if (p.description) out.push(`Description: ${p.description}`);
    if (p.techStack) out.push(`Tech stack:\n${p.techStack}`);
    if (p.architectureNotes) out.push(`Architecture:\n${p.architectureNotes}`);
    if (p.decisions) out.push(`Key decisions:\n${p.decisions}`);
    if (p.codingStandards) out.push(`Coding standards:\n${p.codingStandards}`);
    if (p.lastState) out.push(`Where we stopped:\n${p.lastState}`);
  }

  if (p && parts.tasks) {
    try {
      const tasks = await db.listTasks(p.id);
      const open = tasks.filter((t) => (t.status || "").toUpperCase() !== "DONE");
      if (open.length)
        out.push(
          `## Open tasks\n${open.map((t) => `- [${t.status}] ${t.title}`).join("\n")}`,
        );
    } catch {
      /* ignore */
    }
  }

  if (parts.summary && session?.summary)
    out.push(`## Conversation summary so far\n${session.summary}`);

  if (parts.recent && session) {
    const tail = session.messages
      .slice(-6)
      .filter((m) => m.content)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    if (tail) out.push(`## Recent messages\n${tail}`);
  }

  out.push(
    "\n---\nUse this context to continue the work. Reply with your analysis or changes.",
  );
  return out.join("\n\n");
}

export function SubscriptionsView() {
  const t = useT();
  const safariUa = useStore((s) => s.subsSafariUa);
  const setSafariUa = useStore((s) => s.setSubsSafariUa);
  const [parts, setParts] = useState<ContextParts>(DEFAULT_PARTS);
  const [preview, setPreview] = useState("");
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const [reply, setReply] = useState("");
  const [imported, setImported] = useState(false);

  // Rebuild the preview whenever the selection changes. Seeing the payload is
  // half the feature: it is what tells you whether memory is empty before you
  // paste an empty brief into someone else's chat.
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const sessions = useStore((s) => s.sessions);
  useEffect(() => {
    let alive = true;
    void buildProjectContext(parts).then((text) => alive && setPreview(text));
    return () => {
      alive = false;
    };
  }, [parts, projects, activeProjectId, sessions]);

  const openProvider = async (p: ProviderDef) => {
    const { id, url, name } = p;
    if (p.external) {
      await openUrl(url).catch(() => {});
      return;
    }
    const label = `subs-${id}`;
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        // setFocus() alone does nothing to a minimised window: it stays in the
        // Dock and the card looks dead, with no way to get the window back.
        // Un-minimise and show first, then focus.
        await existing.unminimize().catch(() => {});
        await existing.show().catch(() => {});
        await existing.setFocus().catch(() => {});
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
    // Report the real outcome. The old version swallowed a clipboard rejection
    // into console.error, so the button silently did nothing.
    const ok = await copyText(preview);
    setCopied(ok ? "ok" : "fail");
    setTimeout(() => setCopied("idle"), 2500);
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
                  {p.external && (
                    <span className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
                      {t("subsExternalOnly")}
                    </span>
                  )}
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
          <div>
            <div className="text-[length:var(--fs-md)] font-semibold">
              {t("subsBridgeTitle")}
            </div>
            <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
              {t("subsBridgeHint")}
            </p>
          </div>

          {/* Pick what goes in */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["memory", t("subsPartMemory")],
                ["tasks", t("subsPartTasks")],
                ["summary", t("subsPartSummary")],
                ["recent", t("subsPartRecent")],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className="toggle-pill"
                data-on={parts[key]}
                onClick={() => setParts((v) => ({ ...v, [key]: !v[key] }))}
              >
                {parts[key] ? <Check size={12} /> : <Plus size={12} />}
                {label}
              </button>
            ))}
          </div>

          {/* Show the payload: selectable, so it is copyable by hand too */}
          <div>
            <textarea
              readOnly
              value={preview}
              rows={8}
              onFocus={(e) => e.currentTarget.select()}
              className="input font-mono text-[length:var(--fs-xs)] leading-relaxed"
            />
            <div className="mt-1 flex items-center justify-between text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
              <span>{t("subsChars", { n: String(preview.length) })}</span>
              {!activeProjectId && <span>{t("subsNoProject")}</span>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={copyContext} className="btn btn-primary">
              {copied === "ok" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "ok" ? t("subsCopied") : t("subsCopyContext")}
            </button>
            {copied === "fail" && (
              <span className="text-[length:var(--fs-xs)] text-[var(--color-danger)]">
                {t("subsCopyFailed")}
              </span>
            )}
          </div>

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
