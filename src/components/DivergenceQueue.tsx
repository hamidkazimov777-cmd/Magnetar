import { GitCompare, Check, X } from "./icons";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { applyDivergence, dismissDivergence } from "../lib/divergence";
import type { Divergence } from "../lib/types";

/** The pile of contradictions between memory and the code.
 *
 *  Reviewed in a batch, when the user feels like it — never raised mid-task.
 *  The whole reason this is a queue and not a dialog is that confirmation
 *  fatigue is what made the user switch approvals off in the first place. */
export function DivergenceQueue({ projectId }: { projectId: string }) {
  const t = useT();
  const all = useStore((s) => s.divergences[projectId]) ?? [];
  const open = all.filter((d) => d.status === "open");
  if (!open.length) return null;

  return (
    <section>
      <div className="flex items-center gap-2">
        <span className="field-label">{t("divergencesTitle")}</span>
        <span className="badge">{open.length}</span>
      </div>
      <p className="mb-2 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
        {t("divergencesHint")}
      </p>
      <div className="panel divide-y divide-[var(--color-border)]">
        {open.map((d) => (
          <Row key={d.id} d={d} />
        ))}
      </div>
    </section>
  );
}

function Row({ d }: { d: Divergence }) {
  const t = useT();
  const facts = useStore((s) => s.facts[d.projectId]) ?? [];
  const current = d.factId ? facts.find((f) => f.id === d.factId) : undefined;

  return (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <GitCompare size={14} className="mt-0.5 shrink-0 text-[var(--color-text-mute)]" />
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--fs-base)] leading-[var(--lh-base)]">{d.summary}</p>

        {current && (
          <p className="mt-1 text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
            <span className="text-[var(--color-text-mute)]">{t("divergenceNow")}: </span>
            <span className="line-through decoration-[var(--color-danger)]">{current.text}</span>
          </p>
        )}
        <p className="text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
          <span className="text-[var(--color-text-mute)]">{t("divergenceProposed")}: </span>
          {d.proposal || t("divergenceDrop")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
          <span>{new Date(d.createdAt).toLocaleDateString()}</span>
          <span>{d.source === "check" ? t("divergenceBySource") : t("divergenceByAgent")}</span>
          {d.evidence && <span className="badge">{d.evidence}</span>}
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        <button
          className="icon-btn h-6 w-6"
          title={t("divergenceApply")}
          onClick={() => applyDivergence(d)}
        >
          <Check size={13} />
        </button>
        <button
          className="icon-btn h-6 w-6"
          title={t("divergenceDismiss")}
          onClick={() => dismissDivergence(d)}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
