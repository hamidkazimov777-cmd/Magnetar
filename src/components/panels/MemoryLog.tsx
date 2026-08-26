import { Check, TriangleAlert, MinusCircle, Eraser } from "../icons";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import type { MemoryEvent, MemoryEventKind } from "../../lib/types";

const KIND_KEY: Record<MemoryEventKind, string> = {
  audit: "memLogKindAudit",
  handoff: "memLogKindHandoff",
  decisions: "memLogKindDecisions",
  graph: "memLogKindGraph",
  summary: "memLogKindSummary",
  index: "memLogKindIndex",
};

/** Recent background writes to project memory.
 *
 *  Memory fills itself from several triggers on a cheap model, and every one of
 *  those calls can fail — a refused model, a reply that is not JSON. Before this
 *  the failures were swallowed and memory just stayed empty with no explanation.
 *  This is the feed that makes them visible. */
export function MemoryLog({ limit = 6 }: { limit?: number }) {
  const t = useT();
  const log = useStore((s) => s.memoryLog);
  const clear = useStore((s) => s.clearMemoryLog);

  return (
    <>
      <div className="section-label flex items-center gap-2">
        <span className="flex-1">{t("memLogTitle")}</span>
        {log.length > 0 && (
          <button
            className="icon-btn h-5 w-5"
            title={t("memLogClear")}
            onClick={clear}
          >
            <Eraser size={12} />
          </button>
        )}
      </div>
      <p className="section-hint">{t("memLogHint")}</p>

      {log.length === 0 ? (
        <p className="px-2 pb-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {t("memLogEmpty")}
        </p>
      ) : (
        <ul className="space-y-1 px-1">
          {log.slice(0, limit).map((e) => (
            <Row key={e.id} event={e} />
          ))}
        </ul>
      )}
    </>
  );
}

function Row({ event }: { event: MemoryEvent }) {
  const t = useT();
  const Icon =
    event.status === "ok"
      ? Check
      : event.status === "error"
        ? TriangleAlert
        : MinusCircle;
  const tone =
    event.status === "ok"
      ? "var(--color-success)"
      : event.status === "error"
        ? "var(--color-danger)"
        : "var(--color-text-mute)";

  // Known causes are shipped as i18n keys; anything else is the provider's own
  // words and is shown verbatim.
  const detail = event.detail
    ? event.detail.startsWith("mem")
      ? t(event.detail)
      : event.detail
    : undefined;

  return (
    <li
      className="flex items-start gap-2 rounded-[var(--r-sm)] px-1.5 py-1"
      title={[event.model, detail].filter(Boolean).join(" · ")}
    >
      <Icon size={12} className="mt-0.5 shrink-0" style={{ color: tone }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[length:var(--fs-sm)]">
            {t(KIND_KEY[event.kind])}
          </span>
          <span className="shrink-0 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
            {new Date(event.at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        {detail && event.status !== "ok" && (
          <p className="mt-0.5 line-clamp-2 break-words text-[length:var(--fs-xs)] leading-snug text-[var(--color-text-mute)]">
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}
