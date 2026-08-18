import { BookOpen, MessageSquarePlus, Settings, Trash2, FolderGit2, MessageSquare, ListTodo, Network, Clock } from "lucide-react";
import { useStore } from "../lib/store";
import { useT, LANGS } from "../lib/i18n";
import { LogoMark } from "./Logo";
import { cn } from "../lib/cn";

export function Sidebar({
  activeTab,
  onTabChange,
  onOpenSettings,
  onOpenGuide,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
}) {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const newSession = useStore((s) => s.newSession);
  const selectSession = useStore((s) => s.selectSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 px-4 pb-2 pt-9"
      >
        <LogoMark size={26} />
        <span
          className="text-sm font-light uppercase text-[var(--color-text)]"
          style={{ letterSpacing: "0.28em" }}
        >
          Magnetar
        </span>
      </div>

      <div className="space-y-1 p-3">
        <button
          onClick={() => onTabChange("chats")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "chats"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <MessageSquare size={16} />
          {t("chats") || "Chats"}
        </button>
        <button
          onClick={() => onTabChange("projects")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "projects"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <FolderGit2 size={16} />
          {t("projects") || "Projects"}
        </button>
        <button
          onClick={() => onTabChange("roadmap")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "roadmap"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <ListTodo size={16} />
          {t("roadmap") || "Roadmap"}
        </button>
        <button
          onClick={() => onTabChange("knowledge")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "knowledge"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <Network size={16} />
          {t("knowledgeGraph") || "Knowledge Graph"}
        </button>
        <button
          onClick={() => onTabChange("timeline")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "timeline"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <Clock size={16} />
          {t("timeline") || "Timeline"}
        </button>
      </div>

      {activeTab === "chats" && (
        <>
          <div className="px-3 pb-2">
            <button
              onClick={() => newSession()}
              className="flex w-full items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] text-[var(--color-text)]"
            >
              <MessageSquarePlus size={16} />
              {t("newChat")}
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
            {t("noChats")}
          </p>
        )}
          </div>
        </>
      )}
      
      {activeTab !== "chats" && <div className="flex-1" />}

      <div className="space-y-2 border-t border-[var(--color-border)] p-3">
        <div className="flex gap-1">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={cn(
                "flex-1 rounded-lg border px-1.5 py-1 text-xs",
                lang === l.code
                  ? "border-[var(--color-accent)] text-[var(--color-accent-strong)]"
                  : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              {l.code.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={onOpenGuide}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <BookOpen size={16} />
          {t("guide")}
        </button>
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
        >
          <Settings size={16} />
          {t("settingsKeys")}
        </button>
      </div>
    </aside>
  );
}
