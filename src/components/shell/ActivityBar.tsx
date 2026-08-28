import { useEffect, useRef, useState } from "react";
import {
  Files,
  Chats,
  Discussion,
  Agent as AgentIcon,
  Generation,
  Git,
  Search,
  Memory,
  Changes,
  Problems,
  Play,
  Keys,
  Settings,
  Guide,
  Languages,
  Globe,
  Projects,
  Check,
  Sun,
  Moon,
  Monitor,
  Info,
  type IconType,
} from "../icons";
import { useStore, type SidePanel } from "../../lib/store";
import { useT, LANGS } from "../../lib/i18n";
import { LogoMark } from "../Logo";
import { cn } from "../../lib/cn";
import { Hint } from "../ui/Hint";
import type { Theme } from "../../lib/theme";

/** The rail on the far left. It switches the primary side panel — it never
 *  swaps the whole screen — and it is grouped so the two halves of the product
 *  read as different things:
 *
 *    CODE     what is on disk right now (files, search, git, agent edits)
 *    PROJECT  what Magnetar remembers and plans (memory, chats)
 *
 *  Global entry points sit at the bottom, separated by a rule. */
export function ActivityBar({
  onOpenSettings,
  onOpenGuide,
}: {
  onOpenSettings: () => void;
  onOpenGuide: () => void;
}) {
  const t = useT();
  const sidePanel = useStore((s) => s.sidePanel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const centerView = useStore((s) => s.centerView);
  const setCenterView = useStore((s) => s.setCenterView);
  const activeTrack = useStore((s) => s.activeTrack);
  const switchTrack = useStore((s) => s.switchTrack);
  const pendingChanges = useStore(
    (s) => s.changes.filter((c) => !c.reverted).length,
  );
  // Errors only: warnings would make the rail badge shout about lint noise.
  const problemCount = useStore((s) =>
    Object.values(s.checkRuns).reduce(
      (n, r) => n + r.problems.filter((p) => p.severity === "error").length,
      0,
    ),
  );

  type RailItem = { id: SidePanel; icon: IconType; label: string; hint: string };

  const codeGroup: RailItem[] = [
    { id: "explorer", icon: Files, label: t("navExplorer"), hint: t("hintExplorer") },
    { id: "search", icon: Search, label: t("navSearch"), hint: t("hintSearch") },
    { id: "git", icon: Git, label: t("navSourceControl"), hint: t("hintGit") },
    { id: "problems", icon: Problems, label: t("problemsTitle"), hint: t("hintProblems") },
    { id: "tasks", icon: Play, label: t("tasksTitle"), hint: t("hintTasks") },
    { id: "changes", icon: Changes, label: t("navChanges"), hint: t("hintChanges") },
  ];

  const projectGroup: RailItem[] = [
    { id: "project", icon: Memory, label: t("navProject"), hint: t("hintProject") },
    { id: "chats", icon: Chats, label: t("navChats"), hint: t("hintChats") },
  ];

  const railItem = (it: RailItem) => (
    <Hint key={it.id} text={it.hint}>
      <RailButton
        icon={it.icon}
        label={it.label}
        active={sidebarOpen && sidePanel === it.id}
        onClick={() => setSidePanel(it.id)}
        badge={
          it.id === "changes"
            ? pendingChanges
            : it.id === "problems"
              ? problemCount
              : 0
        }
      />
    </Hint>
  );

  return (
    <nav
      aria-label={t("workspace")}
      className="flex h-full shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ width: "var(--w-activitybar)" }}
    >
      <div
        data-tauri-drag-region
        className="grid h-[var(--h-titlebar)] w-full place-items-center"
        title="Magnetar"
      >
        <LogoMark size={22} />
      </div>

      {/* The mode selector — the product's primary "what am I doing" switch —
          lives at the top of the rail so it is always reachable, even when a
          mode (generation) takes over the whole centre. */}
      <RailGroup label={t("agentPanel")}>
        <Hint text={t("trackChatHint")}>
          <RailButton
            icon={Discussion}
            label={t("trackChat")}
            active={activeTrack === "chat"}
            onClick={() => switchTrack("chat")}
          />
        </Hint>
        <Hint text={t("agentHint")}>
          <RailButton
            icon={AgentIcon}
            label={t("agent")}
            active={activeTrack === "agent"}
            onClick={() => switchTrack("agent")}
          />
        </Hint>
        <Hint text={t("trackGenerationHint")}>
          <RailButton
            icon={Generation}
            label={t("trackGeneration")}
            active={activeTrack === "generation"}
            onClick={() => switchTrack("generation")}
          />
        </Hint>
      </RailGroup>
      <RailRule />

      <HintsToggle />
      <RailRule />

      <RailGroup label={t("groupCode")}>{codeGroup.map(railItem)}</RailGroup>
      <RailRule />
      <RailGroup label={t("groupProject")}>{projectGroup.map(railItem)}</RailGroup>

      <div className="flex-1" />

      <div className="flex w-full flex-col items-center gap-px border-t border-[var(--color-border)] py-1.5">
        <Hint text={t("hintProjectsPage")}>
          <RailButton
            icon={Projects}
            label={t("projects")}
            active={centerView === "projects"}
            onClick={() => setCenterView("projects")}
          />
        </Hint>
        <Hint text={t("hintSubscriptions")}>
          <RailButton
            icon={Globe}
            label={t("subscriptions")}
            active={centerView === "subscriptions"}
            onClick={() => setCenterView("subscriptions")}
          />
        </Hint>
        <ThemeMenu />
        <LanguageMenu />
        <RailButton icon={Guide} label={t("guide")} onClick={onOpenGuide} />
        <RailButton
          icon={Keys}
          label={t("settingsKeys")}
          onClick={onOpenSettings}
        />
        <RailButton
          icon={Settings}
          label={t("settingsTitle")}
          active={centerView === "settings"}
          onClick={() => setCenterView("settings")}
        />
      </div>
    </nav>
  );
}

/** The "i" switch. On, every explained control describes itself on hover —
 *  which is how the conditional parts of this product (when memory fills, what
 *  the agent can reach) become discoverable without a manual. */
function HintsToggle() {
  const t = useT();
  const on = useStore((s) => s.hintsOn);
  const toggle = useStore((s) => s.toggleHints);
  return (
    <div className="pt-1">
      <RailButton
        icon={Info}
        label={on ? t("hintsOff") : t("hintsOn")}
        active={on}
        onClick={() => toggle()}
      />
    </div>
  );
}

/** A labelled cluster of rail buttons. The label is for screen readers only —
 *  sighted users get the grouping from the rules between clusters. */
function RailGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-full flex-col items-center gap-px pt-1"
    >
      {children}
    </div>
  );
}

function RailRule() {
  return <div className="my-1.5 h-px w-5 bg-[var(--color-border)]" aria-hidden />;
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge = 0,
}: {
  icon: IconType;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid h-9 w-9 place-items-center rounded-[var(--r-md)] text-[var(--color-text-dim)]",
        "transition-colors duration-[var(--dur-fast)]",
        "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        active && "bg-[var(--color-surface-3)] text-[var(--color-text)]",
      )}
    >
      {/* The active marker is a graphite bar flush to the rail edge. */}
      {active && (
        <span
          className="absolute -left-1.5 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[var(--color-accent)]"
          aria-hidden
        />
      )}
      <Icon size={18} strokeWidth={1.75} />
      {badge > 0 && (
        <span className="absolute right-0.5 top-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-[var(--color-accent-strong)] px-1 text-[length:var(--fs-2xs)] font-semibold leading-none text-[var(--color-accent-fg)]">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/** Light / dark / follow-system. The icon shows what is active. */
function ThemeMenu() {
  const t = useT();
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false));

  const options: { id: Theme; icon: IconType; label: string }[] = [
    { id: "light", icon: Sun, label: t("themeLight") },
    { id: "dark", icon: Moon, label: t("themeDark") },
    { id: "system", icon: Monitor, label: t("themeSystem") },
  ];
  const current = options.find((o) => o.id === theme) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <RailButton
        icon={current.icon}
        label={`${t("theme")} · ${current.label}`}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Popover>
          <div className="section-label pt-1">{t("theme")}</div>
          {options.map((o) => (
            <button
              key={o.id}
              className="row"
              data-active={theme === o.id}
              onClick={() => {
                setTheme(o.id);
                setOpen(false);
              }}
            >
              <o.icon size={14} className="shrink-0 opacity-80" />
              <span className="flex-1 truncate">{o.label}</span>
              {theme === o.id && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

function LanguageMenu() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <RailButton
        icon={Languages}
        label={`${t("language")} · ${lang.toUpperCase()}`}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <Popover>
          <div className="section-label pt-1">{t("language")}</div>
          {LANGS.map((l) => (
            <button
              key={l.code}
              className="row"
              data-active={lang === l.code}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
            >
              <span className="flex-1 truncate">{l.label}</span>
              {lang === l.code && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}

/** Shared popover shell for the rail's bottom menus. */
function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="anim-in absolute bottom-0 left-full z-40 ml-1.5 w-48 overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--e-3)]">
      {children}
    </div>
  );
}

/** Close a popover on outside click or Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, close]);
}
