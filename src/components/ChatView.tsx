import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Clapperboard,
  ArrowUpRight,
  Bot,
  TriangleAlert,
  Plus,
  PanelRightClose,
  MessagesSquare,
  Eye,
  Folder,
  FolderX,
  MoreHorizontal,
  Loader2,
  Square,
  FolderPlus,
  FolderOpen,
} from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { buildCatalog, recommend, type Recommendation } from "../lib/adaptive";
import { buildOutgoing, maybeSummarize } from "../lib/handoff";
import { runAgent, AGENT_SYSTEM } from "../lib/agent";
import { buildProjectMemory, buildGenerationContext } from "../lib/memory";
import type { AskRequest } from "../lib/agent";
import { buildMentionContext, expandSlash } from "../lib/mentions";
import { providerForBaseUrl } from "../lib/generation";
import { Hint } from "./ui/Hint";
import { ToolPreview } from "./ToolPreview";
import { AskDialog } from "./AskDialog";
import { SubagentTracks } from "./SubagentTracks";
import { SubagentPicker } from "./SubagentPicker";
import { pickWorkspaceFolder } from "./panels/ExplorerPanel";
import { useT } from "../lib/i18n";
import { Composer } from "./Composer";
import { ChatTranscript } from "./ChatTranscript";
import { ModelSwitcher } from "./ModelSwitcher";
import type { Attachment } from "../lib/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

/** The agent panel: model picker, mode switches, the transcript, and the
 *  composer. It is the one place where work is requested and reported. */
/** Options for a send that is not a fresh user turn. */
interface SendOpts {
  /** The user message is already in the transcript (an edited turn). */
  skipUserMessage?: boolean;
}

export function ChatView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
  const adaptive = useStore((s) => s.adaptive);
  const setAdaptive = useStore((s) => s.setAdaptive);
  const activeTrack = useStore((s) => s.activeTrack);
  const switchTrack = useStore((s) => s.switchTrack);
  const toggleProjectContext = useStore((s) => s.toggleProjectContext);
  const seesProject = useStore(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.seesProject ?? true,
  );
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
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
  const setLastError = useStore((s) => s.setLastError);
  const setModelStatus = useStore((s) => s.setModelStatus);
  const setTrustCommands = useStore((s) => s.setTrustCommands);
  const setLastContext = useStore((s) => s.setLastContext);
  const lastContext = useStore((s) => s.lastContext);
  const [contextOpen, setContextOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The "more" menu closes when the click lands anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const [streaming, setStreaming] = useState(false);
  const [upgrade, setUpgrade] = useState<Recommendation["upgrade"]>();
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    name: string;
    args: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  /** A choice the agent has put to the user mid-run. Blocking, like confirm —
   *  the whole point is that it arrives at the moment of the decision. */
  const [ask, setAsk] = useState<{
    req: AskRequest;
    resolve: (answer: string) => void;
  } | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const agentCancelRef = useRef(false);
  /** Kept so the error banner's Retry can resend the exact same turn. */
  const lastSendRef = useRef<{ text: string; attachments: Attachment[] } | null>(null);

  const conn = connections.find((c) => c.id === activeConnectionId);
  const ready = Boolean(conn && activeModel);

  const runSend = async (
    text: string,
    attachments: Attachment[],
    connId: string,
    model: string,
    opts: SendOpts = {},
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;

    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    // An edited turn is already in the transcript — adding it again would show
    // the question twice.
    if (!opts.skipUserMessage)
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
    // The discussion track gets the project's memory too — facts and decisions,
    // selected for what was just asked. Without it the model on this side knows
    // nothing about the project, and you end up re-explaining the stack by hand
    // the way you would to a browser tab. It gets no tools: this track talks
    // things through, it does not change files.
    const memory = buildProjectMemory(current, text);
    setLastContext({ system: system + memory + mentions, model, at: Date.now() });

    setStreaming(true);
    // Timing is measured here rather than in the provider: what matters to the
    // user is the wait, and where inside it the thinking happened.
    const startedAt = Date.now();
    let thinkingStart: number | null = null;
    let thinkingMs = 0;

    const stop = api.chatStream(connection, model, history, {
      system: system + memory + mentions,
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
    opts: SendOpts = {},
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;
    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    const isCto = text.startsWith("/cto");

    // The transcript keeps exactly what the user typed; slash commands expand
    // into an instruction that goes to the model via the system prompt.
    const content = text;
    const slashInstruction = isCto
      ? "\n\n## Task\nPerform a comprehensive CTO audit of this project. Check for tech debt, architectural flaws, and suggest concrete tasks for the Roadmap."
      : expandSlash(text) !== text
        ? `\n\n## Task\n${expandSlash(text)}`
        : "";

    if (!opts.skipUserMessage) addMessage(sessionId, { role: "user", content, attachments });
    const assistantId = addMessage(sessionId, { role: "assistant", content: "", model });
    const history = (
      useStore.getState().sessions.find((s) => s.id === sessionId)?.messages ?? []
    ).filter((m) => m.id !== assistantId);

    agentCancelRef.current = false;
    setStreaming(true);
    useStore.getState().setAgentRunning(true);
    // Helper rows belong to the run that started them; the previous run's
    // results stay on screen until a new one begins.
    useStore.getState().clearSubagents();
    const agentStartedAt = Date.now();
    try {
      const sess = useStore.getState().sessions.find((s) => s.id === sessionId);
      const projectMemory =
        buildProjectMemory(sess, text) + slashInstruction + (await buildMentionContext(text));
      setLastContext({ system: AGENT_SYSTEM + projectMemory, model, at: Date.now() });
      await runAgent(
        connection,
        model,
        history,
        {
          confirm: (name, args) =>
            new Promise<boolean>((resolve) => setConfirm({ name, args, resolve })),
          ask: (req) => new Promise<string>((resolve) => setAsk({ req, resolve })),
          onText: (d) => appendToMessage(sessionId!, assistantId, d),
          onReasoning: (d) =>
            useStore.getState().appendReasoning(sessionId!, assistantId, d),
          onUsage: (u) =>
            useStore.getState().setMessageMeta(sessionId!, assistantId, { usage: u }),
          // Stop must abort the request in flight, not just the loop between
          // steps — otherwise the model keeps generating after the click.
          setStop: (abort) => {
            stopRef.current = abort;
          },
          onTool: (e) => {
            useStore
              .getState()
              .setRunningTool(
                e.status === "running"
                  ? { name: e.name, startedAt: e.startedAt ?? Date.now() }
                  : undefined,
              );
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
        projectMemory,
      );
    } catch (e) {
      noteModelFailure(connId, model, String(e), setModelStatus);
      setLastError({ message: String(e), sessionId: sessionId! });
    } finally {
      useStore.getState().setMessageMeta(sessionId!, assistantId, {
        durationMs: Date.now() - agentStartedAt,
      });
      setStreaming(false);
      useStore.getState().setAgentRunning(false);
      useStore.getState().setRunningTool(undefined);
      // Anything typed in the last moments of the run would otherwise sit in
      // the queue until the next run picked it up out of nowhere.
      useStore.getState().clearAgentInterjections();
      useStore.getState().persistMessage(sessionId!, assistantId);
    }
  };

  const runGeneration = async (
    text: string,
    attachments: Attachment[],
    connId: string,
    model: string,
    opts: SendOpts = {},
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;
    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession("generation");

    if (!opts.skipUserMessage)
      addMessage(sessionId, { role: "user", content: text, attachments });
    const assistantId = addMessage(sessionId, { role: "assistant", content: "", model });

    // The provider catalogue is the single source of truth for how to reach a
    // generative model — base URL, endpoint, response format and defaults.
    const provider = providerForBaseUrl(connection.baseUrl);
    if (!provider || !provider.available) {
      useStore.getState().setMessageContent(sessionId, assistantId, "");
      setLastError({ message: t("genProviderUnavailable"), sessionId });
      return;
    }

    const params: Record<string, unknown> = {};
    for (const p of provider.params) if (p.default !== undefined) params[p.key] = p.default;
    if (provider.responseFormat) params.response_format = provider.responseFormat;

    // When this chat sees the project, steer generation with a one-line project
    // descriptor — enough to place the request ("a hero image for my app")
    // without burying the visual prompt in memory.
    const sess = useStore.getState().sessions.find((s) => s.id === sessionId);
    const brief = buildGenerationContext(sess);
    const prompt = brief ? `${brief}\n\n${text}` : text;

    setStreaming(true);
    try {
      const result = await api.generate(connection, {
        kind: provider.kind,
        model,
        prompt,
        endpoint: provider.endpoint,
        params,
      });
      const assets: Attachment[] = result.assets.map((a, i) => ({
        id: `${assistantId}-${i}`,
        type: "image",
        mimeType: a.mimeType ?? "image/png",
        name: `${provider.name} · ${i + 1}`,
        data: a.b64 ?? undefined,
        path: a.url ?? undefined,
      }));
      const st = useStore.getState();
      st.setMessageContent(sessionId, assistantId, assets.length ? t("genResult") : t("genEmpty"));
      st.setMessageAttachments(sessionId, assistantId, assets);
    } catch (e) {
      useStore.getState().setMessageContent(sessionId, assistantId, "");
      setLastError({ message: String(e), sessionId });
    } finally {
      setStreaming(false);
    }
  };

  const send = async (
    text: string,
    attachments: Attachment[] = [],
    opts: SendOpts = {},
  ) => {
    if (!conn || !activeModel) return;

    // Typed while a run is in flight: hand it to the running loop instead of
    // starting a competing request. Read the flag from the store — the local
    // React state was stale often enough that runs piled up on top of each
    // other, which is exactly what the user saw.
    const busy = useStore.getState().agentRunning || streaming;
    if (busy) {
      const body = text.trim();
      if (!body) return;
      addMessage(activeSessionId!, { role: "user", content: body });
      useStore.getState().persistMessage(
        activeSessionId!,
        useStore.getState().sessions.find((x) => x.id === activeSessionId)!.messages.slice(-1)[0].id,
      );
      useStore.getState().pushAgentInterjection(body);
      return;
    }

    setUpgrade(undefined);
    setNote(null);
    setLastError(undefined);
    lastSendRef.current = { text, attachments };

    let connId = activeConnectionId!;
    let model = activeModel;

    // Adaptive routing picks among *text* models; generation runs on a
    // generative provider and is dispatched directly.
    if (activeTrack !== "generation" && adaptive) {
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

    if (activeTrack === "generation") {
      await runGeneration(text, attachments, connId, model, opts);
      return;
    }
    const isAgentTurn = activeTrack === "agent" || text.startsWith("/team ") || text.startsWith("/cto");
    if (isAgentTurn) await runAgentPath(text, attachments, connId, model, opts);
    else await runSend(text, attachments, connId, model, opts);
  };

  /** ChatGPT-style edit: rewrite the turn, drop everything that followed, and
   *  ask again. The old answers were replies to wording that no longer exists,
   *  so leaving them in would corrupt the conversation the model reads. */
  const editAndResend = (messageId: string, text: string) => {
    if (!activeSessionId) return;
    if (useStore.getState().agentRunning || streaming) stop();
    const kept = useStore.getState().editMessage(activeSessionId, messageId, text);
    // The edited turn is already in the transcript; resend it as the prompt.
    const edited = kept[kept.length - 1];
    void send(text, edited?.attachments ?? [], { skipUserMessage: true });
  };

  // The edit handler is passed to every Message; without a stable reference,
  // every message would re-render whenever ChatView re-renders (e.g. on each
  // streaming delta). Keep the latest implementation in a ref and expose a
  // memoized wrapper so React.memo can skip unchanged messages.
  const editAndResendRef = useRef(editAndResend);
  editAndResendRef.current = editAndResend;
  const stableEditAndResend = useCallback((messageId: string, text: string) => {
    editAndResendRef.current(messageId, text);
  }, []);

  const stop = () => {
    agentCancelRef.current = true; // halt the agent loop between steps
    stopRef.current?.();
    stopRef.current = null;
    setStreaming(false);
    useStore.getState().setAgentRunning(false);
    useStore.getState().clearAgentInterjections();
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
        {/* One segmented control is the panel's identity: it both names the
            active mode and switches it, so no separate icon+label is needed.
            Each mode keeps its own model; discussion talks, agent acts,
            generation makes images and audio. */}
        <Hint text={t("hintAgentToggle")} side="bottom">
          <div className="segmented shrink-0">
            <button
              data-on={activeTrack === "chat"}
              onClick={() => switchTrack("chat")}
              title={t("trackChatHint")}
            >
              <MessagesSquare size={13} />
              {t("trackChat")}
            </button>
            <button
              data-ai="true"
              data-on={activeTrack === "agent"}
              onClick={() => switchTrack("agent")}
              title={t("agentHint")}
            >
              <Bot size={13} />
              {t("agent")}
            </button>
            <button
              data-ai="true"
              data-on={activeTrack === "generation"}
              onClick={() => switchTrack("generation")}
              title={t("trackGenerationHint")}
            >
              <Clapperboard size={13} />
              {t("trackGeneration")}
            </button>
          </div>
        </Hint>
        <div className="flex-1" />
        <Hint text={t("hintNewChat")} side="left">
          <button className="icon-btn" title={t("newChat")} onClick={() => newSession()}>
            <Plus size={15} />
          </button>
        </Hint>
        {/* "Show context" is a power feature, not a daily one — it lives in the
            overflow menu rather than the hot path. */}
        <div className="relative" ref={menuRef}>
          <button
            className="icon-btn"
            title={t("moreActions")}
            aria-label={t("moreActions")}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[190px] rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[length:var(--fs-base)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                disabled={!lastContext}
                onClick={() => {
                  setContextOpen(true);
                  setMenuOpen(false);
                }}
              >
                <Eye size={14} className="shrink-0 text-[var(--color-text-mute)]" />
                {t("showContext")}
              </button>
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          title={t("cmdToggleAgentPanel")}
          onClick={() => toggleAgentPanel(false)}
        >
          <PanelRightClose size={15} />
        </button>
      </header>

      {/* Config bar: the active mode's model on the left, mode-specific controls
          next to it, and the one project-context toggle on the right — the same
          switch for every mode, so "does the AI see my project" is answered in
          one place instead of a cryptic eye. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5">
        {conn ? (
          <div className="min-w-0 max-w-[190px]">
            <ModelSwitcher />
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm shrink-0" onClick={onOpenSettings}>
            {t("connectModel")}
          </button>
        )}
        {/* The bench of helper models and adaptive routing only apply to the
            text tracks; generation is dispatched straight to its provider. */}
        {activeTrack === "agent" && <SubagentPicker />}
        {activeTrack !== "generation" && (
          <Hint text={t("hintAdaptive")} side="bottom">
            <button
              className="toggle-pill shrink-0 px-2"
              data-ai="true"
              data-on={adaptive}
              onClick={() => setAdaptive(!adaptive)}
              title={`${t("adaptive")} — ${t("adaptiveHint")}`}
              aria-label={t("adaptive")}
            >
              <Sparkles size={13} />
            </button>
          </Hint>
        )}
        <div className="flex-1" />
        <Hint text={t("hintSeesProject")} side="bottom">
          <button
            className="toggle-pill shrink-0"
            data-on={seesProject}
            onClick={toggleProjectContext}
            title={seesProject ? t("seesProject") : t("hidesProject")}
          >
            {seesProject ? <Folder size={13} /> : <FolderX size={13} />}
            {t("projectContext")}
          </button>
        </Hint>
      </div>

      {workspaceRoot && activeTrack === "chat" && (
        <p className="px-3 py-2 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
          {t("trackChatNote")}
        </p>
      )}

      <ChatTranscript
        ready={ready}
        hasWorkspace={Boolean(workspaceRoot)}
        onOpenSettings={onOpenSettings}
        onEdit={stableEditAndResend}
        onRetry={retry}
      />

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

      <AgentActivity />

      <SubagentTracks />

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

      {ask && <AskDialog req={ask.req} onAnswer={(a) => { ask.resolve(a); setAsk(null); }} />}

      {confirm && (
        <Dialog
          open
          onOpenChange={() => {
            confirm.resolve(false);
            setConfirm(null);
          }}
        >
          <DialogContent className="w-[min(92vw,42rem)] max-w-[92vw] gap-0 overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)]">
            <DialogHeader className="flex flex-row items-center gap-2.5 border-b border-[var(--color-border)] px-5 py-3.5">
              {confirm.name === "new_project" ? (
                <FolderPlus size={17} className="shrink-0 text-[var(--color-ai)]" />
              ) : (
                <TriangleAlert size={17} className="shrink-0 text-[var(--color-warning)]" />
              )}
              <div className="min-w-0">
                <DialogTitle className="text-[length:var(--fs-md)] font-semibold">
                  {confirm.name === "new_project" ? t("newProjectTitle") : t("confirmTitle")}
                </DialogTitle>
                <p className="mt-0.5 text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
                  {confirm.name === "new_project"
                    ? t("newProjectSubtitle")
                    : t("confirmSubtitle")}
                </p>
              </div>
            </DialogHeader>
            <div className="min-w-0 space-y-2 overflow-hidden px-5 py-4">
              <div className="font-mono text-[length:var(--fs-base)] font-medium text-[var(--color-text)]">
                {confirm.name}
              </div>
              <ToolPreview name={confirm.name} args={confirm.args} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
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
              {/* Being told where a project must go is not a choice. Picking a
                  folder here resolves the call as approved: the tool sees a
                  root is already open and tells the model to work there. */}
              {confirm.name === "new_project" && (
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    const picked = await pickWorkspaceFolder();
                    if (!picked) return;
                    confirm.resolve(true);
                    setConfirm(null);
                  }}
                >
                  <FolderOpen size={13} />
                  {t("newProjectChoose")}
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
                {confirm.name === "new_project" ? t("newProjectCreate") : t("confirmApprove")}
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

/** Shown while a tool call is in flight, above the composer.
 *
 *  The agent loop awaits the running command, so a message typed now is queued
 *  and only read once that command returns. When the command has hung, that is
 *  never — and the user is left talking to a wall, which is exactly what
 *  happened. This bar makes the state visible and gives the one action that
 *  actually unblocks the conversation: kill the command. */
/** Proof that the agent is alive.
 *
 *  Between tool calls the panel showed nothing at all: the message was sent,
 *  the screen sat still, and the only way to tell "thinking" from "hung" was to
 *  wait and then send another message. Anything running now says so — what it
 *  is doing, for how long, and how many helpers are out. */
function AgentActivity() {
  const t = useT();
  const running = useStore((s) => s.agentRunning);
  const startedAt = useStore((s) => s.agentRunStartedAt);
  const tool = useStore((s) => s.runningTool);
  const queued = useStore((s) => s.agentInterjections.length);
  const helpers = useStore((s) => s.subagents);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [running]);

  if (!running) return null;

  const secs = Math.max(0, Math.round((now - (startedAt ?? now)) / 1000));
  const active = Object.values(helpers).filter((h) => h.status === "running").length;
  const label = tool
    ? t("toolRunning", { name: tool.name, n: String(secs) })
    : t("agentThinking", { n: String(secs) });

  return (
    <div className="mx-2 mb-1 overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      {/* An indeterminate sweep: no fake percentage, just a sign of life. */}
      <div className="h-0.5 w-full bg-[var(--color-border)]">
        <div className="h-full w-1/3 animate-[sweep_1.4s_ease-in-out_infinite] bg-[var(--color-ai)]" />
      </div>
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[length:var(--fs-xs)]">
        <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-ai)]" />
        <span className="min-w-0 flex-1 truncate text-[var(--color-text-dim)]">
          {label}
          {active > 0 && ` · ${t("subagentsActive", { n: String(active) })}`}
          {queued > 0 && ` · ${t("toolQueued", { n: String(queued) })}`}
        </span>
        {tool?.name === "run_bash" && (
          <button
            className="btn btn-danger btn-sm shrink-0"
            onClick={() => void api.toolKillBash().catch(() => {})}
          >
            <Square size={11} />
            {t("agentKillCommand")}
          </button>
        )}
      </div>
    </div>
  );
}
