import { useState } from "react";
import { GitCommit, Plus, Trash2, User, Sparkles } from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { decisionFiles, recordDecision } from "../lib/decisions";
import type { Decision } from "../lib/types";

/** The decision log.
 *
 *  Not "architectural notes": entries with a date, a reason, what was rejected,
 *  and the commit the project stood at. Half a year from now the architecture
 *  is still readable in the code — the reason is not, unless it was written
 *  here when the choice was made. */
export function DecisionLog({ projectId }: { projectId: string }) {
  const t = useT();
  const list = useStore((s) => s.decisions[projectId]) ?? [];
  const [open, setOpen] = useState(false);

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <span className="field-label">{t("decisionsTitle")}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)}>
          <Plus size={13} />
          {t("decisionAdd")}
        </button>
      </div>
      <p className="mb-2 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
        {t("decisionsHint")}
      </p>

      {open && <NewDecision projectId={projectId} onDone={() => setOpen(false)} />}

      <div className="panel divide-y divide-[var(--color-border)]">
        {list.length === 0 && !open && (
          <p className="px-3 py-3 text-[length:var(--fs-sm)] text-[var(--color-text-mute)]">
            {t("decisionsEmpty")}
          </p>
        )}
        {list.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </div>
    </section>
  );
}

function DecisionRow({ decision: d }: { decision: Decision }) {
  const t = useT();
  const deleteDecision = useStore((s) => s.deleteDecision);
  const files = decisionFiles(d);

  return (
    <div className="group/dr px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--fs-base)] font-medium leading-[var(--lh-base)]">
            {d.title}
          </p>
          {d.rationale && (
            <p className="mt-1 text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
              <span className="text-[var(--color-text-mute)]">{t("decisionWhy")}: </span>
              {d.rationale}
            </p>
          )}
          {d.alternatives && (
            <p className="mt-0.5 text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
              <span className="text-[var(--color-text-mute)]">{t("decisionRejected")}: </span>
              {d.alternatives}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
            <span>{new Date(d.createdAt).toLocaleDateString()}</span>
            {d.commitSha && (
              <span className="inline-flex items-center gap-1">
                <GitCommit size={10} />
                {d.commitSha}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              {d.origin === "agent" ? <Sparkles size={10} /> : <User size={10} />}
              {d.origin === "agent"
                ? t("decisionByAgent")
                : d.origin === "legacy"
                  ? t("decisionByLegacy")
                  : t("decisionByUser")}
            </span>
            {files.map((f) => (
              <span key={f} className="badge">
                {f}
              </span>
            ))}
          </div>
        </div>
        <button
          className="icon-btn h-6 w-6 opacity-0 group-hover/dr:opacity-100"
          title={t("decisionDelete")}
          onClick={() => deleteDecision(d.projectId, d.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function NewDecision({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await recordDecision(projectId, { title, rationale: why, alternatives: alt });
    setBusy(false);
    onDone();
  };

  return (
    <div className="panel mb-2 space-y-2 p-3">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("decisionTitlePh")}
        className="input w-full"
      />
      <textarea
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        placeholder={t("decisionWhyPh")}
        rows={2}
        className="input w-full resize-none"
      />
      <textarea
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        placeholder={t("decisionAltPh")}
        rows={2}
        className="input w-full resize-none"
      />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost btn-sm" onClick={onDone}>
          {t("cancel")}
        </button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!title.trim() || busy}
          onClick={() => void submit()}
        >
          {t("decisionSave")}
        </button>
      </div>
    </div>
  );
}
