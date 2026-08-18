import { useEffect, useState } from "react";
import { Plus, ListTodo, CheckCircle2, Circle, ArrowRightCircle, Trash2 } from "lucide-react";
import { db } from "../lib/db";
import { useStore } from "../lib/store";
import { Task } from "../lib/types";

const STATUSES = [
  { id: "TODO", label: "To Do", icon: Circle },
  { id: "IN_PROGRESS", label: "In Progress", icon: ArrowRightCircle },
  { id: "DONE", label: "Done", icon: CheckCircle2 },
];

export function RoadmapView() {
  const activeProjectId = useStore((s) => s.activeProjectId);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  const loadTasks = () => {
    if (activeProjectId) {
      db.listTasks(activeProjectId).then(setTasks).catch(console.error);
    } else {
      setTasks([]);
    }
  };

  useEffect(() => {
    loadTasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !activeProjectId) return;
    
    const t: Task = {
      id: crypto.randomUUID(),
      projectId: activeProjectId,
      title: newTaskTitle.trim(),
      status: "TODO",
      priority: "Medium",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    db.saveTask(t).then(() => {
      setNewTaskTitle("");
      loadTasks();
    });
  };

  const updateTaskStatus = (t: Task, newStatus: string) => {
    db.saveTask({ ...t, status: newStatus, updatedAt: Date.now() }).then(loadTasks);
  };

  const handleDelete = (id: string) => {
    db.deleteTask(id).then(loadTasks);
  };

  if (!activeProjectId) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[var(--color-text-dim)]">
        <div className="text-center">
          <ListTodo size={48} className="mx-auto mb-4 opacity-20" />
          <p>Select a project to view its Roadmap</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col p-8 overflow-y-auto">
      <h1 className="text-2xl font-semibold text-[var(--color-text)] flex items-center gap-2">
        <ListTodo size={24} /> Roadmap & Tasks
      </h1>
      <p className="mt-2 text-[var(--color-text-dim)] mb-8">
        Track progress and manage project deliverables.
      </p>

      <form onSubmit={handleCreateTask} className="flex gap-2 mb-8 max-w-2xl">
        <input
          type="text"
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          placeholder="What needs to be done?"
          className="flex-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg px-4 py-2 outline-none focus:border-[var(--color-accent)] text-[var(--color-text)]"
        />
        <button
          type="submit"
          disabled={!newTaskTitle.trim()}
          className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg font-medium hover:bg-opacity-90 disabled:opacity-50 transition flex items-center gap-2"
        >
          <Plus size={16} /> Add Task
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STATUSES.map((col) => {
          const colTasks = tasks.filter(t => t.status === col.id);
          const Icon = col.icon;
          return (
            <div key={col.id} className="flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4">
              <h2 className="font-medium flex items-center justify-between mb-4 text-[var(--color-text)]">
                <span className="flex items-center gap-2">
                  <Icon size={16} className="text-[var(--color-text-dim)]" />
                  {col.label}
                </span>
                <span className="text-xs bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full">{colTasks.length}</span>
              </h2>
              <div className="flex-1 space-y-3">
                {colTasks.length === 0 && <p className="text-sm text-[var(--color-text-dim)] text-center py-4">No tasks</p>}
                {colTasks.map((t) => (
                  <div key={t.id} className="bg-[var(--color-background)] border border-[var(--color-border)] p-3 rounded-lg group">
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm text-[var(--color-text)] leading-snug">{t.title}</p>
                      <button onClick={() => handleDelete(t.id)} className="opacity-0 group-hover:opacity-100 transition text-[var(--color-text-dim)] hover:text-red-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex gap-1 mt-3">
                      {STATUSES.filter(s => s.id !== col.id).map(s => (
                        <button
                          key={s.id}
                          onClick={() => updateTaskStatus(t, s.id)}
                          className="text-[10px] px-2 py-1 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition"
                        >
                          Move to {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
