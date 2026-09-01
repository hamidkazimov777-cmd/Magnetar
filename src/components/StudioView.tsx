import { useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Clapperboard,
  Sparkles,
  ArrowUp,
  Loader2,
  Folder,
  X,
  Trash2,
  Download,
  Cpu,
  SlidersHorizontal,
  Minus,
  Plus,
  Pencil,
  RotateCcw,
  Paperclip,
} from "./icons";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";
import { Select } from "./ui/Select";
import {
  loadRegistry,
  saveRegistry,
  resetRegistry,
  connectionForModel,
  defaultParams,
  paramsForApi,
  newModelKey,
  type GenKind,
  type GenApi,
  type GenModel,
} from "../lib/genStudio";
import {
  refinePrompt,
  generateImage,
  generateVideo,
  type GenOutput,
} from "../lib/genRun";

/* ==========================================================================
   GENERATION STUDIO (fullscreen)

   Three zones: the app's own left sidebar, this centre (transcript + prompt bar
   + Image/Video toggle), and a right panel whose controls are rendered from the
   selected model's config. The model list is an EDITABLE registry — the curated
   presets seed it, then the user can add, edit, delete or reset models (any
   OpenAI-compatible provider they've connected). Chain: your words → (optional)
   an LLM turns them into a prompt → the model renders → result in the transcript.
   ========================================================================== */

interface Turn {
  id: string;
  userText: string;
  finalPrompt?: string;
  status: "running" | "done" | "error";
  progress?: string;
  outputs: GenOutput[];
  error?: string;
}

/** Transcript kept across centre-view switches within a session. */
let CACHED_TURNS: Turn[] = [];

const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);

interface Draft {
  key: string | null; // null = adding
  label: string;
  connId: string;
  modelId: string;
  kind: GenKind;
  api: GenApi;
}

export function StudioView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const setCenterView = useStore((s) => s.setCenterView);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const modelsCache = useStore((s) => s.models);

  const [registry, setRegistry] = useState<GenModel[]>(() => loadRegistry());
  const writeRegistry = (list: GenModel[]) => {
    setRegistry(list);
    saveRegistry(list);
  };

  const [kind, setKind] = useState<GenKind>("image");
  const modelsOfKind = useMemo(
    () => registry.filter((m) => m.kind === kind),
    [registry, kind],
  );
  const [selectedKey, setSelectedKey] = useState<string>(
    () => loadRegistry().find((m) => m.kind === "image")?.key ?? "",
  );

  const model =
    modelsOfKind.find((m) => m.key === selectedKey) ?? modelsOfKind[0];
  const conn = model ? connectionForModel(connections, model) : undefined;
  const ready = Boolean(model && conn);

  const norm = (u: string) => u.trim().replace(/\/+$/, "");
  const matchingConns = model
    ? connections.filter((c) => norm(c.baseUrl) === norm(model.baseUrl))
    : [];

  /** Bind the selected model to a specific connection/key (persisted). Fixes the
   *  case where several connections share one base URL and the first one has a
   *  bad key. */
  const setModelConnection = (connId: string) => {
    if (!model) return;
    const c = connections.find((x) => x.id === connId);
    const next = registry.map((m) =>
      m.key === model.key
        ? { ...m, connectionId: connId, baseUrl: c?.baseUrl ?? m.baseUrl }
        : m,
    );
    writeRegistry(next);
  };

  const [params, setParams] = useState<Record<string, unknown>>(() =>
    model ? defaultParams(model) : {},
  );
  // Reset params to defaults whenever the selected model changes.
  const paramsKey = model?.key ?? "";
  const [paramsFor, setParamsFor] = useState(paramsKey);
  if (paramsFor !== paramsKey) {
    setParamsFor(paramsKey);
    setParams(model ? defaultParams(model) : {});
  }

  const [prompt, setPrompt] = useState("");
  const [usePrompter, setUsePrompter] = useState(false);
  const [seesProject, setSeesProject] = useState(true);
  const [refs, setRefs] = useState<{ id: string; src: string; name: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        if (src.startsWith("data:"))
          setRefs((r) => [...r, { id: uid(), src, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  };
  const removeRef = (id: string) => setRefs((r) => r.filter((x) => x.id !== id));
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(CACHED_TURNS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const setModels = useStore((s) => s.setModels);
  const [loadingModels, setLoadingModels] = useState(false);

  /** Fetch a connection's /models into the store cache, so the model form can
   *  offer them as a dropdown instead of hand-typing an id. */
  const loadModelsForConn = async (connId: string) => {
    const c = connections.find((x) => x.id === connId);
    if (!c) return;
    setLoadingModels(true);
    try {
      const list = await api.listModels(c);
      setModels(connId, list);
    } catch {
      /* ignore — the manual id field still works */
    } finally {
      setLoadingModels(false);
    }
  };

  const writeTurns = (next: Turn[] | ((p: Turn[]) => Turn[])) =>
    setTurns((prev) => {
      const value = typeof next === "function" ? (next as (p: Turn[]) => Turn[])(prev) : next;
      CACHED_TURNS = value;
      return value;
    });

  // The LLM-prompter's own provider+model, chosen in the Studio (persisted),
  // seeded from the app's active text model but independently changeable.
  const [prompterConnId, setPrompterConnId] = useState<string>(
    () => localStorage.getItem("magnetar.studio.prompterConn") || activeConnectionId || "",
  );
  const [prompterModel, setPrompterModel] = useState<string>(
    () => localStorage.getItem("magnetar.studio.prompterModel") || activeModel || "",
  );
  const pickPrompterConn = (id: string) => {
    setPrompterConnId(id);
    localStorage.setItem("magnetar.studio.prompterConn", id);
    // Point at that connection's first cached model, if any.
    const first = modelsCache[id]?.[0]?.id ?? "";
    setPrompterModel(first);
    localStorage.setItem("magnetar.studio.prompterModel", first);
  };
  const pickPrompterModel = (m: string) => {
    setPrompterModel(m);
    localStorage.setItem("magnetar.studio.prompterModel", m);
  };
  const textConn = connections.find((c) => c.id === prompterConnId);
  const prompterModels = modelsCache[prompterConnId] ?? [];

  const switchKind = (k: GenKind) => {
    setKind(k);
    const first = registry.find((m) => m.kind === k);
    if (first) setSelectedKey(first.key);
    setDraft(null);
  };

  // ---- registry editing ----
  const startAdd = () =>
    setDraft({
      key: null,
      label: "",
      connId: connections[0]?.id ?? "",
      modelId: "",
      kind,
      api: kind === "video" ? "video_poll" : "openai_images",
    });

  const startEdit = (m: GenModel) => {
    const matchConn = connectionForModel(connections, m);
    setDraft({
      key: m.key,
      label: m.label,
      connId: matchConn?.id ?? connections[0]?.id ?? "",
      modelId: m.id,
      kind: m.kind,
      api: m.api,
    });
  };

  const saveDraft = () => {
    if (!draft) return;
    const c = connections.find((x) => x.id === draft.connId);
    if (!draft.modelId.trim() || !c) return;
    const api: GenApi = draft.kind === "video" ? "video_poll" : draft.api;
    const entry: GenModel = {
      key: draft.key ?? newModelKey(),
      id: draft.modelId.trim(),
      label: draft.label.trim() || draft.modelId.trim(),
      provider: "custom",
      baseUrl: c.baseUrl,
      connectionId: c.id,
      kind: draft.kind,
      api,
      params: paramsForApi(api),
    };
    const next = draft.key
      ? registry.map((m) => (m.key === draft.key ? entry : m))
      : [...registry, entry];
    writeRegistry(next);
    setKind(entry.kind);
    setSelectedKey(entry.key);
    setDraft(null);
  };

  const deleteModel = (m: GenModel) => {
    const next = registry.filter((x) => x.key !== m.key);
    writeRegistry(next);
    if (selectedKey === m.key) {
      setSelectedKey(next.find((x) => x.kind === kind)?.key ?? "");
    }
  };

  const resetAll = () => {
    const defs = resetRegistry();
    setRegistry(defs);
    setSelectedKey(defs.find((m) => m.kind === kind)?.key ?? "");
    setDraft(null);
  };

  const projectContext = (): string | undefined => {
    if (!seesProject || !activeProjectId) return undefined;
    const p = projects.find((x) => x.id === activeProjectId);
    if (!p) return undefined;
    return `Project: ${p.name}${p.description ? ` — ${p.description}` : ""}.`;
  };

  const run = async () => {
    const text = prompt.trim();
    if (!text || busy || !model || !conn) return;
    const id = uid();
    writeTurns((p) => [{ id, userText: text, status: "running", outputs: [] }, ...p]);
    setPrompt("");
    setBusy(true);
    const patch = (u: Partial<Turn>) =>
      writeTurns((p) => p.map((x) => (x.id === id ? { ...x, ...u } : x)));

    try {
      let finalPrompt = text;
      // With reference images the user is editing "this picture" — running the
      // prompter would rewrite that into a fresh scene and lose the reference,
      // so send the literal instruction alongside the image instead.
      const skipPrompter = refs.length > 0;
      if (usePrompter && !skipPrompter && textConn && prompterModel) {
        finalPrompt = await refinePrompt(textConn, prompterModel, text, projectContext());
        patch({ finalPrompt });
      } else {
        const ctx = projectContext();
        finalPrompt = ctx ? `${ctx}\n\n${text}` : text;
      }
      const outputs =
        model.kind === "video"
          ? await generateVideo(conn, model, finalPrompt, params, (label) =>
              patch({ progress: label }),
            )
          : await generateImage(
              conn,
              model,
              finalPrompt,
              params,
              refs.map((r) => r.src),
            );
      patch({ status: "done", outputs, progress: undefined });
    } catch (e) {
      patch({ status: "error", error: String(e), progress: undefined });
    } finally {
      setBusy(false);
    }
  };

  const removeTurn = (id: string) => writeTurns((p) => p.filter((x) => x.id !== id));

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      {/* Header */}
      <div
        data-tauri-drag-region
        className="flex h-[var(--h-titlebar)] shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3"
      >
        <button
          className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--r-md)] px-2.5 text-[length:var(--fs-xs)] font-medium text-[var(--color-text-dim)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          onClick={() => setCenterView("editor")}
          title={t("studioBack")}
        >
          <span className="text-[length:var(--fs-sm)] leading-none">‹</span>
          {t("studioBack")}
        </button>
        <div className="segmented shrink-0">
          <button data-on={kind === "image"} onClick={() => switchKind("image")}>
            <ImageIcon size={13} />
            {t("studioImage")}
          </button>
          <button data-on={kind === "video"} onClick={() => switchKind("video")}>
            <Clapperboard size={13} />
            {t("studioVideo")}
          </button>
        </div>
        <div className="flex-1" />
        {turns.length > 0 && (
          <button
            className="icon-btn h-7 w-7"
            onClick={() => writeTurns([])}
            title={t("studioClear")}
          >
            <Trash2 size={13} />
          </button>
        )}
        <span className="text-[length:var(--fs-md)] font-semibold">{t("studioTitle")}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Centre */}
        <div
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-40 m-3 grid place-items-center rounded-[var(--r-lg)] border-2 border-dashed border-[var(--color-ai)] bg-[color-mix(in_srgb,var(--color-ai)_12%,transparent)]">
              <div className="flex items-center gap-2 text-[length:var(--fs-md)] font-medium text-[var(--color-ai)]">
                <Paperclip size={18} />
                {t("studioDropRefs")}
              </div>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="grid h-14 w-14 place-items-center rounded-[var(--r-xl)] bg-[var(--color-surface-2)] text-[var(--color-ai)]">
                  <Sparkles size={26} />
                </div>
                <p className="empty-text mt-3 max-w-[360px]">
                  {ready ? t("studioEmptyHint") : t("studioNoConnection")}
                </p>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[760px] flex-col gap-4">
                {turns.map((turn) => (
                  <TurnCard key={turn.id} turn={turn} onDelete={() => removeTurn(turn.id)} t={t} />
                ))}
              </div>
            )}
          </div>

          {/* Prompt bar */}
          <div className="shrink-0 border-t border-[var(--color-border)] p-3">
            <div className="mx-auto max-w-[760px]">
              {kind === "image" && refs.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {refs.map((r) => (
                    <div
                      key={r.id}
                      className="group/ref relative h-14 w-14 overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)]"
                    >
                      <img src={r.src} alt={r.name} className="h-full w-full object-cover" />
                      <button
                        onClick={() => removeRef(r.id)}
                        className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--color-overlay)] text-white opacity-0 transition-opacity group-hover/ref:opacity-100"
                        title={t("delete")}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div className="mb-2 flex items-center gap-1.5">
                <button
                  className="toggle-pill h-7 px-2.5 text-[length:var(--fs-xs)]"
                  data-on={usePrompter}
                  data-ai={usePrompter ? "true" : undefined}
                  onClick={() => setUsePrompter((v) => !v)}
                  title={t("studioPrompterHint")}
                >
                  <Sparkles size={12} className="mr-1" />
                  {t("studioPrompter")}
                </button>
                <button
                  className="toggle-pill h-7 px-2.5 text-[length:var(--fs-xs)]"
                  data-on={seesProject}
                  onClick={() => setSeesProject((v) => !v)}
                  title={t("seesProject")}
                >
                  <Folder size={12} className="mr-1" />
                  {t("seesProject")}
                </button>
              </div>
              {usePrompter && (
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="shrink-0 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                    {t("studioVia")}
                  </span>
                  <div className="w-[150px] shrink-0">
                    <Select
                      up
                      value={prompterConnId}
                      onChange={pickPrompterConn}
                      options={connections.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder={t("studioPrompterNoModel")}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    {prompterModels.length ? (
                      <Select
                        up
                        value={prompterModel}
                        onChange={pickPrompterModel}
                        options={prompterModels.map((m) => ({ value: m.id, label: m.label ?? m.id }))}
                        placeholder={t("wfPickModel")}
                      />
                    ) : (
                      <input
                        value={prompterModel}
                        onChange={(e) => pickPrompterModel(e.target.value)}
                        placeholder={t("studioPrompterModelId")}
                        className="w-full rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 font-mono text-[length:var(--fs-sm)] outline-none placeholder:text-[var(--color-text-mute)] focus:border-[var(--color-border-strong)]"
                      />
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2">
                {kind === "image" && (
                  <button
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-md)] border border-[var(--color-border)] text-[var(--color-text-dim)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                    onClick={() => fileInputRef.current?.click()}
                    title={t("studioAttachRef")}
                  >
                    <Paperclip size={16} />
                  </button>
                )}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void run();
                    }
                  }}
                  rows={2}
                  placeholder={t("studioPromptPlaceholder")}
                  disabled={!ready || busy}
                  className="max-h-40 min-h-[40px] flex-1 resize-none rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)] focus:border-[var(--color-border-strong)]"
                />
                <button
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-[var(--r-md)] transition-colors",
                    prompt.trim() && ready && !busy
                      ? "bg-[var(--color-ai)] text-[var(--color-accent-fg)]"
                      : "bg-[var(--color-surface-3)] text-[var(--color-text-mute)]",
                  )}
                  onClick={() => void run()}
                  disabled={!prompt.trim() || !ready || busy}
                  title={t("studioGenerate")}
                >
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: model registry + dynamic settings */}
        <aside className="w-[250px] shrink-0 overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          {draft ? (
            <ModelForm
              draft={draft}
              setDraft={setDraft}
              connections={connections}
              modelsCache={modelsCache}
              onLoadModels={loadModelsForConn}
              loadingModels={loadingModels}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
              onOpenSettings={onOpenSettings}
              t={t}
            />
          ) : (
            <>
              <Section icon={Cpu} title={t("studioModel")}>
                <Select
                  value={model?.key ?? ""}
                  onChange={(v) => setSelectedKey(v)}
                  options={modelsOfKind.map((m) => ({
                    value: m.key,
                    label: connectionForModel(connections, m)
                      ? m.label
                      : `${m.label} · ${t("studioNoKey")}`,
                  }))}
                  placeholder={t("studioModel")}
                />
                <div className="mt-1.5 flex items-center gap-1">
                  <button className="icon-btn h-7 w-7" onClick={startAdd} title={t("studioAddModel")}>
                    <Plus size={13} />
                  </button>
                  <button
                    className="icon-btn h-7 w-7 disabled:opacity-40"
                    onClick={() => model && startEdit(model)}
                    disabled={!model}
                    title={t("edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-btn h-7 w-7 hover:text-[var(--color-danger)] disabled:opacity-40"
                    onClick={() => model && deleteModel(model)}
                    disabled={!model}
                    title={t("delete")}
                  >
                    <Trash2 size={13} />
                  </button>
                  <div className="flex-1" />
                  <button className="icon-btn h-7 w-7" onClick={resetAll} title={t("studioResetModels")}>
                    <RotateCcw size={13} />
                  </button>
                </div>
                {model && (
                  <div className="mt-2">
                    <div className="mb-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                      {t("studioConnKey")}
                    </div>
                    {matchingConns.length > 0 ? (
                      <Select
                        value={conn?.id ?? ""}
                        onChange={setModelConnection}
                        options={matchingConns.map((c) => ({ value: c.id, label: c.name }))}
                        placeholder={t("studioPickConn")}
                      />
                    ) : (
                      <p className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                        {t("studioNoConnection")}
                      </p>
                    )}
                    <button className="btn btn-secondary btn-sm mt-1.5 w-full" onClick={onOpenSettings}>
                      <Plus size={13} className="mr-1" />
                      {t("studioAddProvider")}
                    </button>
                  </div>
                )}
              </Section>

              {model?.params.length ? (
                model.params.map((p) => (
                  <Section key={p.key} icon={SlidersHorizontal} title={t(p.label)}>
                    {p.type === "select" ? (
                      <Select
                        value={String(params[p.key] ?? p.default ?? "")}
                        onChange={(val) => setParams((v) => ({ ...v, [p.key]: val }))}
                        options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                      />
                    ) : (
                      <Stepper
                        value={Number(params[p.key] ?? p.min ?? 1)}
                        min={p.min ?? 1}
                        max={p.max ?? 9}
                        onChange={(n) => setParams((v) => ({ ...v, [p.key]: n }))}
                      />
                    )}
                  </Section>
                ))
              ) : (
                <p className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                  {t("studioNoParams")}
                </p>
              )}

              {kind === "video" && (
                <p className="mt-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
                  {t("studioVideoCost")}
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ModelForm({
  draft,
  setDraft,
  connections,
  modelsCache,
  onLoadModels,
  loadingModels,
  onSave,
  onCancel,
  onOpenSettings,
  t,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  connections: { id: string; name: string; baseUrl: string }[];
  modelsCache: Record<string, { id: string; label?: string | null }[]>;
  onLoadModels: (connId: string) => void;
  loadingModels: boolean;
  onSave: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
  t: (k: string, v?: Record<string, string>) => string;
}) {
  const allConnModels = modelsCache[draft.connId] ?? [];
  // Only surface models that plausibly match the chosen media kind, so the
  // suggestion list stops offering text models for an image/video slot.
  const kindRe =
    draft.kind === "video"
      ? /video|kling|veo|hailuo|seedance|wan|sora|runway|luma|minimax/i
      : /image|flux|dall[- ]?e|sdxl|stable-diffusion|imagen|nano-banana|seedream|recraft|gpt-image/i;
  const filtered = allConnModels.filter((m) => kindRe.test(m.id));
  const connModels = filtered.length ? filtered : [];
  const set = (u: Partial<Draft>) => setDraft({ ...draft, ...u });
  const inputCls =
    "w-full rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[length:var(--fs-sm)] outline-none placeholder:text-[var(--color-text-mute)] focus:border-[var(--color-border-strong)]";
  return (
    <div className="space-y-2.5">
      <div className="text-[length:var(--fs-md)] font-semibold">
        {draft.key ? t("studioEditModel") : t("studioAddModel")}
      </div>

      <label className="block">
        <span className="mb-1 block text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">{t("studioFieldLabel")}</span>
        <input className={inputCls} value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="Gemini 2.5 Flash Image" />
      </label>

      <label className="block">
        <span className="mb-1 block text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">{t("studioFieldConnection")}</span>
        {connections.length > 0 && (
          <Select
            value={draft.connId}
            onChange={(v) => set({ connId: v })}
            options={connections.map((c) => ({ value: c.id, label: `${c.name} — ${c.baseUrl}` }))}
            placeholder={t("studioAddProvider")}
          />
        )}
        <button className="btn btn-secondary btn-sm mt-1.5 w-full" onClick={onOpenSettings}>
          <Plus size={13} className="mr-1" />
          {t("studioAddConnection")}
        </button>
      </label>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">{t("studioFieldModelId")}</span>
          <button
            className="icon-btn h-6 gap-1 px-1.5 text-[length:var(--fs-xs)]"
            onClick={() => onLoadModels(draft.connId)}
            disabled={!draft.connId || loadingModels}
            title={t("studioLoadModels")}
          >
            {loadingModels ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            {t("studioLoadModels")}
          </button>
        </div>
        {connModels.length > 0 && (
          <Select
            value={connModels.some((m) => m.id === draft.modelId) ? draft.modelId : ""}
            onChange={(v) => {
              const m = connModels.find((x) => x.id === v);
              set({ modelId: v, label: draft.label || m?.label || v });
            }}
            options={connModels.map((m) => ({ value: m.id, label: m.label ?? m.id }))}
            placeholder={t("studioPickModelFromList")}
          />
        )}
        <input
          className={cn(inputCls, "mt-1.5 font-mono")}
          value={draft.modelId}
          onChange={(e) => set({ modelId: e.target.value })}
          placeholder="google/gemini-2.5-flash-image"
        />
        <p className="mt-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {connModels.length > 0 ? t("studioModelIdHint") : t("studioLoadModelsHint")}
        </p>
      </div>

      <div>
        <span className="mb-1 block text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">{t("studioFieldKind")}</span>
        <div className="segmented w-full">
          <button data-on={draft.kind === "image"} onClick={() => set({ kind: "image", api: draft.api === "video_poll" ? "openai_images" : draft.api })}>
            {t("studioImage")}
          </button>
          <button data-on={draft.kind === "video"} onClick={() => set({ kind: "video", api: "video_poll" })}>
            {t("studioVideo")}
          </button>
        </div>
      </div>

      {draft.kind === "image" && (
        <div>
          <span className="mb-1 block text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">{t("studioFieldApi")}</span>
          <Select
            value={draft.api}
            onChange={(v) => set({ api: v as GenApi })}
            options={[
              { value: "openai_images", label: t("studioApiImages") },
              { value: "chat_image", label: t("studioApiChat") },
            ]}
          />
        </div>
      )}

      <div className="flex gap-1.5 pt-1">
        <button className="btn btn-primary btn-sm flex-1" onClick={onSave} disabled={!draft.modelId.trim() || !draft.connId}>
          {t("wfSave")}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}

function TurnCard({
  turn,
  onDelete,
  t,
}: {
  turn: Turn;
  onDelete: () => void;
  t: (k: string, v?: Record<string, string>) => string;
}) {
  return (
    <div className="group rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[length:var(--fs-sm)] text-[var(--color-text)]">
          {turn.userText}
        </p>
        <button
          className="icon-btn h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={onDelete}
          title={t("delete")}
        >
          <X size={12} />
        </button>
      </div>

      {turn.finalPrompt && turn.finalPrompt !== turn.userText && (
        <p className="mb-2 rounded-[var(--r-sm)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
          {turn.finalPrompt}
        </p>
      )}

      {turn.status === "running" && (
        <div className="flex items-center gap-2 py-3 text-[length:var(--fs-sm)] text-[var(--color-text-dim)]">
          <Loader2 size={14} className="animate-spin text-[var(--color-ai)]" />
          {turn.progress || t("studioWorking")}
        </div>
      )}

      {turn.status === "error" && (
        <div className="alert text-[length:var(--fs-xs)]">{turn.error}</div>
      )}

      {turn.outputs.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {turn.outputs.map((o, i) => (
            <div
              key={i}
              className="group/asset relative overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)]"
            >
              {o.kind === "video" ? (
                <video src={o.src} controls className="w-full" />
              ) : (
                <img src={o.src} alt="" className="w-full object-cover" />
              )}
              <a
                href={o.src}
                download
                target="_blank"
                rel="noreferrer"
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-[var(--r-md)] bg-[var(--color-overlay)] text-white opacity-0 transition-opacity group-hover/asset:opacity-100"
                title={t("studioDownload")}
              >
                <Download size={13} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
        <Icon size={12} />
        {title}
      </div>
      {children}
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        className="icon-btn h-6 w-6"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus size={12} />
      </button>
      <span className="min-w-6 text-center font-mono text-[length:var(--fs-sm)]">{value}</span>
      <button
        className="icon-btn h-6 w-6"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
