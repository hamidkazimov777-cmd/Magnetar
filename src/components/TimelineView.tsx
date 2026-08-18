import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { TimelineEvent } from "../lib/types";

export function TimelineView() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    if (activeProjectId) {
      db.listTimelineEvents(activeProjectId).then(setEvents).catch(console.error);
    } else {
      setEvents([]);
    }
  }, [activeProjectId]);

  if (!activeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[var(--color-text-dim)]">
        <div className="text-center">
          <Clock size={48} className="mx-auto mb-4 opacity-20" />
          <p>Select a project to view its Timeline</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-8 overflow-y-auto">
      <h1 className="text-2xl font-semibold text-[var(--color-text)] flex items-center gap-2">
        <Clock size={24} /> Project Timeline
      </h1>
      <p className="mt-2 text-[var(--color-text-dim)] mb-8">
        Chronological record of decisions, events, and actions.
      </p>

      <div className="relative pl-4 space-y-6 max-w-2xl border-l border-[var(--color-border)]">
        {events.length === 0 && <p className="text-[var(--color-text-dim)] text-sm ml-4">No events recorded yet.</p>}
        {events.map(e => {
          const date = new Date(e.createdAt);
          return (
            <div key={e.id} className="relative pl-6">
              <div className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-[var(--color-accent)] outline outline-4 outline-[var(--color-background)]" />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--color-accent-strong)]">{e.eventType}</span>
                  <span className="text-xs text-[var(--color-text-dim)]">{date.toLocaleDateString()} {date.toLocaleTimeString()}</span>
                </div>
                <p className="text-sm text-[var(--color-text)] mt-1">{e.content}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
