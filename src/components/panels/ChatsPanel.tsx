import { useMemo, useState } from "react";
import { MessageSquare, Plus, Search, Trash2, Pencil, Check, X,
  Bot,
} from "lucide-react";
import { useStore, NEW_CHAT_TITLE } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { EmptyState } from "../ui/EmptyState";
import type { Session } from "../../lib/types";

const DAY = 86_400_000;

/** Bucket sessions the way every modern chat app does: recency groups, newest
 *  first, so the current work is always at the top. */
function groupSessions(sessions: Session[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();

  const groups: { key: string; items: Session[] }[] = [
    { key: "chatGroupToday", items: [] },
    { key: "chatGroupYesterday", items: [] },
    { key: "chatGroupWeek", items: [] },
    { key: "chatGroupOlder", items: [] },
  ];

  for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (s.updatedAt >= today) groups[0].items.push(s);
    else if (s.updatedAt >= today - DAY) groups[1].items.push(s);
    else if (s.updatedAt >= today - 6 * DAY) groups[2].items.push(s);
    else groups[3].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function ChatsPanel() {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const newSession = useStore((s) => s.newSession);
  const selectSession = useStore((s) => s.selectSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const renameSession = useStore((s) => s.renameSession);
  const toggleAgentPanel = useStore((s) => s.toggleAgentPanel);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const titleOf = (s: Session) =>
    s.title === NEW_CHAT_TITLE ? t("newChatTitle") : s.title;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        titleOf(s).toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, query]);

  const groups = useMemo(() => groupSessions(filtered), [filtered]);

  const create = () => {
    newSession();
    toggleAgentPanel(true);
  };

  const startRename = (s: Session) => {
    setEditing(s.id);
    setDraft(titleOf(s));
  };

  const commitRename = (id: string) => {
    const v = draft.trim();
    if (v) renameSession(id, v);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">{t("chatsTitle")}</span>
        <button className="icon-btn" title={t("newChat")} onClick={create}>
          <Plus size={15} />
        </button>
      </header>

      {/* Chats are the transcript, not the memory — say so, so the two are
          never confused. Memory lives in the Project panel. */}
      <p className="section-hint px-3 pt-2">{t("chatsWhat")}</p>

      {sessions.length > 0 && (
        <div className="px-2 pb-1 pt-1">
          <div className="flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2">
            <Search size={13} className="shrink-0 text-[var(--color-text-mute)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chatSearchPlaceholder")}
              className="h-7 w-full bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
            />
            {query && (
              <button className="icon-btn h-5 w-5" onClick={() => setQuery("")} title={t("clear")}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={t("noChats")}
            text={t("noChatsHint")}
            action={{ label: t("newChat"), onClick: create }}
          />
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
            {t("chatEmptyFound")}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="section-label">{t(g.key)}</div>
              {g.items.map((s) => {
                const isEditing = editing === s.id;
                return (
                  <div
                    key={s.id}
                    className="group/chat relative flex items-center"
                  >
                    {isEditing ? (
                      <div className="flex w-full items-center gap-1 px-2 py-1">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(s.id);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="input h-7"
                        />
                        <button
                          className="icon-btn h-6 w-6"
                          onClick={() => commitRename(s.id)}
                          title={t("save")}
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="row min-w-0 flex-1"
                          data-active={activeSessionId === s.id}
                          onClick={() => {
                            selectSession(s.id);
                            toggleAgentPanel(true);
                          }}
                          onDoubleClick={() => startRename(s)}
                          title={titleOf(s)}
                        >
                          {/* Which track a chat belongs to, at a glance: an
                              agent run and a discussion read very differently
                              and are easy to confuse in a list of titles. */}
                          {(s.track ?? "agent") === "agent" ? (
                            <Bot size={14} className="shrink-0 text-[var(--color-ai)] opacity-80" />
                          ) : (
                            <MessageSquare size={14} className="shrink-0 opacity-70" />
                          )}
                          <span className="truncate">{titleOf(s)}</span>
                        </button>
                        <span className="absolute right-1 flex gap-0.5 opacity-0 transition-opacity group-hover/chat:opacity-100">
                          <button
                            className="icon-btn h-6 w-6 bg-[var(--color-surface)]"
                            title={t("rename")}
                            onClick={() => startRename(s)}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className="icon-btn h-6 w-6 bg-[var(--color-surface)] hover:text-[var(--color-danger)]"
                            title={t("delete")}
                            onClick={() => {
                              if (confirm(t("chatDeleteConfirm"))) deleteSession(s.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
