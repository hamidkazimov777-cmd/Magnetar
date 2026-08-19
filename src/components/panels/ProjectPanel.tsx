import { useState } from "react";
import {
  BrainCircuit,
  FolderGit2,
  ListTodo,
  Network,
  Clock,
  Plus,
  FileText,
  Pencil,
  Trash2,
  Check,
  X,
  Save,
  Link2,
  Database,
  Loader2,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useStore, type CenterView } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { api } from "../../lib/api";
import { flushHandoffToMemory } from "../../lib/memory";
import { EmptyState } from "../ui/EmptyState";
import { MemoryLog } from "./MemoryLog";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { Hint } from "../ui/Hint";
import type { Project } from "../../lib/types";

/** The table of contents for project memory.
 *
 *  It answers what the old UI left open — what a project is, what Magnetar
 *  keeps about it, and whether any of that is actually happening: projects and
 *  their lifecycle on top, the four memory surfaces next, then the live state
 *  (chat binding, index, log) that tells you memory is being written at all. */
export function ProjectPanel() {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const setActiveProject = useStore((s) => s.setActiveProject);
  const addProject = useStore((s) => s.addProject);
  const centerView = useStore((s) => s.centerView);
  const setCenterView = useStore((s) => s.setCenterView);

  const active = projects.find((p) => p.id === activeProjectId);

  const create = () => {
    const p: Project = {
      id: crypto.randomUUID(),
      name: t("projectNew"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addProject(p);
    setCenterView("projects");
  };

  // The four memory surfaces, in the order they answer "what do you know?".
  const surfaces: { id: CenterView; icon: LucideIcon; label: string }[] = [
    { id: "projects", icon: FileText, label: t("memoryFacts") },
    { id: "roadmap", icon: ListTodo, label: t("roadmap") },
    { id: "knowledge", icon: Network, label: t("knowledgeGraph") },
    { id: "timeline", icon: Clock, label: t("timeline") },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="panel-header">
        <span className="panel-title flex-1">{t("navProject")}</span>
        <Hint text={t("hintProjectNew")}>
          <button className="icon-btn" title={t("projectNew")} onClick={create}>
            <Plus size={15} />
          </button>
        </Hint>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={BrainCircuit}
          title={t("projectsEmpty")}
          text={t("projectsEmptyHint")}
          action={{
            label: t("explorerOpenFolder"),
            onClick: () => void pickWorkspaceFolder(),
          }}
          secondaryAction={{ label: t("projectNew"), onClick: create }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {/* What a project is */}
          <div className="section-label pt-2">{t("projectsTitle")}</div>
          <p className="section-hint">{t("projectPanelWhat")}</p>
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              active={p.id === activeProjectId}
              onSelect={() => setActiveProject(p.id)}
            />
          ))}

          {active && (
            <>
              <ChatBinding projectId={active.id} projectName={active.name} />

              {/* What memory holds, named surface by surface */}
              <div className="section-label">{t("memorySections")}</div>
              <p className="section-hint">{t("memorySectionsHint")}</p>
              {surfaces.map((s) => (
                <button
                  key={s.id}
                  className="row"
                  data-active={centerView === s.id}
                  onClick={() => setCenterView(s.id)}
                >
                  <s.icon size={14} className="shrink-0 opacity-70" />
                  <span className="truncate">{s.label}</span>
                </button>
              ))}

              {/* The memory itself, so it is visible without navigating */}
              <div className="section-label">{t("memoryKnown")}</div>
              <div className="space-y-3 px-2 pt-1">
                <Fact label={t("projectStack")} value={active.techStack} />
                <Fact label={t("projectDescription")} value={active.description} />
                <Fact
                  label={t("projectDecisions")}
                  value={active.decisions}
                  emptyHint={t("memAutoAfterChat")}
                />
                <Fact
                  label={t("projectLastState")}
                  value={active.lastState}
                  emptyHint={t("memAutoOnSwitch")}
                />
              </div>

              <SaveStateButton />
              <IndexStatus />
              <MemoryLog />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A project row with rename and delete — the list is where people expect the
 *  lifecycle to live, not buried on the detail page. */
function ProjectRow({
  project,
  active,
  onSelect,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  if (editing)
    return (
      <div className="flex items-center gap-1 px-1 py-0.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              renameProject(project.id, draft);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-6 min-w-0 flex-1 rounded-[var(--r-sm)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-1.5 text-[length:var(--fs-base)] outline-none"
        />
        <button
          className="icon-btn h-6 w-6"
          onClick={() => {
            renameProject(project.id, draft);
            setEditing(false);
          }}
        >
          <Check size={13} />
        </button>
        <button className="icon-btn h-6 w-6" onClick={() => setEditing(false)}>
          <X size={13} />
        </button>
      </div>
    );

  return (
    <div className="group/pr flex items-center gap-0.5">
      <button
        className="row min-w-0 flex-1"
        data-active={active}
        onClick={onSelect}
        title={project.path || project.name}
      >
        <FolderGit2 size={14} className="shrink-0 opacity-70" />
        <span className="truncate">{project.name}</span>
      </button>
      <button
        className="icon-btn h-6 w-6 opacity-0 group-hover/pr:opacity-100"
        title={t("rename")}
        onClick={() => {
          setDraft(project.name);
          setEditing(true);
        }}
      >
        <Pencil size={12} />
      </button>
      <button
        className="icon-btn h-6 w-6 opacity-0 hover:text-[var(--color-danger)] group-hover/pr:opacity-100"
        title={t("projectDelete")}
        onClick={() => {
          if (confirm(t("projectDeleteConfirm"))) deleteProject(project.id);
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

/** Whether the current chat actually feeds this project's memory. A chat picks
 *  up its project when it is created, so an old chat can silently belong to
 *  nothing — and then no background task will ever write memory from it. */
function ChatBinding({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const t = useT();
  const session = useStore((s) => s.sessions.find((x) => x.id === s.activeSessionId));
  const projects = useStore((s) => s.projects);
  const attach = useStore((s) => s.attachSessionToProject);
  if (!session || session.projectId === projectId) return null;

  const other = session.projectId
    ? projects.find((p) => p.id === session.projectId)
    : undefined;

  return (
    <div className="mx-1 mt-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <div className="flex items-start gap-1.5 text-[length:var(--fs-xs)] leading-snug text-[var(--color-text-dim)]">
        <Link2 size={12} className="mt-0.5 shrink-0" />
        <span>
          {other ? t("chatProjectOther", { name: other.name }) : t("chatProjectNone")}
        </span>
      </div>
      <button
        className="btn btn-secondary btn-sm mt-2 w-full"
        onClick={() => attach(session.id, projectId)}
      >
        {t("chatProjectAttach", { name: projectName })}
      </button>
    </div>
  );
}

/** Writing "where we stopped" used to require switching models back and forth.
 *  This is the same call, on purpose. */
function SaveStateButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  return (
    <div className="mt-3 px-1">
      <Hint text={t("memSaveStateHint")}>
        <button
          className="btn btn-secondary btn-sm w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await flushHandoffToMemory({ manual: true });
            setBusy(false);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : done ? (
            <Check size={13} />
          ) : (
            <Save size={13} />
          )}
          {done ? t("memSaveStateDone") : t("memSaveState")}
        </button>
      </Hint>
    </div>
  );
}

/** The agent's code search depends on this index, so its state should not be
 *  a mystery. */
function IndexStatus() {
  const t = useT();
  const state = useStore((s) => s.indexState);
  const root = useStore((s) => s.workspaceRoot);
  const setIndexState = useStore((s) => s.setIndexState);
  const logMemory = useStore((s) => s.logMemory);
  if (!root) return null;

  const rebuild = async () => {
    setIndexState({ status: "building" });
    try {
      const r = await api.indexBuild(root);
      setIndexState({ status: "ready", files: r.files, at: Date.now() });
      logMemory({ kind: "index", status: "ok", detail: String(r.files) });
    } catch (e) {
      setIndexState({ status: "error", at: Date.now() });
      logMemory({ kind: "index", status: "error", detail: String(e).slice(0, 200) });
    }
  };

  const label =
    state.status === "building"
      ? t("indexBuilding")
      : state.status === "ready"
        ? t("indexReady", { files: String(state.files ?? 0) })
        : state.status === "error"
          ? t("indexError")
          : t("indexStale");

  return (
    <div className="mt-2 flex items-center gap-1.5 px-2 py-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
      {state.status === "building" ? (
        <Loader2 size={12} className="shrink-0 animate-spin" />
      ) : (
        <Database size={12} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        className="icon-btn h-5 w-5"
        title={t("indexRebuild")}
        disabled={state.status === "building"}
        onClick={() => void rebuild()}
      >
        <RefreshCw size={11} />
      </button>
    </div>
  );
}

function Fact({
  label,
  value,
  emptyHint,
}: {
  label: string;
  value?: string;
  emptyHint?: string;
}) {
  if (!value?.trim() && !emptyHint) return null;
  return (
    <div>
      <div className="text-[length:var(--fs-2xs)] font-semibold uppercase tracking-[0.07em] text-[var(--color-text-mute)]">
        {label}
      </div>
      {value?.trim() ? (
        <p className="mt-1 line-clamp-4 text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
          {value}
        </p>
      ) : (
        // An empty field should say how it gets filled, not just sit blank.
        <p className="mt-1 text-[length:var(--fs-xs)] italic leading-snug text-[var(--color-text-mute)]">
          {emptyHint}
        </p>
      )}
    </div>
  );
}
