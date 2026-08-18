import { MessageSquarePlus, Settings, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { cn } from "../lib/cn";

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const newSession = useStore((s) => s.newSession);
  const selectSession = useStore((s) => s.selectSession);
  const deleteSession = useStore((s) => s.deleteSession);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-4 pb-2 pt-9"
      >
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-sm font-bold text-[var(--color-accent-fg)]">
          M
        </div>
        <span className="text-sm font-semibold tracking-tight">Magnetar</span>
      </div>

      <div className="p-3">
        <button
          onClick={() => newSession()}
          className="flex w-full items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
        >
          <MessageSquarePlus size={16} />
          New chat
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => selectSession(s.id)}
            className={cn(
              "group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-sm",
              s.id === activeSessionId
                ? "bg-[var(--color-surface-2)]"
                : "hover:bg-[var(--color-surface-2)]/60",
            )}
          >
            <span className="truncate text-[var(--color-text)]">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteSession(s.id);
              }}
              className="opacity-0 transition group-hover:opacity-100"
            >
              <Trash2
                size={14}
                className="text-[var(--color-text-dim)] hover:text-red-400"
              />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-[var(--color-text-dim)]">
            No chats yet.
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-3">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Settings size={16} />
          Settings & keys
        </button>
      </div>
    </aside>
  );
}
