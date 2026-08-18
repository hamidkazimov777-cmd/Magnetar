import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Search, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import type { ModelInfo } from "../lib/types";
import { cn } from "../lib/cn";

export function ModelSwitcher() {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
  const setActiveConnection = useStore((s) => s.setActiveConnection);
  const setActiveModel = useStore((s) => s.setActiveModel);
  const cacheModels = useStore((s) => s.setModels);

  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  }, [models, query]);

  const activeConn = connections.find((c) => c.id === activeConnectionId);

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
      const list = await api.listModels(conn);
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      >
        <span className="max-w-[240px] truncate font-medium">
          {activeModel ?? t("selectModel")}
        </span>
        <ChevronDown size={15} className="text-[var(--color-text-dim)]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-80 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
          {connections.length > 1 && (
            <div className="border-b border-[var(--color-border)] p-2">
              <div className="px-2 pb-1 text-xs text-[var(--color-text-dim)]">
                {t("connection")}
              </div>
              {connections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveConnection(c.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-surface-2)]",
                    c.id === activeConnectionId && "text-[var(--color-accent)]",
                  )}
                >
                  {c.name}
                  {c.id === activeConnectionId && <Check size={14} />}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-2">
            {models.length > 6 ? (
              <div className="flex flex-1 items-center gap-2 rounded-lg bg-[var(--color-bg)] px-2.5 py-1.5">
                <Search size={14} className="text-[var(--color-text-dim)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("selectModel")}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--color-text-dim)]"
                />
              </div>
            ) : (
              <span className="flex-1 px-1 text-xs text-[var(--color-text-dim)]">
                {models.length} {t("modelsCount")}
              </span>
            )}
            <button
              onClick={() => activeConnectionId && loadModels(activeConnectionId)}
              title={t("refreshModels")}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--color-text-dim)]">
                <Loader2 size={15} className="animate-spin" /> {t("loadingModels")}
              </div>
            )}
            {error && (
              <div className="px-2 py-3 text-sm text-red-400">{error}</div>
            )}
            {!loading &&
              !error &&
              filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setActiveModel(m.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-2)]",
                    m.id === activeModel && "text-[var(--color-accent)]",
                  )}
                >
                  <span className="truncate">{m.label ?? m.id}</span>
                  {m.id === activeModel && <Check size={14} className="shrink-0" />}
                </button>
              ))}
            {!loading && !error && filtered.length === 0 && (
              <div className="px-2 py-3 text-sm text-[var(--color-text-dim)]">
                {t("noModels")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
