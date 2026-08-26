import { useEffect, useState } from "react";
import { Plus, ListTodo, CheckCircle2, Circle, ArrowRightCircle, Trash2 } from "./icons";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { EmptyState } from "./ui/EmptyState";
import { PageHeader } from "./ui/PageHeader";
import type { Task } from "../lib/types";

const STATUSES = [
  { id: "TODO", key: "roadmapTodo", icon: Circle },
  { id: "IN_PROGRESS", key: "roadmapInProgress", icon: ArrowRightCircle },
  { id: "DONE", key: "roadmapDone", icon: CheckCircle2 },
];

export function RoadmapView() {
  const t = useT();
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setCenterView = useStore((s) => s.setCenterView);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");

  const loadTasks = () => {
    if (!activeProjectId) {
      setTasks([]);
      return;
    }
    db.listTasks(activeProjectId).then(setTasks).catch(() => setTasks([]));
  };

  useEffect(loadTasks, [activeProjectId]);

  const createTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !activeProjectId) return;
    void db
      .saveTask({
        id: crypto.randomUUID(),
        projectId: activeProjectId,
        title: title.trim(),
        status: "TODO",
        priority: "Medium",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .then(() => {
        setTitle("");
        loadTasks();
      });
  };

  const move = (task: Task, status: string) =>
    void db.saveTask({ ...task, status, updatedAt: Date.now() }).then(loadTasks);

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={ListTodo}
        title={t("roadmapNoProject")}
        action={{ label: t("projects"), onClick: () => setCenterView("projects") }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PageHeader icon={ListTodo} title={t("roadmapTitle")} subtitle={t("roadmapSubtitle")} />

      <div className="mx-auto w-full max-w-[1100px] px-8 pb-10">
        <form onSubmit={createTask} className="mb-7 flex max-w-2xl gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("roadmapNewTask")}
            className="input h-9 flex-1"
          />
          <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
            <Plus size={15} />
            {t("roadmapAddTask")}
          </button>
        </form>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {STATUSES.map((col) => {
            const colTasks = tasks.filter((x) => x.status === col.id);
            const Icon = col.icon;
            return (
              <section key={col.id} className="panel flex flex-col p-3">
                <h2 className="mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[length:var(--fs-base)] font-semibold">
                    <Icon size={15} className="text-[var(--color-text-dim)]" />
                    {t(col.key)}
                  </span>
                  <span className="badge">{colTasks.length}</span>
                </h2>

                <div className="flex-1 space-y-2">
                  {colTasks.length === 0 && (
                    <p className="py-5 text-center text-[length:var(--fs-base)] text-[var(--color-text-mute)]">
                      {t("roadmapNoTasks")}
                    </p>
                  )}
                  {colTasks.map((task) => (
                    <article
                      key={task.id}
                      className="group rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[length:var(--fs-base)] leading-snug">
                          {task.title}
                        </p>
                        <button
                          onClick={() => void db.deleteTask(task.id).then(loadTasks)}
                          title={t("roadmapDeleteTask")}
                          className="icon-btn h-6 w-6 shrink-0 opacity-0 transition group-hover:opacity-100 hover:text-[var(--color-danger)]"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1">
                        {STATUSES.filter((s) => s.id !== col.id).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => move(task, s.id)}
                            className="btn btn-ghost btn-sm h-6 border border-[var(--color-border)] text-[length:var(--fs-xs)]"
                          >
                            {t("roadmapMoveTo", { status: t(s.key) })}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
