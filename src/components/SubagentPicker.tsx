import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Search, Users, X } from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { cn } from "../lib/cn";

/* ==========================================================================
   PICKING THE HELPER BENCH

   Helpers are not one model, they are a bench: tasks are dealt round robin, so
   three models and three parallel helpers means every task runs on a different
   one — and mixing providers is the point, not an accident. A cheap model per
   task is where delegation pays for itself.

   It lives next to the track buttons rather than in Settings because it is a
   decision you make per job ("this one is worth Claude, that one is not"), not
   a preference you set once.
   ========================================================================== */

export function SubagentPicker() {
  const t = useT();
  const roster = useStore((s) => s.prefs.subagentRoster);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        className="toggle-pill"
        data-on={roster.length > 0}
        onClick={() => setOpen((v) => !v)}
        title={t("subagentPickerHint")}
      >
        <Users size={13} />
        {t("subagentsTitle")}
        {roster.length > 0 && (
          <span className="ml-0.5 rounded-full bg-[var(--color-ai)] px-1.5 text-[length:var(--fs-2xs)] font-semibold text-white">
            {roster.length}
          </span>
        )}
      </button>
      {open && <Panel onClose={() => setOpen(false)} />}
    </div>
  );
}

function Panel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setModels = useStore((s) => s.setModels);

  const [query, setQuery] = useState("");
  const [openConn, setOpenConn] = useState<string | null>(
    connections[0]?.id ?? null,
  );
  const [loading, setLoading] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on a click outside or on Escape: a popover that traps the user is
  // worse than no popover.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const load = async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    setLoading(id);
    try {
      setModels(conn.id, await api.listModels(conn));
    } catch {
      /* the row shows an empty list; Refresh is right there */
    } finally {
      setLoading(null);
    }
  };

  // Fetch a provider's catalogue the first time it is expanded, not at startup.
  useEffect(() => {
    if (openConn && !models[openConn]?.length) void load(openConn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConn]);

  const roster = prefs.subagentRoster;
  const has = (connectionId: string, model: string) =>
    roster.some((r) => r.connectionId === connectionId && r.model === model);

  const toggle = (connectionId: string, model: string) => {
    setPrefs({
      subagentRoster: has(connectionId, model)
        ? roster.filter((r) => !(r.connectionId === connectionId && r.model === model))
        : [...roster, { connectionId, model }],
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = openConn ? (models[openConn] ?? []) : [];
    return q ? list.filter((m) => m.id.toLowerCase().includes(q)) : list;
  }, [models, openConn, query]);

  const nameOf = (id: string) => connections.find((c) => c.id === id)?.name ?? "?";

  return (
    <div
      ref={ref}
      className="anim-in absolute left-0 top-[calc(100%+6px)] z-40 w-[min(92vw,26rem)] overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--e-3)]"
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-[var(--color-ai)]" />
          <span className="text-[length:var(--fs-base)] font-semibold">
            {t("subagentPickerTitle")}
          </span>
          <button className="icon-btn ml-auto h-6 w-6" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
        <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
          {t("subagentPickerNote")}
        </p>
      </div>

      {/* The bench itself, as chips — what is picked has to be visible without
          hunting through the provider lists below. */}
      <div className="flex flex-wrap gap-1 px-3 py-2">
        {roster.length === 0 ? (
          <span className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
            {t("subagentRosterEmpty")}
          </span>
        ) : (
          roster.map((r) => (
            <button
              key={`${r.connectionId}::${r.model}`}
              className="badge gap-1 hover:opacity-80"
              onClick={() => toggle(r.connectionId, r.model)}
              title={t("subagentRemove")}
            >
              <span className="opacity-60">{nameOf(r.connectionId)}</span>
              {r.model}
              <X size={10} />
            </button>
          ))
        )}
      </div>

      <div className="flex gap-1 border-y border-[var(--color-border)] px-2 py-1.5">
        {connections.map((c) => (
          <button
            key={c.id}
            className="toggle-pill h-6 text-[length:var(--fs-xs)]"
            data-on={openConn === c.id}
            onClick={() => setOpenConn(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <Search size={12} className="shrink-0 text-[var(--color-text-mute)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("subagentSearch")}
          className="h-6 w-full bg-transparent text-[length:var(--fs-sm)] outline-none placeholder:text-[var(--color-text-mute)]"
        />
        <button
          className="icon-btn h-6 w-6"
          title={t("refresh")}
          onClick={() => openConn && void load(openConn)}
        >
          {loading === openConn ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </button>
      </div>

      <div className="max-h-56 overflow-auto p-1">
        {visible.length === 0 ? (
          <p className="px-2 py-4 text-center text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
            {loading === openConn ? t("loading") : t("prefMemoryModelNoList")}
          </p>
        ) : (
          visible.map((m) => {
            const picked = openConn ? has(openConn, m.id) : false;
            return (
              <button
                key={m.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left transition-colors",
                  picked
                    ? "bg-[color-mix(in_srgb,var(--color-ai)_12%,transparent)]"
                    : "hover:bg-[var(--color-surface-2)]",
                )}
                onClick={() => openConn && toggle(openConn, m.id)}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                    picked
                      ? "border-[var(--color-ai)] bg-[var(--color-ai)] text-white"
                      : "border-[var(--color-border-strong)]",
                  )}
                >
                  {picked && <Check size={11} />}
                </span>
                <span className="truncate font-mono text-[length:var(--fs-sm)]">{m.id}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-[var(--color-border)] px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[length:var(--fs-sm)]">{t("prefSubagentParallel")}</span>
          <span className="font-mono text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
            {prefs.subagentParallel}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={prefs.subagentParallel}
          onChange={(e) => setPrefs({ subagentParallel: Number(e.target.value) })}
          className="mt-1.5 w-full accent-[var(--color-ai)]"
        />
        <p className="mt-1 text-[length:var(--fs-2xs)] leading-relaxed text-[var(--color-text-mute)]">
          {t("prefSubagentParallelHint")}
        </p>
      </div>
    </div>
  );
}
