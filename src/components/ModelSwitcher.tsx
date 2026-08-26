import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  Search,
  RefreshCw,
  Ban,
  Wrench,
  MessageSquareCode,
  RotateCcw,
} from "./icons";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { flushHandoffToMemory } from "../lib/memory";
import { providerForBaseUrl } from "../lib/generation";
import { Hint } from "./ui/Hint";
import { useT } from "../lib/i18n";
import type { ModelInfo } from "../lib/types";
import { cn } from "../lib/cn";

export function ModelSwitcher() {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
  const activeTrack = useStore((s) => s.activeTrack);
  const setActiveConnection = useStore((s) => s.setActiveConnection);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const cacheModels = useStore((s) => s.setModels);
  const modelStatus = useStore((s) => s.modelStatus);
  const modelTools = useStore((s) => s.modelTools);
  const clearModelTools = useStore((s) => s.clearModelTools);

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const denied = (id: string) =>
    modelStatus[`${activeConnectionId}::${id}`] === "denied";
  /** What we learned from actually running this model as an agent. */
  const toolMode = (id: string) => modelTools[`${activeConnectionId}::${id}`];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
    // Models the token was refused for sink to the bottom instead of sitting
    // at the top waiting to fail again.
    return [...list].sort(
      (a, b) => Number(denied(a.id)) - Number(denied(b.id)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, query, modelStatus, activeConnectionId]);

  // The generation track shows only generative connections; every other track
  // shows only text connections. One dropdown, scoped to the track.
  const trackConns = useMemo(
    () =>
      connections.filter((c) =>
        activeTrack === "generation" ? c.kind === "generative" : c.kind !== "generative",
      ),
    [connections, activeTrack],
  );

  const activeConn = trackConns.find((c) => c.id === activeConnectionId);

  // Seed from the persisted catalog so models never appear "lost" after restart.
  const cachedModels = useStore((s) =>
    activeConnectionId ? s.models[activeConnectionId] : undefined,
  );
  useEffect(() => {
    if (cachedModels && cachedModels.length) setModels(cachedModels);
    else setModels([]);
  }, [cachedModels]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const loadModels = async (connId: string) => {
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    setLoading(true);
    setError(null);
    try {
      let list: ModelInfo[];
      if (activeTrack === "generation") {
        // Generative models are curated in the catalogue — no /models call.
        list = (providerForBaseUrl(conn.baseUrl)?.models ?? []).map((id) => ({ id }));
      } else {
        list = await api.listModels(conn);
      }
      setModels(list);
      cacheModels(connId, list); // cache for the adaptive router
      if (!activeModel && list[0]) setActiveModel(list[0].id);
    } catch (e) {
      setError(String(e));
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Use the cache; only fetch when we have nothing (manual refresh updates it).
    if (open && activeConnectionId && (!cachedModels || cachedModels.length === 0))
      loadModels(activeConnectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeConnectionId]);

  if (!activeConn) return null;

  return (
    <div className="relative" ref={boxRef}>
      <Hint text={t("hintModelSwitcher")} side="bottom">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[var(--r-md)] px-2 py-1 text-[length:var(--fs-base)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-2)]"
        title={`${activeConn.name} · ${activeModel ?? ""}`}
      >
        {/* Violet dot = the model currently executing. The model is the
            swappable part of the product, so it gets the AI accent. */}
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            activeModel ? "bg-[var(--color-ai)]" : "bg-[var(--color-text-mute)]",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-left font-medium">
          {activeModel ?? t("selectModel")}
        </span>
        <ChevronDown size={14} className="shrink-0 text-[var(--color-text-mute)]" />
      </button>
      </Hint>

      {open && (
        <div className="anim-in absolute left-0 top-full z-30 mt-1.5 w-80 overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--e-3)]">
          {trackConns.length > 1 && (
            <div className="border-b border-[var(--color-border)] p-2">
              <div className="section-label pt-1">{t("connection")}</div>
              {trackConns.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    if (c.id !== activeConnectionId) void flushHandoffToMemory();
                    setActiveConnection(c.id);
                  }}
                  className="row"
                  data-active={c.id === activeConnectionId}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {c.id === activeConnectionId && <Check size={14} className="shrink-0" />}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-2">
            {models.length > 6 ? (
              <div className="flex flex-1 items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 focus-within:border-[var(--color-accent)]">
                <Search size={14} className="text-[var(--color-text-dim)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("selectModel")}
                  className="w-full bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
                />
              </div>
            ) : (
              <span className="flex-1 px-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                {models.length} {t("modelsCount")}
              </span>
            )}
            <button
              onClick={() => activeConnectionId && loadModels(activeConnectionId)}
              title={t("refreshModels")}
              className="icon-btn"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                <Loader2 size={15} className="animate-spin" /> {t("loadingModels")}
              </div>
            )}
            {error && (
              <div className="alert m-1 text-[length:var(--fs-sm)]">{error}</div>
            )}
            {!loading &&
              !error &&
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    // Flush the current model's recent work into project memory
                    // BEFORE switching, so the next model continues from memory.
                    if (m.id !== activeModel) void flushHandoffToMemory();
                    setActiveModel(m.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="row"
                  data-active={m.id === activeModel}
                  title={
                    denied(m.id)
                      ? t("modelDenied")
                      : toolMode(m.id) === "native"
                        ? `${m.id} — ${t("modelToolsNative")}`
                        : toolMode(m.id) === "react"
                          ? `${m.id} — ${t("modelToolsReact")}`
                          : (m.label ?? m.id)
                  }
                >
                  {denied(m.id) && (
                    <Ban size={12} className="shrink-0 text-[var(--color-danger)]" />
                  )}
                  <span
                    className={cn(
                      "truncate",
                      denied(m.id) && "text-[var(--color-text-mute)] line-through",
                    )}
                  >
                    {m.label ?? m.id}
                  </span>
                  {toolMode(m.id) === "native" && (
                    <Wrench
                      size={11}
                      className="shrink-0 text-[var(--color-success)]"
                      aria-label={t("modelToolsNative")}
                    />
                  )}
                  {/* A wrong "react" mark makes a capable model print tool
                      calls as text forever; this clears it. */}
                  {toolMode(m.id) && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={t("modelToolsReset")}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeConnectionId) clearModelTools(activeConnectionId, m.id);
                      }}
                      className="icon-btn h-5 w-5 shrink-0"
                    >
                      <RotateCcw size={11} />
                    </span>
                  )}
                  {toolMode(m.id) === "react" && (
                    <MessageSquareCode
                      size={11}
                      className="shrink-0 text-[var(--color-warning)]"
                      aria-label={t("modelToolsReact")}
                    />
                  )}
                  {m.id === activeModel && (
                    <Check size={14} className="shrink-0 text-[var(--color-ai)]" />
                  )}
                </button>
              ))}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-2 py-3 text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                {t("noModels")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
