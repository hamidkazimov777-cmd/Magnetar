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
  Upload,
  Link2,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  GitCompare,
  Download,
  type IconType,
} from "../icons";
import { useStore, type CenterView } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { api } from "../../lib/api";
import { flushHandoffToMemory } from "../../lib/memory";
import { verifyProjectFacts } from "../../lib/verify";
import { exportMemorySnapshot, importMemorySnapshot } from "../../lib/exportMemory";
import { EmptyState } from "../ui/EmptyState";
import { MemoryLog } from "./MemoryLog";
import { pickWorkspaceFolder } from "./ExplorerPanel";
import { Hint } from "../ui/Hint";
import type { FactKind, MemoryFact, Project } from "../../lib/types";
import { FACT_KINDS, newFact } from "../../lib/facts";

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
  const surfaces: { id: CenterView; icon: IconType; label: string }[] = [
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

              <DivergenceBadge projectId={active.id} />

              {/* The memory itself, so it is visible without navigating */}
              <div className="section-label">{t("memoryKnown")}</div>
              <p className="section-hint">{t("factsHint")}</p>
              {active.description && (
                <p className="px-2 pb-1 text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
                  {active.description}
                </p>
              )}
              <FactList projectId={active.id} />

              <SaveStateButton />
              <VerifyFactsButton projectId={active.id} />
              <ExportMemoryButton />
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

/** Everything Magnetar remembers, written to one file.
 *
 *  Added because diagnosing memory from screenshots is guesswork: the panel
 *  shows what fits, not the provenance, the verify spec, or why a check failed. */
function ExportMemoryButton() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="mt-1.5 px-1">
      <Hint text={t("memExportHint")}>
        <button
          className="btn btn-secondary btn-sm w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const path = await exportMemorySnapshot();
              if (path) {
                setDone(path.split("/").pop() ?? path);
                setTimeout(() => setDone(null), 4000);
              }
            } catch (e) {
              setDone(String(e).slice(0, 60));
              setTimeout(() => setDone(null), 5000);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span className="truncate">{done ?? t("memExport")}</span>
        </button>
      </Hint>

      <Hint text={t("memImportHint")}>
        <button
          className="btn btn-secondary btn-sm mt-1.5 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const plan = await importMemorySnapshot();
              if (plan) {
                // Say what was skipped as well as what landed: an import that
                // reports only its successes is one you cannot trust twice.
                setDone(
                  t("memImportDone")
                    .replace("{facts}", String(plan.facts.length))
                    .replace("{decisions}", String(plan.decisions.length))
                    .replace("{skipped}", String(plan.skipped.length)),
                );
                setTimeout(() => setDone(null), 6000);
              }
            } catch (e) {
              setDone(String(e).replace(/^Error:\s*/, "").slice(0, 80));
              setTimeout(() => setDone(null), 6000);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Upload size={13} />
          <span className="truncate">{t("memImport")}</span>
        </button>
      </Hint>

      <DatabaseHealth />
    </div>
  );
}

/** The database behind everything, and a copy of it.
 *
 *  Both are here rather than in Settings because this is where a person is
 *  when they are worried about their memory. A backup offered on a page nobody
 *  visits when something looks wrong is a backup nobody has.
 */
function DatabaseHealth() {
  const t = useT();
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (text: string, ms = 6000) => {
    setState(text.slice(0, 90));
    setTimeout(() => setState(null), ms);
  };

  return (
    <div className="mt-1.5">
      {state && (
        <p
          role="status"
          className="mb-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-1 text-[length:var(--fs-xs)] text-[var(--color-text-dim)]"
        >
          {state}
        </p>
      )}
      <div className="flex gap-1.5">
      <Hint text={t("dbCheckHint")}>
        <button
          className="btn btn-secondary btn-sm flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.dbIntegrity();
              const healthy = r.structure === "ok" && r.orphans === 0;
              say(
                healthy
                  ? t("dbCheckOk")
                      .replace("{facts}", String(r.facts))
                      .replace("{decisions}", String(r.decisions))
                      .replace("{messages}", String(r.messages))
                  : t("dbCheckBad")
                      .replace("{structure}", r.structure)
                      .replace("{orphans}", String(r.orphans)),
                healthy ? 6000 : 20000,
              );
            } catch (e) {
              say(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ShieldCheck size={13} />
          <span className="truncate">{t("dbCheck")}</span>
        </button>
      </Hint>

      <Hint text={t("dbBackupHint")}>
        <button
          className="btn btn-secondary btn-sm flex-1"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
              const dest = await api.pickSavePath(`magnetar-backup-${stamp}.sqlite`, ["sqlite"]);
              if (dest) {
                const bytes = await api.dbBackup(dest);
                say(
                  t("dbBackupDone").replace("{size}", (bytes / (1024 * 1024)).toFixed(1)),
                );
              }
            } catch (e) {
              say(String(e).replace(/^Error:\s*/, ""));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Save size={13} />
          <span className="truncate">{t("dbBackup")}</span>
        </button>
      </Hint>

      </div>
    </div>
  );
}

/** The queue has to be visible from here, or nobody will ever open it: a pile
 *  that only exists on another page is a pile that silently grows. */
function DivergenceBadge({ projectId }: { projectId: string }) {
  const t = useT();
  const setCenterView = useStore((s) => s.setCenterView);
  const open = (useStore((s) => s.divergences[projectId]) ?? []).filter(
    (d) => d.status === "open",
  );
  if (!open.length) return null;
  return (
    <button className="row mt-1" onClick={() => setCenterView("projects")}>
      <GitCompare size={14} className="shrink-0 opacity-70" />
      <span className="truncate">{t("divergencesTitle")}</span>
      <span className="badge ml-auto">{open.length}</span>
    </button>
  );
}

/** Confirming memory against the project — including the checks that cost
 *  real time, which is why this one is a button and not something that happens
 *  behind the user's back. */
function VerifyFactsButton({ projectId }: { projectId: string }) {
  const t = useT();
  const root = useStore((s) => s.workspaceRoot);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  if (!root) return null;
  return (
    <div className="mt-1.5 px-1">
      <Hint text={t("factsVerifyHint")}>
        <button
          className="btn btn-secondary btn-sm w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await verifyProjectFacts(root, projectId, { includeChecks: true });
            setBusy(false);
            setResult(`${r.verified} · ${r.refuted} · ${r.stale}`);
            setTimeout(() => setResult(null), 4000);
          }}
        >
          {busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ShieldCheck size={13} />
          )}
          {result ?? t("factsVerify")}
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

/** Project memory, fact by fact.
 *
 *  The provenance line under each fact is the point of the whole panel: a
 *  coder — human or model — has to be able to tell what was read out of the
 *  project from what somebody once claimed. Facts nobody checked say so. */
function FactList({ projectId }: { projectId: string }) {
  const t = useT();
  const facts = useStore((s) => s.facts[projectId]);
  const saveFacts = useStore((s) => s.saveFacts);
  const deleteFact = useStore((s) => s.deleteFact);
  const [draft, setDraft] = useState("");

  const KIND_LABEL: Record<FactKind, string> = {
    stack: t("factKindStack"),
    architecture: t("factKindArchitecture"),
    constraint: t("factKindConstraint"),
    state: t("factKindState"),
  };

  const add = () => {
    if (!draft.trim()) return;
    // Typed by the user, so that is exactly what it claims to be.
    saveFacts([newFact(projectId, "architecture", draft, "user")]);
    setDraft("");
  };

  return (
    <div className="px-2 pt-1">
      {!facts?.length && <p className="section-hint pb-1">{t("factsEmpty")}</p>}

      {FACT_KINDS.map((kind) => {
        const group = (facts ?? []).filter((f) => f.kind === kind);
        if (!group.length) return null;
        return (
          <div key={kind} className="pb-2">
            <div className="text-[length:var(--fs-2xs)] font-semibold uppercase tracking-[0.07em] text-[var(--color-text-mute)]">
              {KIND_LABEL[kind]}
            </div>
            {group.map((f) => (
              <FactRow key={f.id} fact={f} onDelete={() => deleteFact(projectId, f.id)} />
            ))}
          </div>
        );
      })}

      <div className="flex items-center gap-1 pt-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t("factAddPlaceholder")}
          className="input h-6 min-w-0 flex-1 text-[length:var(--fs-xs)]"
        />
        <button className="icon-btn h-6 w-6" title={t("factAdd")} onClick={add}>
          <Plus size={13} />
        </button>
      </div>
    </div>
  );
}

function FactRow({ fact, onDelete }: { fact: MemoryFact; onDelete: () => void }) {
  const t = useT();
  const origin =
    fact.origin === "extracted"
      ? `${t("factOriginExtracted")}: ${fact.originDetail ?? "?"}`
      : fact.origin === "user"
        ? t("factOriginUser")
        : fact.origin === "inferred"
          ? t("factOriginInferred")
          : t("factOriginLegacy");

  const status =
    fact.status === "verified"
      ? `${t("factStatusVerified")}${fact.checkedAt ? ` · ${new Date(fact.checkedAt).toLocaleDateString()}` : ""}`
      : fact.status === "stale"
        ? t("factStatusStale")
        : fact.status === "refuted"
          ? t("factStatusRefuted")
          : t("factStatusUnverified");

  // Colour carries the same distinction as the words, for a glance rather than
  // a read: confirmed is quiet, refuted and stale are not.
  const statusTone =
    fact.status === "verified"
      ? "text-[var(--color-success)]"
      : fact.status === "refuted" || fact.status === "stale"
        ? "text-[var(--color-danger)]"
        : "text-[var(--color-text-mute)]";

  return (
    <div className="group/fr flex items-start gap-1 py-0.5">
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--fs-sm)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
          {fact.text}
        </p>
        <p className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
          {origin} · <span className={statusTone}>{status}</span>
        </p>
      </div>
      <button
        className="icon-btn h-5 w-5 opacity-0 group-hover/fr:opacity-100"
        title={t("factDelete")}
        onClick={onDelete}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}
