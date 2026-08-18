import { useState, useEffect } from "react";
import { Plus, FolderGit2, Save, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { cn } from "../lib/cn";
import { Project } from "../lib/types";

export function ProjectsView() {
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addProject = useStore((s) => s.addProject);
  const updateProject = useStore((s) => s.updateProject);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [formState, setFormState] = useState<Partial<Project>>({});
  const activeProject = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    if (activeProject) {
      setFormState(activeProject);
    } else {
      setFormState({});
    }
  }, [activeProject]);

  const handleCreate = () => {
    const p: Project = {
      id: crypto.randomUUID(),
      name: "New Project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addProject(p);
  };

  const handleSave = () => {
    if (activeProject && formState.id === activeProject.id) {
      updateProject({ ...activeProject, ...formState, updatedAt: Date.now() } as Project);
    }
  };

  return (
    <div className="flex h-full w-full bg-[var(--color-background)] overflow-hidden">
      {/* Left panel: List of projects */}
      <div className="w-64 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-medium text-[var(--color-text)]">Projects</h2>
          <button
            onClick={handleCreate}
            className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition"
            title="New Project"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {projects.length === 0 ? (
            <p className="p-4 text-sm text-center text-[var(--color-text-dim)]">No projects yet.</p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProject(p.id)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 group transition",
                  activeProjectId === p.id
                    ? "bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                )}
              >
                <FolderGit2 size={16} className={activeProjectId === p.id ? "text-[var(--color-accent-strong)]" : "text-[var(--color-text-dim)]"} />
                <span className="truncate flex-1">{p.name}</span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel: Project Editor */}
      <div className="flex-1 overflow-y-auto">
        {activeProject ? (
          <div className="max-w-4xl mx-auto p-8 pb-32">
            <div className="flex items-center justify-between mb-8">
              <input
                type="text"
                value={formState.name || ""}
                onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                className="text-3xl font-semibold bg-transparent border-none outline-none text-[var(--color-text)] w-full focus:ring-0 placeholder-[var(--color-text-dim)]"
                placeholder="Project Name"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-accent)] hover:text-white rounded-lg text-sm font-medium transition text-[var(--color-text)]"
                >
                  <Save size={16} />
                  Save
                </button>
                <button
                  onClick={() => {
                    if (confirm("Delete this project?")) {
                      deleteProject(activeProject.id);
                    }
                  }}
                  className="p-2 text-[var(--color-text-dim)] hover:text-red-400 hover:bg-[var(--color-surface-2)] rounded-lg transition"
                  title="Delete Project"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="mb-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-[var(--color-text)]">AI CTO Mode</h3>
                <p className="text-sm text-[var(--color-text-dim)]">Analyze codebase for tech debt and suggest roadmap tasks.</p>
              </div>
              <button 
                onClick={() => {
                  alert("To run CTO Mode, please go to the Chats tab and type: /cto");
                }}
                className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-accent)] hover:text-white transition rounded-lg text-sm font-medium text-[var(--color-text)]"
              >
                Run Audit
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-dim)] mb-1">Description</label>
                <textarea
                  value={formState.description || ""}
                  onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                  placeholder="What is this project about?"
                  className="w-full min-h-[100px] p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] text-sm resize-y"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-dim)] mb-1">Tech Stack</label>
                  <textarea
                    value={formState.techStack || ""}
                    onChange={(e) => setFormState({ ...formState, techStack: e.target.value })}
                    placeholder="e.g. React, Tauri, Rust, SQLite"
                    className="w-full min-h-[120px] p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] text-sm resize-y"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-dim)] mb-1">Coding Standards</label>
                  <textarea
                    value={formState.codingStandards || ""}
                    onChange={(e) => setFormState({ ...formState, codingStandards: e.target.value })}
                    placeholder="e.g. Use early returns, strictly type APIs"
                    className="w-full min-h-[120px] p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] text-sm resize-y"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-dim)] mb-1">Architecture Notes</label>
                <textarea
                  value={formState.architectureNotes || ""}
                  onChange={(e) => setFormState({ ...formState, architectureNotes: e.target.value })}
                  placeholder="Key architectural patterns, data flow, etc."
                  className="w-full min-h-[150px] p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] text-sm resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-dim)] mb-1">Core Decisions</label>
                <textarea
                  value={formState.decisions || ""}
                  onChange={(e) => setFormState({ ...formState, decisions: e.target.value })}
                  placeholder="Recorded decisions and trade-offs"
                  className="w-full min-h-[150px] p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl outline-none focus:border-[var(--color-accent)] text-[var(--color-text)] text-sm resize-y"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--color-text-dim)]">
            <div className="text-center">
              <FolderGit2 size={48} className="mx-auto mb-4 opacity-20" />
              <p>Select a project or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
