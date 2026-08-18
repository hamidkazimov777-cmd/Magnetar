import { BookOpen, Settings, FolderGit2, MessageSquare, ListTodo, Network, Clock, Globe, Code2, GitBranch, TerminalSquare, PanelLeftOpen } from "lucide-react";
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
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-surface)]">
      <div
        data-tauri-drag-region
        className="flex h-12 items-center justify-center"
      >
        <LogoMark size={27} />
      </div>

      <div className="flex w-full flex-col items-center gap-1 py-2">
        <Nav icon={PanelLeftOpen} active={activeTab === "workspace"} label={t("workspace")} onClick={() => onTabChange("workspace")} />
        <Nav icon={MessageSquare} active={activeTab === "chats"} label={t("chats")} onClick={() => onTabChange("chats")} />
        <Nav icon={FolderGit2} active={activeTab === "projects"} label={t("projects")} onClick={() => onTabChange("projects")} />
        <Nav icon={ListTodo} active={activeTab === "roadmap"} label={t("roadmap")} onClick={() => onTabChange("roadmap")} />
        <Nav icon={Network} active={activeTab === "knowledge"} label={t("knowledgeGraph")} onClick={() => onTabChange("knowledge")} />
        <Nav icon={Clock} active={activeTab === "timeline"} label={t("timeline")} onClick={() => onTabChange("timeline")} />
        <Nav icon={GitBranch} active={activeTab === "git"} label={t("git")} onClick={() => onTabChange("git")} />
        <Nav icon={TerminalSquare} active={activeTab === "terminal"} label={t("terminal")} onClick={() => onTabChange("terminal")} />
        <Nav icon={Globe} active={activeTab === "subscriptions"} label={t("subscriptions")} onClick={() => onTabChange("subscriptions")} />
      </div>
      <div className="hidden">
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
          {t("chats")}
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
          {t("projects")}
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
          {t("roadmap")}
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
          {t("knowledgeGraph")}
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
          {t("timeline")}
        </button>
        <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--color-text-dim)]">{t("navWorkspace")}</div>
        <button
          onClick={() => onTabChange("code")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "code"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <Code2 size={16} />
          {t("code")}
        </button>
        <button
          onClick={() => onTabChange("git")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "git"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <GitBranch size={16} />
          {t("git")}
        </button>
        <button
          onClick={() => onTabChange("terminal")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "terminal"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <TerminalSquare size={16} />
          {t("terminal")}
        </button>
        <button
          onClick={() => onTabChange("subscriptions")}
          className={cn(
            "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm",
            activeTab === "subscriptions"
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          )}
        >
          <Globe size={16} />
          {t("subscriptions")}
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex w-full flex-col items-center gap-2 border-t border-[var(--color-border)] py-3">
        <div className="hidden gap-1">
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
        <Nav icon={BookOpen} label={t("guide")} onClick={onOpenGuide} />
        <Nav icon={Settings} label={t("settingsKeys")} onClick={onOpenSettings} />
      </div>
    </aside>
  );
}

function Nav({ icon: Icon, label, active, onClick }: { icon: typeof Code2; label: string; active?: boolean; onClick: () => void }) {
  return <button title={label} aria-label={label} onClick={onClick} className={cn("grid h-9 w-9 place-items-center rounded-lg text-[var(--color-text-dim)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]", active && "bg-[var(--color-surface-2)] text-[var(--color-accent-strong)]")}><Icon size={19} /></button>;
}
