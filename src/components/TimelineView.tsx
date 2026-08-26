import { useEffect, useState } from "react";
import { Clock } from "./icons";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { EmptyState } from "./ui/EmptyState";
import { PageHeader } from "./ui/PageHeader";
import type { TimelineEvent } from "../lib/types";

export function TimelineView() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setCenterView = useStore((s) => s.setCenterView);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    if (!activeProjectId) {
      setEvents([]);
      return;
    }
    db.listTimelineEvents(activeProjectId).then(setEvents).catch(() => setEvents([]));
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={Clock}
        title={t("tlNoProject")}
        action={{ label: t("projects"), onClick: () => setCenterView("projects") }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader icon={Clock} title={t("tlTitle")} subtitle={t("tlSubtitle")} />

      <div className="mx-auto w-full max-w-[760px] px-8 pb-10">
        {events.length === 0 ? (
          <p className="text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
            {t("tlNoEvents")}
          </p>
        ) : (
          <ol className="relative space-y-5 border-l border-[var(--color-border)] pl-1">
            {events.map((e) => {
              const date = new Date(e.createdAt);
              return (
                <li key={e.id} className="relative pl-6">
                  <span
                    aria-hidden
                    className="absolute left-[-5px] top-[7px] h-2 w-2 rounded-full bg-[var(--color-accent)] outline outline-4 outline-[var(--color-bg)]"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge" data-tone="accent">
                      {e.eventType}
                    </span>
                    <span className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                      {date.toLocaleString(lang)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[length:var(--fs-base)] leading-relaxed">
                    {e.content}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
