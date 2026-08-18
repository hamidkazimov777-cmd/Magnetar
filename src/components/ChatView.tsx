import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, ArrowUpRight, Bot, TriangleAlert } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { buildCatalog, recommend, type Recommendation } from "../lib/adaptive";
import { buildOutgoing, maybeSummarize } from "../lib/handoff";
import { runAgent } from "../lib/agent";
import { useT } from "../lib/i18n";
import { Composer } from "./Composer";
import { Message } from "./Message";
import { ModelSwitcher } from "./ModelSwitcher";
import { cn } from "../lib/cn";

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

  const [streaming, setStreaming] = useState(false);
  const [upgrade, setUpgrade] = useState<Recommendation["upgrade"]>();
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    name: string;
    args: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const stopRef = useRef<null | (() => void)>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    connId: string,
    model: string,
  ) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;

    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    addMessage(sessionId, { role: "user", content: text });
    const assistantId = addMessage(sessionId, {
      role: "assistant",
      content: "",
      model,
    });

    const current = useStore.getState().sessions.find((s) => s.id === sessionId)!;
    // Handoff-aware context: identity + rolling summary + tail, with a note when
    // the model changed since the previous turn.
    const { system, messages: outgoing } = buildOutgoing(current, model);
    const history = outgoing.filter((m) => m.id !== assistantId);

    setStreaming(true);
    const stop = api.chatStream(connection, model, history, {
      system,
      onDelta: (t) => appendToMessage(sessionId!, assistantId, t),
      onDone: () => {
        setStreaming(false);
        stopRef.current = null;
        // Persist the finished assistant turn to the canon (SQLite).
        useStore.getState().persistMessage(sessionId!, assistantId);
        // Refresh the rolling handoff summary in the background.
        const s = useStore.getState().sessions.find((x) => x.id === sessionId);
        if (s)
          void maybeSummarize(s, connection, model, (sum, upTo) =>
            setSummary(sessionId!, sum, upTo),
          );
      },
      onError: (msg) => {
        setMessageContent(sessionId!, assistantId, `⚠️ ${msg}`);
        setStreaming(false);
        stopRef.current = null;
      },
    });
    stopRef.current = stop;
  };

  const runAgentPath = async (text: string, connId: string, model: string) => {
    const connection = useStore.getState().connections.find((c) => c.id === connId);
    if (!connection) return;
    let sessionId = useStore.getState().activeSessionId;
    if (!sessionId) sessionId = newSession();

    addMessage(sessionId, { role: "user", content: text });
    const assistantId = addMessage(sessionId, { role: "assistant", content: "", model });
    const history = (
      useStore.getState().sessions.find((s) => s.id === sessionId)?.messages ?? []
    ).filter((m) => m.id !== assistantId);

    setStreaming(true);
    try {
      await runAgent(connection, model, history, {
        confirm: (name, args) =>
          new Promise<boolean>((resolve) => setConfirm({ name, args, resolve })),
        onText: (t) => appendToMessage(sessionId!, assistantId, t),
      });
    } catch (e) {
      appendToMessage(sessionId!, assistantId, `\n\n⚠️ ${String(e)}`);
    } finally {
      setStreaming(false);
      useStore.getState().persistMessage(sessionId!, assistantId);
    }
  };

  const send = async (text: string) => {
    if (!conn || !activeModel) return;
    setUpgrade(undefined);
    setNote(null);

    let connId = activeConnectionId!;
    let model = activeModel;

    if (adaptive) {
      const catalog = buildCatalog(connections, models);
      const rec = recommend(text, catalog, {
        connectionId: connId,
        model,
      });
      // Auto-route within reach; surface a cross-connection upgrade as opt-in.
      const reason = t(`reason_${rec.tier}`);
      if (rec.pick && rec.pick.model !== model) {
        connId = rec.pick.connectionId;
        model = rec.pick.model;
        setActive(connId, model);
      }
      setNote(t("adaptiveUsing", { model, reason }));
      if (rec.upgrade) setUpgrade(rec.upgrade);
    }

    if (agentMode) await runAgentPath(text, connId, model);
    else await runSend(text, connId, model);
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setStreaming(false);
  };

  return (
    <div className="flex h-full flex-1 flex-col">
      <header
        data-tauri-drag-region
        className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5"
      >
        {conn ? (
          <ModelSwitcher />
        ) : (
          <span className="px-2 text-sm text-[var(--color-text-dim)]">
            {t("noConnection")}
          </span>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAgentMode(!agentMode)}
            title={t("agentHint")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition",
              agentMode
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)]"
                : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            <Bot size={15} />
            {t("agent")}
          </button>
          <button
            onClick={() => setAdaptive(!adaptive)}
            title={t("adaptiveHint")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition",
              adaptive
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent-strong)]"
                : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]",
            )}
          >
            <Sparkles size={15} />
            {t("adaptive")}
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {messages.length === 0 ? (
            <EmptyState ready={ready} onOpenSettings={onOpenSettings} />
          ) : (
            <div className="space-y-5">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>
      </div>

      {(note || upgrade) && (
        <div className="mx-auto w-full max-w-3xl px-4">
          {note && (
            <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
              <Sparkles size={12} className="text-[var(--color-accent-strong)]" />
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
              className="mb-2 flex items-center gap-1.5 rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-2.5 py-1.5 text-xs text-[var(--color-accent-strong)] hover:bg-[var(--color-accent)]/20"
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

      <Composer
        disabled={!ready}
        streaming={streaming}
        onSend={send}
        onStop={stop}
      />

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-3.5">
              <TriangleAlert size={17} className="text-[var(--color-accent-strong)]" />
              <h3 className="text-sm font-semibold">{t("confirmTitle")}</h3>
            </div>
            <div className="space-y-2 px-5 py-4">
              <div className="text-sm font-medium">{confirm.name}</div>
              <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-xs">
                {JSON.stringify(confirm.args, null, 2)}
              </pre>
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button
                onClick={() => {
                  confirm.resolve(false);
                  setConfirm(null);
                }}
                className="rounded-lg border border-[var(--color-border)] px-3.5 py-1.5 text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
              >
                {t("confirmDecline")}
              </button>
              <button
                onClick={() => {
                  confirm.resolve(true);
                  setConfirm(null);
                }}
                className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--color-accent-fg)]"
              >
                {t("confirmApprove")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  ready,
  onOpenSettings,
}: {
  ready: boolean;
  onOpenSettings: () => void;
}) {
  const t = useT();
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[var(--color-accent)] text-lg font-bold text-[var(--color-accent-fg)]">
          M
        </div>
        <h1 className="text-xl font-semibold">Magnetar</h1>
        <p className="mt-1 text-sm text-[var(--color-text-dim)]">
          {ready ? t("emptyReady") : t("emptyNotReady")}
        </p>
        {!ready && (
          <button
            onClick={onOpenSettings}
            className="mt-4 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)]"
          >
            {t("addConnection")}
          </button>
        )}
      </div>
    </div>
  );
}
