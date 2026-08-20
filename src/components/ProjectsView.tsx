import { useEffect, useState } from "react";
import { Save, Trash2, Check, BrainCircuit, Sparkles } from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";
import { EmptyState } from "./ui/EmptyState";
import { pickWorkspaceFolder } from "./panels/ExplorerPanel";
import type { Project } from "../lib/types";
import { FactsEditor } from "./FactsEditor";

/** The project brain editor: everything Magnetar remembers about a project and
 *  injects into the model's context instead of re-reading the codebase. */
export function ProjectsView() {
  const t = useT();
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const addProject = useStore((s) => s.addProject);
  const updateProject = useStore((s) => s.updateProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const requestPrompt = useStore((s) => s.requestPrompt);

  const [form, setForm] = useState<Partial<Project>>({});
  const [saved, setSaved] = useState(false);
  const active = projects.find((p) => p.id === activeProjectId);

  useEffect(() => {
    setForm(active ?? {});
    setSaved(false);
  }, [active]);

  const create = () => {
    addProject({
      id: crypto.randomUUID(),
      name: t("projectNew"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const save = () => {
    if (!active || form.id !== active.id) return;
    updateProject({ ...active, ...form, updatedAt: Date.now() } as Project);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  const set = (patch: Partial<Project>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="min-w-0 flex-1 overflow-y-auto">
        {!active ? (
          <EmptyState
            icon={BrainCircuit}
            title={t("projectSelect")}
            text={t("projectsEmptyHint")}
            action={{
              label: t("explorerOpenFolder"),
              onClick: () => void pickWorkspaceFolder(),
            }}
            secondaryAction={{ label: t("projectNew"), onClick: create }}
          />
        ) : (
          <div className="mx-auto max-w-[860px] px-8 pb-20 pt-10">
            <div
              data-tauri-drag-region
              className="mb-7 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                {/* Says what this page is before it says which project it is:
                    you are editing memory, not project settings. */}
                <div className="mb-1.5 flex items-center gap-1.5 text-[length:var(--fs-2xs)] font-semibold uppercase tracking-[0.07em] text-[var(--color-text-mute)]">
                  <BrainCircuit size={12} strokeWidth={2} />
                  {t("navProject")}
                </div>
                <input
                  value={form.name ?? ""}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder={t("projectName")}
                  className="w-full border-none bg-transparent text-[length:var(--fs-2xl)] font-semibold tracking-[-0.02em] outline-none placeholder:text-[var(--color-text-mute)]"
                />
                {active.path && (
                  <p className="mt-1 truncate font-mono text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                    {active.path}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button className="btn btn-primary" onClick={save}>
                  {saved ? <Check size={15} /> : <Save size={15} />}
                  {saved ? t("projectSaved") : t("projectSave")}
                </button>
                <button
                  className="icon-btn hover:text-[var(--color-danger)]"
                  title={t("projectDelete")}
                  onClick={() => {
                    if (confirm(t("projectDeleteConfirm"))) deleteProject(active.id);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Model-driven action — flagged violet, the AI-only accent. */}
            <section className="panel mb-6 flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[length:var(--fs-md)] font-semibold">
                  <Sparkles size={14} className="shrink-0 text-[var(--color-ai)]" />
                  {t("projectCto")}
                </h3>
                <p className="mt-0.5 text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
                  {t("projectCtoText")}
                </p>
              </div>
              <button
                className="btn btn-secondary shrink-0"
                title={t("projectCtoHint")}
                onClick={() => requestPrompt("/cto")}
              >
                {t("projectCtoAction")}
              </button>
            </section>

            <div className="space-y-5">
              <Area
                label={t("projectDescription")}
                hint={t("projectDescriptionHint")}
                value={form.description}
                onChange={(v) => set({ description: v })}
                rows={4}
              />
              {/* Memory itself: facts with their provenance, not prose. The
                  old textareas made a guess and a manifest read look the same. */}
              <FactsEditor projectId={active.id} />

              <Area
                label={t("projectDecisions")}
                hint={t("projectDecisionsHint")}
                value={form.decisions}
                onChange={(v) => set({ decisions: v })}
                rows={6}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Area({
  label,
  hint,
  value,
  onChange,
  rows,
}: {
  label: string;
  hint: string;
  value?: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        rows={rows}
        className={cn("input")}
      />
    </label>
  );
}
