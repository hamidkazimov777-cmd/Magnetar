import { useState } from "react";
import { Sparkles } from "./icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { useT } from "../lib/i18n";
import type { AskRequest } from "../lib/agent";

/** The agent putting a choice to the user at the moment it makes it.
 *
 *  Memory grows out of the work rather than being written in advance: whatever
 *  is answered here is stored as a decision, with the question as its context.
 *  It is deliberately not a confirmation dialog — nothing is being approved,
 *  something is being decided, and the difference matters after the incident
 *  where confirmation fatigue led the user to switch approvals off entirely. */
export function AskDialog({
  req,
  onAnswer,
}: {
  req: AskRequest;
  onAnswer: (answer: string) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");

  return (
    <Dialog
      open
      // Dismissing without an answer is a valid outcome: the agent is told to
      // decide for itself and say so, rather than stalling.
      onOpenChange={() => onAnswer("")}
    >
      <DialogContent className="w-[min(92vw,36rem)] max-w-[92vw] gap-0 overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)]">
        <DialogHeader className="flex flex-row items-center gap-2.5 border-b border-[var(--color-border)] px-5 py-3.5">
          <Sparkles size={17} className="shrink-0 text-[var(--color-ai)]" />
          <div className="min-w-0">
            <DialogTitle className="text-[length:var(--fs-md)] font-semibold">
              {t("askTitle")}
            </DialogTitle>
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
              {t("askSubtitle")}
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <p className="text-[length:var(--fs-md)] leading-[var(--lh-base)]">{req.question}</p>

          {req.recommendation && (
            <p className="text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
              <span className="text-[var(--color-text-mute)]">{t("askRecommends")}: </span>
              {req.recommendation}
            </p>
          )}

          {req.options.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {req.options.map((o) => (
                <button
                  key={o}
                  className="btn btn-secondary justify-start text-left"
                  onClick={() => onAnswer(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          )}

          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) onAnswer(draft.trim());
            }}
            placeholder={t("askPlaceholder")}
            className="input w-full"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button className="btn btn-ghost" onClick={() => onAnswer("")}>
            {t("askDecideYourself")}
          </button>
          <button
            className="btn btn-primary"
            disabled={!draft.trim()}
            onClick={() => onAnswer(draft.trim())}
          >
            {t("askAnswer")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
