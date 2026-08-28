import { useEffect, useState } from "react";
import { Play, Loader2, FlaskConical, TerminalSquare, FolderGit2 } from "../icons";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { EmptyState } from "../ui/EmptyState";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { discoverTasks, type Task } from "../../lib/tasks";

/** The project's own runnable commands, found and offered as clicks.
 *
 *  Running goes to the terminal rather than a hidden subprocess: a test suite
 *  is something you watch, scroll back through, and interrupt, and the terminal
 *  is where all three already work. This panel finds the tasks; the terminal
 *  runs them.
 */
export function TasksPanel() {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const runInTerminal = useStore((s) => s.runInTerminal);
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    if (!root) {
      setTasks(null);
      return;
    }
    setTasks(null);
    void discoverTasks(root).then(setTasks);
  }, [root]);

  if (!root)
    return (
      <div className="flex h-full flex-col">
        <header className="panel-header">
          <span className="panel-title flex-1">{t("tasksTitle")}</span>
        </header>
        <EmptyState
          icon={FolderGit2}
          title={t("explorerNoFolder")}
          action={{ label: t("explorerOpenFolder"), onClick: () => void pickWorkspaceFolder() }}
        />
      </div>
    );

  const tests = tasks?.filter((x) => x.isTest) ?? [];
  const others = tasks?.filter((x) => !x.isTest) ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">{t("tasksTitle")}</span>
      </header>

      <p className="section-hint px-3 pt-2">{t("tasksWhat")}</p>

      <div className="min-h-0 flex-1 overflow-auto px-1 pb-3">
        {tasks === null ? (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="animate-spin text-[var(--color-text-mute)]" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
            {t("tasksNone")}
          </p>
        ) : (
          <>
            {tests.length > 0 && (
              <Section
                title={t("tasksTests")}
                icon={<FlaskConical size={11} />}
                tasks={tests}
                onRun={runInTerminal}
              />
            )}
            {others.length > 0 && (
              <Section
                title={t("tasksCommands")}
                icon={<TerminalSquare size={11} />}
                tasks={others}
                onRun={runInTerminal}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  tasks,
  onRun,
}: {
  title: string;
  icon: React.ReactNode;
  tasks: Task[];
  onRun: (command: string) => void;
}) {
  return (
    <>
      <div className="section-label flex items-center gap-1.5">
        {icon} {title}
      </div>
      {tasks.map((task) => (
        <button
          key={`${task.source}:${task.command}`}
          className="group/task row w-full"
          onClick={() => onRun(task.command)}
          title={task.command}
        >
          <Play size={12} className={cn("shrink-0", "text-[var(--color-text-mute)] group-hover/task:text-[var(--color-accent)]")} />
          <span className="min-w-0 flex-1 truncate">{task.label}</span>
          <span className="shrink-0 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
            {task.source}
          </span>
        </button>
      ))}
    </>
  );
}
