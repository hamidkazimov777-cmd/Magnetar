import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Files,
  MessageSquare,
  GitBranch,
  BrainCircuit,
  ListTodo,
  Network,
  Clock,
  Globe,
  Settings,
  BookOpen,
  Bot,
  AlertCircle,
  History,
  Sparkles,
  TerminalSquare,
  FolderGit2,
  Plus,
  Languages,
  PanelRight,
  CornerDownLeft,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useStore, NEW_CHAT_TITLE, type CenterView, type SidePanel } from "../../lib/store";
import { useT, LANGS } from "../../lib/i18n";
import { pickWorkspaceFolder } from "../panels/ExplorerPanel";
import { cn } from "../../lib/cn";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: typeof Files;
  run: () => void;
}

/** ⌘K — the fastest path to anything. Keeps the product navigable without the
 *  user having to learn where each surface lives. */
export function CommandPalette({
  open,
  onClose,
  onOpenSettings,
  onOpenGuide,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenGuide: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const sessions = useStore((s) => s.sessions);

  const commands = useMemo<Cmd[]>(() => {
    const st = useStore.getState();
    const go = (panel: SidePanel) => () => {
      useStore.setState({ sidePanel: panel, sidebarOpen: true });
    };
    const page = (view: CenterView) => () => st.setCenterView(view);

    const nav: Cmd[] = [
      { id: "explorer", group: "cmdGroupNav", label: t("navExplorer"), icon: Files, run: go("explorer") },
      { id: "chats", group: "cmdGroupNav", label: t("navChats"), icon: MessageSquare, run: go("chats") },
      { id: "search", group: "cmdGroupNav", label: t("navSearch"), icon: Search, run: go("search") },
      { id: "git", group: "cmdGroupNav", label: t("navSourceControl"), icon: GitBranch, run: go("git") },
      { id: "problems", group: "cmdGroupNav", label: t("problemsTitle"), icon: AlertCircle, run: go("problems") },
      { id: "changes", group: "cmdGroupNav", label: t("navChanges"), icon: History, run: go("changes") },
      { id: "project", group: "cmdGroupNav", label: t("navProject"), icon: BrainCircuit, run: go("project") },
      { id: "projects", group: "cmdGroupNav", label: t("projects"), icon: FolderGit2, run: page("projects") },
      { id: "roadmap", group: "cmdGroupNav", label: t("roadmap"), icon: ListTodo, run: page("roadmap") },
      { id: "knowledge", group: "cmdGroupNav", label: t("knowledgeGraph"), icon: Network, run: page("knowledge") },
      { id: "timeline", group: "cmdGroupNav", label: t("timeline"), icon: Clock, run: page("timeline") },
      { id: "subs", group: "cmdGroupNav", label: t("subscriptions"), icon: Globe, run: page("subscriptions") },
    ];

    const actions: Cmd[] = [
      { id: "new-chat", group: "cmdGroupActions", label: t("cmdNewChat"), icon: Plus, run: () => { st.newSession(); st.toggleAgentPanel(true); } },
      { id: "open-folder", group: "cmdGroupActions", label: t("cmdOpenFolder"), icon: FolderGit2, run: () => void pickWorkspaceFolder() },
      { id: "toggle-agent", group: "cmdGroupActions", label: t("cmdToggleAgent"), icon: Bot, run: () => st.setAgentMode(!st.agentMode) },
      { id: "toggle-adaptive", group: "cmdGroupActions", label: t("cmdToggleAdaptive"), icon: Sparkles, run: () => st.setAdaptive(!st.adaptive) },
      { id: "toggle-terminal", group: "cmdGroupActions", label: t("cmdToggleTerminal"), hint: "⌘J", icon: TerminalSquare, run: () => st.toggleTerminal() },
      { id: "toggle-agent-panel", group: "cmdGroupActions", label: t("cmdToggleAgentPanel"), icon: PanelRight, run: () => st.toggleAgentPanel() },
    ];

    const chats: Cmd[] = sessions
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 8)
      .map((s) => ({
        id: `chat-${s.id}`,
        group: "cmdGroupChats",
        label: s.title === NEW_CHAT_TITLE ? t("newChatTitle") : s.title,
        icon: MessageSquare,
        run: () => {
          st.selectSession(s.id);
          st.toggleAgentPanel(true);
        },
      }));

    const settings: Cmd[] = [
      { id: "settings", group: "cmdGroupSettings", label: t("settingsKeys"), icon: Settings, run: onOpenSettings },
      { id: "guide", group: "cmdGroupSettings", label: t("guide"), icon: BookOpen, run: onOpenGuide },
      ...(
        [
          ["light", Sun, t("themeLight")],
          ["dark", Moon, t("themeDark")],
          ["system", Monitor, t("themeSystem")],
        ] as const
      ).map(([id, icon, label]) => ({
        id: `theme-${id}`,
        group: "cmdGroupSettings",
        label: t("cmdSetTheme", { theme: label }),
        icon,
        run: () => st.setTheme(id),
      })),
      ...LANGS.map((l) => ({
        id: `lang-${l.code}`,
        group: "cmdGroupSettings",
        label: t("cmdSetLang", { lang: l.label }),
        icon: Languages,
        run: () => st.setLang(l.code),
      })),
    ];

    return [...nav, ...actions, ...chats, ...settings];
  }, [t, sessions, onOpenSettings, onOpenGuide]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Reset when reopened; keep the cursor inside the result set.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(results.length - 1, 0)));
  }, [results.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const pick = (c: Cmd) => {
    c.run();
    onClose();
  };

  // Group headers are rendered inline while walking the flat result list.
  let lastGroup = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-overlay)] pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="anim-in w-full max-w-[560px] overflow-hidden rounded-[var(--r-xl)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--e-3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4">
          <Search size={16} className="shrink-0 text-[var(--color-text-mute)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && results[cursor]) {
                e.preventDefault();
                pick(results[cursor]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder={t("cmdPlaceholder")}
            className="h-12 w-full bg-transparent text-[length:var(--fs-lg)] outline-none placeholder:text-[var(--color-text-mute)]"
          />
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-8 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
              {t("cmdNoResults")}
            </p>
          )}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? ((lastGroup = c.group), c.group) : null;
            return (
              <div key={c.id}>
                {header && <div className="section-label">{t(header)}</div>}
                <button
                  data-idx={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(c)}
                  className={cn(
                    "row h-9",
                    i === cursor &&
                      "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-accent-strong)]",
                  )}
                >
                  <c.icon size={15} className="shrink-0 opacity-80" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="kbd">{c.hint}</span>}
                  {i === cursor && <CornerDownLeft size={13} className="shrink-0 opacity-60" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
