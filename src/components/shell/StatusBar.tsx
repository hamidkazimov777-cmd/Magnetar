import { useEffect, useState } from "react";
import {
  GitBranch,
  FolderGit2,
  Cpu,
  TerminalSquare,
  Bot,
  Command,
  CircleAlert,
} from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { Hint } from "../ui/Hint";

/** Always-visible footer: where you are, what you're connected to, what's
 *  pending. Every item is clickable and leads to the thing it reports. */
export function StatusBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT();
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const activeModel = useStore((s) => s.activeModel);
  const connections = useStore((s) => s.connections);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const agentMode = useStore((s) => s.agentMode);
  const setAgentMode = useStore((s) => s.setAgentMode);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const toggleTerminal = useStore((s) => s.toggleTerminal);
  const setSidePanel = useStore((s) => s.setSidePanel);
  const explorerVersion = useStore((s) => s.explorerVersion);
  const setGitStatus = useStore((s) => s.setGitStatus);

  const [branch, setBranch] = useState<string | null>(null);
  const [changes, setChanges] = useState(0);

  const conn = connections.find((c) => c.id === activeConnectionId);
  const rootName = workspaceRoot?.split(/[/\\]/).pop();

  // Poll git lightly: on root change, on explorer refresh, and every 12s.
  useEffect(() => {
    if (!workspaceRoot) {
      setBranch(null);
      setChanges(0);
      return;
    }
    let alive = true;
    const read = async () => {
      try {
        const r = await api.gitExec(workspaceRoot, ["status", "--porcelain=v1", "-b"]);
        if (!alive) return;
        if (r.code !== 0 && /not a git repository/i.test(r.stderr)) {
          setBranch(null);
          setChanges(0);
          setGitStatus({});
          return;
        }
        const lines = r.stdout.split("\n").filter(Boolean);
        const head = lines.find((l) => l.startsWith("## "));
        setBranch(head ? head.slice(3).split("...")[0].split(" ")[0] : null);

        // Porcelain: "XY path". Publish one letter per path for tree badges.
        const map: Record<string, string> = {};
        for (const line of lines) {
          if (line.startsWith("## ")) continue;
          const code = line.slice(0, 2);
          const path = line.slice(3);
          map[path] = code.includes("?") ? "U" : code.trim()[0] ?? "M";
        }
        setGitStatus(map);
        setChanges(Object.keys(map).length);
      } catch {
        /* offline / no git — the bar just omits the entry */
      }
    };
    void read();
    const iv = setInterval(read, 12_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [workspaceRoot, explorerVersion, setGitStatus]);

  return (
    <footer
      className="flex shrink-0 items-center gap-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[length:var(--fs-xs)] text-[var(--color-text-dim)]"
      style={{ height: "var(--h-statusbar)" }}
    >
      <Item
        icon={FolderGit2}
        label={rootName ?? t("statusNoFolder")}
        title={workspaceRoot}
        onClick={() => setSidePanel("explorer")}
      />

      {/* Errors and warnings, VS Code style — the place people already look
          for them, and the shortcut into the Problems panel. */}
      <ProblemsItem />

      {branch && (
        <Item
          icon={GitBranch}
          label={changes > 0 ? `${branch} · ${changes} ${t("statusChanges")}` : branch}
          onClick={() => setSidePanel("git")}
          tone={changes > 0 ? "accent" : undefined}
        />
      )}

      <div className="flex-1" />

      {/* Agent and model are AI state — the only violet in the status bar. */}
      <Item
        icon={Bot}
        label={agentMode ? t("statusAgentOn") : t("statusAgentOff")}
        onClick={() => setAgentMode(!agentMode)}
        tone={agentMode ? "ai" : undefined}
      />
      <Hint text={t("hintTerminal")} side="top">
        <Item
          icon={TerminalSquare}
          label={t("terminalTitle")}
          onClick={() => toggleTerminal()}
          tone={terminalOpen ? "accent" : undefined}
        />
      </Hint>
      <Item
        icon={Cpu}
        label={activeModel ? `${conn?.name ?? ""} · ${activeModel}` : t("statusNoModel")}
        onClick={onOpenSettings}
        tone={activeModel ? "ai" : "warning"}
      />
      <span className="ml-1 hidden items-center gap-1 pr-1 text-[var(--color-text-mute)] sm:flex">
        <Command size={11} />K
      </span>
    </footer>
  );
}

function ProblemsItem() {
  const t = useT();
  const runs = useStore((s) => s.checkRuns);
  const setSidePanel = useStore((s) => s.setSidePanel);

  const all = Object.values(runs).flatMap((r) => r.problems);
  const errors = all.filter((p) => p.severity === "error").length;
  const warnings = all.length - errors;
  const ran = Object.keys(runs).length > 0;

  return (
    <Item
      icon={CircleAlert}
      label={ran ? `${errors} · ${warnings}` : t("problemsTitle")}
      title={t("problemsTitle")}
      onClick={() => setSidePanel("problems")}
      tone={errors > 0 ? "danger" : undefined}
    />
  );
}

function Item({
  icon: Icon,
  label,
  title,
  onClick,
  tone,
}: {
  icon: typeof GitBranch;
  label: string;
  title?: string;
  onClick: () => void;
  tone?: "accent" | "ai" | "warning" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={cn(
        "flex h-full max-w-[280px] items-center gap-1.5 rounded-[var(--r-xs)] px-2 transition-colors",
        "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
        tone === "accent" && "text-[var(--color-text)]",
        tone === "ai" && "text-[var(--color-ai)]",
        tone === "warning" && "text-[var(--color-warning)]",
        tone === "danger" && "text-[var(--color-danger)]",
      )}
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
