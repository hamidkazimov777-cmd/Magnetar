import { db } from "../db";
import { reportPromise } from "../errors";
import type { Project } from "../types";
import { now, persistMeta } from "./shared";
import type { Slice } from "./state";

/* ==========================================================================
   PROJECTS

   A project is the thing memory, decisions and divergences hang off. Selecting
   one re-points the live conversation at it unless that conversation is
   already somebody else's work — without that, every background memory write
   goes to the project the chat happened to be born with, which is usually none.
   ========================================================================== */

export interface ProjectsSlice {
  projects: Project[];
  activeProjectId?: string;

  loadProjects: () => Promise<void>;
  setActiveProject: (id: string | undefined) => void;
  addProject: (p: Project) => void;
  updateProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
}

export const createProjectsSlice: Slice<ProjectsSlice> = (set, get) => ({
  projects: [],

  loadProjects: async () => {
    const projects = await db.listProjects();
    set({ projects });
  },

  // Selecting a project also re-points the current chat at it, as long as
  // that chat is not already someone else's work. Without this the chat
  // keeps whatever project it was born with (often none), and every
  // memory-writing background task silently skips it.
  setActiveProject: (id) =>
    set((s) => {
      if (!id) return { activeProjectId: undefined };
      const cur = s.sessions.find((x) => x.id === s.activeSessionId);
      const adoptable = cur && (!cur.projectId || cur.messages.length === 0);
      if (!adoptable) return { activeProjectId: id };
      const sessions = s.sessions.map((x) =>
        x.id === cur.id ? { ...x, projectId: id, updatedAt: now() } : x,
      );
      persistMeta(sessions.find((x) => x.id === cur.id)!);
      return { activeProjectId: id, sessions };
    }),

  addProject: (p) => {
    void reportPromise(db.saveProject(p), "db:save_project");
    set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id }));
  },

  renameProject: (id, name) => {
    const p = get().projects.find((x) => x.id === id);
    if (!p || !name.trim()) return;
    const next = { ...p, name: name.trim(), updatedAt: now() };
    void reportPromise(db.saveProject(next), "db:rename_project");
    set((s) => ({ projects: s.projects.map((x) => (x.id === id ? next : x)) }));
  },

  updateProject: (p) => {
    void reportPromise(db.saveProject(p), "db:update_project");
    set((s) => ({ projects: s.projects.map((x) => (x.id === p.id ? p : x)) }));
  },

  deleteProject: (id) => {
    void reportPromise(db.deleteProject(id), "db:delete_project");
    set((s) => {
      const projects = s.projects.filter((x) => x.id !== id);
      return {
        projects,
        activeProjectId: s.activeProjectId === id ? undefined : s.activeProjectId,
      };
    });
  },
});
