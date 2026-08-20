import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  ArrowUpRight,
  Bot,
  TriangleAlert,
  Plus,
  PanelRightClose,
  FolderGit2,
  Eye,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { buildCatalog, recommend, type Recommendation } from "../lib/adaptive";
import { buildOutgoing, maybeSummarize } from "../lib/handoff";
import { runAgent, AGENT_SYSTEM } from "../lib/agent";
import { buildProjectMemory } from "../lib/memory";
import { buildMentionContext, expandSlash } from "../lib/mentions";
import { LogoMark } from "./Logo";
import { Hint } from "./ui/Hint";
import { ToolPreview } from "./ToolPreview";
import { useT } from "../lib/i18n";
import { Composer } from "./Composer";
import { Message } from "./Message";
import { ModelSwitcher } from "./ModelSwitcher";
import { cn } from "../lib/cn";
import type { Attachment } from "../lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

/** The agent panel: model picker, mode switches, the transcript, and the
 *  composer. It is the one place where work is requested and reported. */
export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
  const adaptive = useStore((s) => s.adaptive);
  const setAdaptive = useStore((s) => s.setAdaptive);
  const agentMode = useStore((s) => s.agentMode);
  const setAgentMode = useStore((s) => s.setAgentMode);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const newSession = useStore((s) => s.newSession);
  const addMessage = useStore((s) => s.addMessage);
  const appendToMessage = useStore((s) => s.appendToMessage);
  const setMessageContent = useStore((s) => s.setMessageContent);
  const setActive = useStore((s) => s.setActive);
  const setSummary = useStore((s) => s.setSummary);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const toggleAgentPanel = useStore((s) => s.toggleAgentPanel);
  const pushAgentEvent = useStore((s) => s.pushAgentEvent);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const lastError = useStore((s) => s.lastError);
  const setLastError = useStore((s) => s.setLastError);
  const setModelStatus = useStore((s) => s.setModelStatus);
  const setTrustCommands = useStore((s) => s.setTrustCommands);
  const setLastContext = useStore((s) => s.setLastContext);
  const lastContext = useStore((s) => s.lastContext);
  const [contextOpen, setContextOpen] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [upgrade, setUpgrade] = useState<Recommendation["upgrade"]>();
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    name: string;
    args: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const agentCancelRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Kept so the error banner's Retry can resend the exact same turn. */
  const lastSendRef = useRef<{ text: string; attachments: Attachment[] } | null>(null);

  const session = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const messages = session?.messages ?? [];
  const conn = connections.find((c) => c.id === activeConnectionId);
  const ready = Boolean(conn && activeModel);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const runSend = async (
    text: string,
    attachments: Attachment[],
    connId: string,
    model: string,
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;

    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    addMessage(sessionId, { role: "user", content: text, attachments });
    const assistantId = addMessage(sessionId, { role: "assistant", content: "", model });

    const current = useStore.getState().sessions.find((s) => s.id === sessionId)!;
    // Handoff-aware context: identity + rolling summary + tail, with a note when
    // the model changed since the previous turn.
    const { system, messages: outgoing } = await buildOutgoing(current, model);
    const history = outgoing.filter((m) => m.id !== assistantId);
    // Files the user attached with @ ride along in the system prompt, so the
    // canon keeps the readable message while the model sees the content.
    const mentions = await buildMentionContext(text);
    setLastContext({ system: system + mentions, model, at: Date.now() });

    setStreaming(true);
    // Timing is measured here rather than in the provider: what matters to the
    // user is the wait, and where inside it the thinking happened.
    const startedAt = Date.now();
    let thinkingStart: number | null = null;
    let thinkingMs = 0;

    const stop = api.chatStream(connection, model, history, {
      system: system + mentions,
      onDelta: (d) => {
        if (thinkingStart !== null) {
          thinkingMs += Date.now() - thinkingStart;
          thinkingStart = null;
        }
        appendToMessage(sessionId!, assistantId, d);
      },
      onReasoning: (d) => {
        if (thinkingStart === null) thinkingStart = Date.now();
        useStore.getState().appendReasoning(sessionId!, assistantId, d);
      },
      onUsage: (u) =>
        useStore.getState().setMessageMeta(sessionId!, assistantId, { usage: u }),
      onDone: () => {
        if (thinkingStart !== null) thinkingMs += Date.now() - thinkingStart;
        useStore.getState().setMessageMeta(sessionId!, assistantId, {
          durationMs: Date.now() - startedAt,
          thinkingMs: thinkingMs || undefined,
        });
        setStreaming(false);
        stopRef.current = null;
        useStore.getState().persistMessage(sessionId!, assistantId);
        const s = useStore.getState().sessions.find((x) => x.id === sessionId);
        if (s)
          void maybeSummarize(s, connection, model, (sum, upTo) =>
            setSummary(sessionId!, sum, upTo),
          );
      },
      onError: (msg) => {
        // Errors get their own retryable banner instead of masquerading as a reply.
        setMessageContent(sessionId!, assistantId, "");
        noteModelFailure(connId, model, msg, setModelStatus);
        setLastError({ message: msg, sessionId: sessionId! });
        setStreaming(false);
        stopRef.current = null;
      },
    });
    stopRef.current = stop;
  };

  const runAgentPath = async (
    text: string,
    attachments: Attachment[],
    connId: string,
    model: string,
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;
    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    const isTeam = text.startsWith("/team ");
    const isCto = text.startsWith("/cto");

    // The transcript keeps exactly what the user typed; slash commands expand
    // into an instruction that goes to the model via the system prompt.
    const content = isTeam ? text.replace("/team ", "").trim() : text;
    const slashInstruction = isCto
      ? "\n\n## Task\nPerform a comprehensive CTO audit of this project. Check for tech debt, architectural flaws, and suggest concrete tasks for the Roadmap."
      : expandSlash(text) !== text
        ? `\n\n## Task\n${expandSlash(text)}`
        : "";

    addMessage(sessionId, { role: "user", content, attachments });
    const assistantId = addMessage(sessionId, { role: "assistant", content: "", model });
    const history = (
      useStore.getState().sessions.find((s) => s.id === sessionId)?.messages ?? []
    ).filter((m) => m.id !== assistantId);

    agentCancelRef.current = false;
    setStreaming(true);
    try {
      const sess = useStore.getState().sessions.find((s) => s.id === sessionId);
      const projectMemory =
        buildProjectMemory(sess) + slashInstruction + (await buildMentionContext(text));
      setLastContext({ system: AGENT_SYSTEM + projectMemory, model, at: Date.now() });
      await runAgent(
        connection,
        model,
        history,
        {
          confirm: (name, args) =>
            new Promise<boolean>((resolve) => setConfirm({ name, args, resolve })),
          onText: (d) => appendToMessage(sessionId!, assistantId, d),
          onTool: (e) => {
            pushAgentEvent(assistantId, e);
            // File-changing tools invalidate the tree the user is looking at.
            if (
              e.status === "done" &&
              (e.name === "write_file" || e.name === "edit_file" || e.name === "run_bash")
            )
              refreshExplorer();
          },
          cancelled: () => agentCancelRef.current,
        },
        isTeam,
        projectMemory,
      );
    } catch (e) {
      noteModelFailure(connId, model, String(e), setModelStatus);
      setLastError({ message: String(e), sessionId: sessionId! });
    } finally {
      setStreaming(false);
      useStore.getState().persistMessage(sessionId!, assistantId);
    }
  };

  const send = async (text: string, attachments: Attachment[] = []) => {
    if (!conn || !activeModel) return;
    setUpgrade(undefined);
    setNote(null);
    setLastError(undefined);
    lastSendRef.current = { text, attachments };

    let connId = activeConnectionId!;
    let model = activeModel;

    if (adaptive) {
      const catalog = buildCatalog(connections, models);
      const rec = recommend(text, catalog, { connectionId: connId, model });
      const reason = t(`reason_${rec.tier}`);
      if (rec.pick && rec.pick.model !== model) {
        connId = rec.pick.connectionId;
        model = rec.pick.model;
        setActive(connId, model);
      }
      setNote(t("adaptiveUsing", { model, reason }));
      if (rec.upgrade) setUpgrade(rec.upgrade);
    }

    const isAgentTurn = agentMode || text.startsWith("/team ") || text.startsWith("/cto");
    if (isAgentTurn) await runAgentPath(text, attachments, connId, model);
    else await runSend(text, attachments, connId, model);
  };

  const stop = () => {
    agentCancelRef.current = true; // halt the agent loop between steps
    stopRef.current?.();
    stopRef.current = null;
    setStreaming(false);
    void api.toolKillBash().catch(() => {});
  };

  const retry = () => {
    const last = lastSendRef.current;
    setLastError(undefined);
    if (last) void send(last.text, last.attachments);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        data-tauri-drag-region
        className="flex h-[var(--h-titlebar)] shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2"
      >
        {/* The one violet accent in the chrome: this panel is the AI. */}
        <Bot size={15} className="shrink-0 text-[var(--color-ai)]" />
        <span className="shrink-0 text-[length:var(--fs-base)] font-semibold">
          {t("agent")}
        </span>
        <div className="min-w-0 flex-1">
          {conn ? (
            <ModelSwitcher />
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
              {t("connectModel")}
            </button>
          )}
        </div>
        <Hint text={t("hintShowContext")} side="left">
          <button
            className="icon-btn"
            title={t("showContext")}
            onClick={() => setContextOpen(true)}
            disabled={!lastContext}
          >
            <Eye size={15} />
          </button>
        </Hint>
        <Hint text={t("hintNewChat")} side="left">
          <button className="icon-btn" title={t("newChat")} onClick={() => newSession()}>
            <Plus size={15} />
          </button>
        </Hint>
        <button
          className="icon-btn"
          title={t("cmdToggleAgentPanel")}
          onClick={() => toggleAgentPanel(false)}
        >
          <PanelRightClose size={15} />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5">
        <Hint text={t("hintAgentToggle")} side="bottom">
          <button
            className="toggle-pill"
            data-ai="true"
            data-on={agentMode}
            onClick={() => setAgentMode(!agentMode)}
            title={t("agentHint")}
          >
            <Bot size={13} />
            {t("agent")}
          </button>
        </Hint>
        <Hint text={t("hintAdaptive")} side="bottom">
          <button
            className="toggle-pill"
            data-ai="true"
            data-on={adaptive}
            onClick={() => setAdaptive(!adaptive)}
            title={t("adaptiveHint")}
          >
            <Sparkles size={13} />
            {t("adaptive")}
          </button>
        </Hint>
      </div>

      {workspaceRoot && !agentMode && (
        <div className="alert anim-in m-2 flex-col items-stretch" data-tone="warning">
          <div className="flex items-start gap-2">
            <FolderGit2 size={14} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t("agentOffTitle")}</div>
              <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed opacity-90">
                {t("agentOffText")}
              </p>
            </div>
          </div>
          <button
            className="btn btn-sm btn-secondary mt-2 self-start"
            onClick={() => setAgentMode(true)}
          >
            <Bot size={13} />
            {t("agentOffEnable")}
          </button>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full px-3 py-4">
          {messages.length === 0 ? (
            <EmptyChat
              ready={ready}
              hasWorkspace={Boolean(workspaceRoot)}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <div className="space-y-4">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </div>
          )}

          {lastError && lastError.sessionId === activeSessionId && (
            <div className="alert anim-in mt-3 flex-col items-stretch">
              <div className="flex items-start gap-2">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t("errorRequestFailed")}</div>
                  <p className="mt-1 break-words text-[length:var(--fs-sm)] opacity-90">
                    {lastError.message}
                  </p>
                </div>
                <button
                  className="icon-btn h-5 w-5 shrink-0"
                  title={t("errorDismiss")}
                  onClick={() => setLastError(undefined)}
                >
                  <X size={12} />
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <button className="btn btn-sm btn-secondary" onClick={retry}>
                  <RotateCcw size={13} />
                  {t("retry")}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={onOpenSettings}>
                  {t("errorCheckSettings")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(note || upgrade) && (
        <div className="shrink-0 px-3">
          {note && (
            <div className="mb-1 flex items-center gap-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
              <Sparkles size={11} className="text-[var(--color-ai)]" />
              {note}
            </div>
          )}
          {upgrade && (
            <button
              onClick={() => {
                setActive(upgrade.connectionId, upgrade.model);
                setNote(t("switchedTo", { model: upgrade.model }));
                setUpgrade(undefined);
              }}
              className="mb-2 flex items-center gap-1.5 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-2.5 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-accent-strong)] hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
            >
              <ArrowUpRight size={13} />
              {t("upgradeSuggest", {
                model: upgrade.model,
                conn: upgrade.connectionName,
              })}
            </button>
          )}
        </div>
      )}

      <Composer disabled={!ready} streaming={streaming} onSend={send} onStop={stop} />

      {contextOpen && lastContext && (
        <Dialog open onOpenChange={() => setContextOpen(false)}>
          <DialogContent className="max-w-3xl gap-0 border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)]">
            <DialogHeader className="border-b border-[var(--color-border)] px-5 py-3.5">
              <DialogTitle className="text-[length:var(--fs-md)] font-semibold">
                {t("showContext")}
              </DialogTitle>
              <p className="mt-0.5 text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
                {t("showContextHint", { model: lastContext.model })}
              </p>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-dim)]">
              {lastContext.system || "—"}
            </pre>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button
                className="btn btn-secondary"
                onClick={() => void navigator.clipboard.writeText(lastContext.system)}
              >
                {t("copy")}
              </button>
              <button className="btn btn-primary" onClick={() => setContextOpen(false)}>
                {t("close")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {confirm && (
        <Dialog
          open
          onOpenChange={() => {
            confirm.resolve(false);
            setConfirm(null);
          }}
        >
          <DialogContent className="max-w-2xl gap-0 border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)]">
            <DialogHeader className="flex flex-row items-center gap-2.5 border-b border-[var(--color-border)] px-5 py-3.5">
              <TriangleAlert size={17} className="shrink-0 text-[var(--color-warning)]" />
              <div className="min-w-0">
                <DialogTitle className="text-[length:var(--fs-md)] font-semibold">
                  {t("confirmTitle")}
                </DialogTitle>
                <p className="mt-0.5 text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
                  {t("confirmSubtitle")}
                </p>
              </div>
            </DialogHeader>
            <div className="space-y-2 px-5 py-4">
              <div className="font-mono text-[length:var(--fs-base)] font-medium text-[var(--color-accent-strong)]">
                {confirm.name}
              </div>
              <ToolPreview name={confirm.name} args={confirm.args} />
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
              {confirm.name === "run_bash" && (
                <button
                  className="btn btn-ghost mr-auto"
                  title={t("confirmTrustHint")}
                  onClick={() => {
                    // Long builds run dozens of commands; asking each time makes
                    // the agent unusable for real work.
                    setTrustCommands(true);
                    confirm.resolve(true);
                    setConfirm(null);
                  }}
                >
                  {t("confirmTrustAll")}
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  confirm.resolve(false);
                  setConfirm(null);
                }}
              >
                {t("confirmDecline")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  confirm.resolve(true);
                  setConfirm(null);
                }}
              >
                {t("confirmApprove")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Providers answer "no access to model" / 403 / 404 when the token cannot use
 *  a model. Remember that, so the picker can flag it instead of failing twice. */
function noteModelFailure(
  connectionId: string,
  model: string,
  message: string,
  mark: (c: string, m: string, s: "ok" | "denied") => void,
) {
  if (/no access to model|403|404|model_not_found|does not exist/i.test(message))
    mark(connectionId, model, "denied");
}

/** Empty transcript: brand, plus whichever setup step is still missing. */
function EmptyChat({
  ready,
  hasWorkspace,
  onOpenSettings,
}: {
  ready: boolean;
  hasWorkspace: boolean;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const setSidePanel = useStore((s) => s.setSidePanel);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center px-1 text-center">
      <LogoMark size={52} className="opacity-90" />
      <p className="mt-4 max-w-[300px] text-[length:var(--fs-base)] leading-relaxed text-[var(--color-text-dim)]">
        {ready ? t("emptyReady") : t("stepConnectText")}
      </p>

      <div className="mt-5 w-full space-y-2 text-left">
        {!ready && (
          <button className="card" onClick={onOpenSettings}>
            <span className="step-chip">1</span>
            <span className="min-w-0">
              <span className="card-title">{t("stepConnectTitle")}</span>
              <span className="card-text">{t("stepConnectAction")}</span>
            </span>
          </button>
        )}
        {!hasWorkspace && (
          <button className="card" onClick={() => setSidePanel("explorer")}>
            <span className="step-chip" data-done={hasWorkspace}>
              2
            </span>
            <span className="min-w-0">
              <span className="card-title">{t("stepFolderTitle")}</span>
              <span className="card-text">{t("stepFolderAction")}</span>
            </span>
          </button>
        )}
      </div>

      {ready && hasWorkspace && (
        <p className={cn("mt-4 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]")}>
          {t("stepStartText")}
        </p>
      )}
    </div>
  );
}
