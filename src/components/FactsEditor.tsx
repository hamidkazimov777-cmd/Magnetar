import { useState } from "react";
import { Plus, Trash2 } from "./icons";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { FACT_KINDS, newFact } from "../lib/facts";
import type { FactKind, MemoryFact } from "../lib/types";

/** The full-width editor for project memory.
 *
 *  Memory used to be a row of textareas, so everything in it looked equally
 *  true. Here a fact is a row that shows its own provenance: what it came from,
 *  and whether a machine has confirmed it. Editing the text of a fact clears
 *  any confirmation — the old verification belonged to the old wording. */
export function FactsEditor({ projectId }: { projectId: string }) {
  const t = useT();
  const facts = useStore((s) => s.facts[projectId]) ?? [];

  const label: Record<FactKind, string> = {
    stack: t("factKindStack"),
    architecture: t("factKindArchitecture"),
    constraint: t("factKindConstraint"),
    state: t("factKindState"),
  };

  return (
    <div className="space-y-5">
      {FACT_KINDS.map((kind) => (
        <section key={kind}>
          <span className="field-label">{label[kind]}</span>
          <div className="panel divide-y divide-[var(--color-border)]">
            {facts
              .filter((f) => f.kind === kind)
              .map((f) => (
                <FactRow key={f.id} fact={f} />
              ))}
            <AddFact projectId={projectId} kind={kind} />
          </div>
        </section>
      ))}
    </div>
  );
}

function FactRow({ fact }: { fact: MemoryFact }) {
  const t = useT();
  const saveFacts = useStore((s) => s.saveFacts);
  const deleteFact = useStore((s) => s.deleteFact);
  const [draft, setDraft] = useState(fact.text);

  const commit = () => {
    const text = draft.trim();
    if (!text || text === fact.text) {
      setDraft(fact.text);
      return;
    }
    saveFacts([
      {
        ...fact,
        text,
        // Reworded by hand: this is now the user's claim, and no check stands
        // behind it any more.
        origin: "user",
        originDetail: undefined,
        status: "unverified",
        checkedAt: undefined,
        updatedAt: Date.now(),
      },
    ]);
  };

  return (
    <div className="group/fe flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <textarea
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="w-full resize-none bg-transparent text-[length:var(--fs-base)] leading-[var(--lh-base)] outline-none"
        />
        <Provenance fact={fact} />
      </div>
      <button
        className="icon-btn h-6 w-6 opacity-0 group-hover/fe:opacity-100"
        title={t("factDelete")}
        onClick={() => deleteFact(fact.projectId, fact.id)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** Where a fact came from and whether anyone confirmed it — the two things a
 *  line of prose could never tell you. */
export function Provenance({ fact }: { fact: MemoryFact }) {
  const t = useT();
  const origin =
    fact.origin === "extracted"
      ? `${t("factOriginExtracted")}: ${fact.originDetail ?? "?"}`
      : fact.origin === "user"
        ? t("factOriginUser")
        : fact.origin === "inferred"
          ? t("factOriginInferred")
          : t("factOriginLegacy");

  const status =
    fact.status === "verified"
      ? `${t("factStatusVerified")}${fact.checkedAt ? ` · ${new Date(fact.checkedAt).toLocaleDateString()}` : ""}`
      : fact.status === "stale"
        ? t("factStatusStale")
        : fact.status === "refuted"
          ? t("factStatusRefuted")
          : t("factStatusUnverified");

  const tone =
    fact.status === "verified"
      ? "text-[var(--color-success)]"
      : fact.status === "refuted" || fact.status === "stale"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-text-mute)]";

  return (
    <p className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
      {origin} · <span className={tone}>{status}</span>
    </p>
  );
}

function AddFact({ projectId, kind }: { projectId: string; kind: FactKind }) {
  const t = useT();
  const saveFacts = useStore((s) => s.saveFacts);
  const [draft, setDraft] = useState("");

  const add = () => {
    if (!draft.trim()) return;
    saveFacts([newFact(projectId, kind, draft, "user")]);
    setDraft("");
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder={t("factAddPlaceholder")}
        className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
      />
      <button className="icon-btn h-6 w-6" title={t("factAdd")} onClick={add}>
        <Plus size={13} />
      </button>
    </div>
  );
}
