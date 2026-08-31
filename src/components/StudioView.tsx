import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Clapperboard,
  Music,
  Sparkles,
  Folder,
  ArrowUp,
  Loader2,
  Paperclip,
  Cpu,
  SlidersHorizontal,
  Minus,
  Plus,
  X,
  Trash2,
} from "./icons";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { db } from "../lib/db";
import {
  providerForBaseUrl,
  providerFor,
  type GenerationKind,
} from "../lib/generation";
import { buildGenerationContext } from "../lib/memory";
import { cn } from "../lib/cn";
import { Select } from "./ui/Select";
import { TrackSwitcher } from "./TrackSwitcher";

/* ==========================================================================
   GENERATION STUDIO

   Generation is its own full-screen work zone: modality tabs on top, the model
   and its results in the centre, a data-driven settings column on the right
   (model + the provider's own parameters), and the same project-context toggle
   the rest of the app has. Real providers (fal.ai/Replicate, video, audio) land
   in phase 3; the frame and controls are provider-agnostic.
   ========================================================================== */

interface Result {
  id: string;
  src: string;
  name: string;
  kind: GenerationKind;
}

/** A reference image attached to the prompt. It is addressed as `@imageN` by its
 *  position and passed to image-input providers as a data-URI. */
interface Ref {
  id: string;
  name: string;
  mime: string;
  data: string; // base64
}

function imageMime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

const refDataUrl = (r: Ref) => `data:${r.mime};base64,${r.data}`;

/** Sizes read better as aspect ratios in the picker — both pixel sizes (OpenAI,
 *  Together) and fal.ai's named sizes. */
function aspectLabel(size: string): string {
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "512x512": "1:1",
    "1792x1024": "16:9",
    "1024x1792": "9:16",
    "1024x768": "4:3",
    "768x1024": "3:4",
    square_hd: "1:1",
    square: "1:1",
    landscape_16_9: "16:9",
    portrait_16_9: "9:16",
    landscape_4_3: "4:3",
    portrait_4_3: "3:4",
  };
  return map[size] ?? size;
}

/** Keep one option per aspect-ratio label (drop 512² when 1024² already covers
 *  1:1), preserving order. */
function dedupeByLabel(options: string[]): string[] {
  const seen = new Set<string>();
  return options.filter((o) => {
    const l = aspectLabel(o);
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

export function StudioView() {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
  const setActive = useStore((s) => s.setActive);
  const seesProject = useStore(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.seesProject ?? true,
  );
  const toggleProjectContext = useStore((s) => s.toggleProjectContext);
  const activeSessionId = useStore((s) => s.activeSessionId);

  const [modality, setModality] = useState<GenerationKind>("image");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [refs, setRefs] = useState<Ref[]>([]);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const pendingStudioPrompt = useStore((s) => s.pendingStudioPrompt);
  const consumeStudioPrompt = useStore((s) => s.consumeStudioPrompt);

  useEffect(() => {
    if (!pendingStudioPrompt) return;
    const injected = consumeStudioPrompt();
    if (!injected) return;
    setPrompt(injected);
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [pendingStudioPrompt, consumeStudioPrompt]);

  // Load the persisted gallery once — results survive leaving the studio.
  useEffect(() => {
    let alive = true;
    db.listGenerations()
      .then((rows) => {
        if (!alive) return;
        setResults(
          rows.map((r) => ({
            id: r.id,
            src: r.src,
            name: r.name,
            kind: r.kind as GenerationKind,
          })),
        );
      })
      .catch(() => {
        /* first run / no backend — the gallery is simply empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  const conn = connections.find((c) => c.id === activeConnectionId);
  // The provider follows the modality tab, so one fal.ai key serves images and
  // video from the same connection.
  const provider = conn ? providerFor(conn.baseUrl, modality) : undefined;
  const ready = Boolean(conn && activeModel && provider?.available);

  // Generation connections: those pointing at an available generative provider.
  const genConns = useMemo(
    () => connections.filter((c) => c.kind === "generative" && providerForBaseUrl(c.baseUrl)?.available),
    [connections],
  );
  // Models to offer for this modality: the provider's catalogue.
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  
  useEffect(() => {
    if (provider?.strategy === "chat-proxy" && conn) {
      api.listModels(conn).then(list => setDynamicModels(list.map(m => m.id))).catch(() => {});
    } else {
      setDynamicModels([]);
    }
  }, [provider?.strategy, conn]);

  const modelOptions = useMemo(() => 
    provider?.strategy === "chat-proxy" && dynamicModels.length > 0 
      ? dynamicModels 
      : (provider?.models ?? []), 
  [provider, dynamicModels]);

  // Reset the parameter values to the provider's defaults whenever the provider
  // changes, so the controls never carry stale keys from another model.
  useEffect(() => {
    const next: Record<string, unknown> = {};
    for (const p of provider?.params ?? []) if (p.default !== undefined) next[p.key] = p.default;
    setParams(next);
  }, [provider]);

  // Keep the studio pointed at a generative connection with a valid model for
  // the current modality. This heals two cases: on restart the active
  // connection is often a text one (models looked "gone"), and switching to
  // Video must not leave an image model selected.
  useEffect(() => {
    if (!genConns.length) return;
    const target =
      conn && providerFor(conn.baseUrl, modality)
        ? conn
        : (genConns.find((x) => providerFor(x.baseUrl, modality)) ?? genConns[0]);
    const p = providerFor(target.baseUrl, modality);
    
    // For chat-proxy, we might not have fetched dynamicModels yet, or they might be huge.
    // If we have dynamicModels, we must ensure activeModel is in it.
    // If not fetched yet (length 0), we temporarily accept activeModel.
    const isValidModel = p?.strategy === "chat-proxy" 
      ? (dynamicModels.length === 0 ? Boolean(activeModel) : dynamicModels.includes(activeModel ?? ""))
      : (p?.models.includes(activeModel ?? "") ?? false);

    const needFix =
      target.id !== activeConnectionId ||
      !activeModel ||
      !isValidModel;
      
    if (needFix) {
      const fallback = p?.strategy === "chat-proxy" && dynamicModels.length > 0
        ? dynamicModels[0]
        : (p?.models[0] ?? "");
      setActive(target.id, fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genConns, conn?.id, modality, dynamicModels]);

  // Reference images only make sense for providers that accept image input.
  const imageInput = provider?.imageInput;

  const handleAttach = async () => {
    try {
      const selected = await api.pickAttachments([
        "png", "jpg", "jpeg", "webp", "gif",
      ]);
      if (!selected.length) return;
      const next: Ref[] = [];
      for (const file of selected) {
        next.push({
          id: crypto.randomUUID(),
          name: file.split(/[/\\]/).pop() || file,
          mime: imageMime(file),
          data: await api.readFileBase64(file),
        });
      }
      if (next.length) setRefs((r) => [...r, ...next]);
    } catch {
      /* the user cancelled the dialog */
    }
  };

  const removeRef = (id: string) => setRefs((r) => r.filter((x) => x.id !== id));

  const deleteResult = (id: string) => {
    setResults((r) => r.filter((x) => x.id !== id));
    void db.deleteGeneration(id).catch(() => {});
  };

  const clearHistory = () => {
    setResults([]);
    void db.clearGenerations().catch(() => {});
  };

  /** Insert an `@imageN` handle into the prompt at the caret. */
  const insertHandle = (idx: number) => {
    const el = promptRef.current;
    const token = `@image${idx + 1}`;
    const caret = el?.selectionStart ?? prompt.length;
    const next =
      prompt.slice(0, caret) +
      (caret > 0 && !/\s$/.test(prompt.slice(0, caret)) ? " " : "") +
      token +
      " " +
      prompt.slice(caret);
    setPrompt(next);
    requestAnimationFrame(() => el?.focus());
  };

  const generate = async () => {
    const text = prompt.trim();
    if (!text || !conn || !activeModel || !provider?.available) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...params };
      if (provider.responseFormat) body.response_format = provider.responseFormat;

      // Reference images: pick the ones cited as @imageN (or all attached, if
      // none are cited), pass them under the provider's image-input key, and
      // strip the handles from the text the model actually reads.
      let promptText = text;
      if (imageInput && refs.length) {
        const cited = new Set<number>();
        for (const m of text.matchAll(/@image(\d+)/gi)) {
          const i = Number(m[1]) - 1;
          if (i >= 0 && i < refs.length) cited.add(i);
        }
        const chosen = cited.size ? [...cited].sort((a, b) => a - b).map((i) => refs[i]) : refs;
        promptText = text.replace(/@image\d+/gi, "").replace(/\s{2,}/g, " ").trim();
        const urls = chosen.map(refDataUrl);
        body[imageInput.key] = imageInput.multiple ? urls : urls[0];
      }

      const sess = useStore.getState().sessions.find((s) => s.id === activeSessionId);
      const brief = buildGenerationContext(sess);
      const full = brief ? `${brief}\n\n${promptText}` : promptText;

      const req = {
        kind: provider.kind,
        model: activeModel,
        prompt: full,
        // fal.ai puts the model in the URL path; others use a fixed endpoint.
        endpoint: provider.modelInPath ? activeModel : provider.endpoint,
        params: body,
        authScheme: provider.authScheme,
        resultPath: provider.resultPath,
        modelInBody: provider.modelInPath ? false : undefined,
      };
      // Route by provider shape: Replicate's prediction API, fal's async queue
      // (video/audio), Chat proxy (OpenRouter), or the plain synchronous call.
      const res =
        provider.strategy === "replicate"
          ? await api.generateReplicate(conn, req)
          : provider.strategy === "poll"
            ? await api.generateAsync(conn, req)
            : provider.strategy === "chat-proxy"
              ? await api.generateChatProxy(conn, req)
              : await api.generate(conn, req);
      const now = Date.now();
      const next: Result[] = res.assets.map((a, i) => ({
        id: crypto.randomUUID(),
        src: a.url ?? (a.b64 ? `data:${a.mimeType ?? "image/png"};base64,${a.b64}` : ""),
        name: `${provider.name} · ${i + 1}`,
        kind: provider.kind,
      }));
      if (!next.length) setError(t("genEmpty"));
      // Persist to the gallery history so it survives leaving the studio.
      for (let i = 0; i < next.length; i++) {
        void db
          .saveGeneration({
            id: next[i].id,
            kind: next[i].kind,
            src: next[i].src,
            name: next[i].name,
            prompt: promptText,
            model: activeModel,
            createdAt: now + i,
          })
          .catch(() => {});
      }
      setResults((r) => [...next, ...r]);
      setPrompt("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: GenerationKind; icon: typeof ImageIcon; label: string }[] = [
    { id: "image", icon: ImageIcon, label: t("studioImages") },
    { id: "video", icon: Clapperboard, label: t("studioVideo") },
    { id: "audio", icon: Music, label: t("studioAudio") },
  ];

  const shown = results.filter((r) => r.kind === modality);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      {/* Modality tabs + project toggle */}
      <div
        data-tauri-drag-region
        className="flex h-[var(--h-titlebar)] shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3"
      >
        <TrackSwitcher />
        <div className="flex-1" />
        <div className="segmented shrink-0">
          {tabs.map((tab) => (
            <button key={tab.id} data-on={modality === tab.id} onClick={() => setModality(tab.id)}>
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {results.length > 0 && (
          <button
            className="icon-btn h-7 w-7 shrink-0"
            onClick={clearHistory}
            title={t("studioClearHistory")}
          >
            <Trash2 size={13} />
          </button>
        )}
        <button
          className="toggle-pill shrink-0"
          data-on={seesProject}
          onClick={toggleProjectContext}
          title={seesProject ? t("seesProject") : t("hidesProject")}
        >
          <Folder size={13} />
          {t("seesProject")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative min-w-0 flex-1 overflow-auto">
          {!provider ? (
            <Centered>
              <div className="empty-title">{tabs.find((x) => x.id === modality)?.label}</div>
              <p className="empty-text">
                {genConns.length ? t("studioSoon") : t("studioConnect")}
              </p>
            </Centered>
          ) : shown.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
              {shown.map((r) => (
                <div
                  key={r.id}
                  className={cn(
                    "group relative overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]",
                    r.kind === "image" && "aspect-square",
                  )}
                >
                  {r.kind === "video" ? (
                    <video src={r.src} controls className="h-full w-full" />
                  ) : r.kind === "audio" ? (
                    <audio src={r.src} controls className="w-full p-3" />
                  ) : (
                    <img src={r.src} alt={r.name} className="h-full w-full object-cover" />
                  )}
                  <button
                    onClick={() => deleteResult(r.id)}
                    title={t("delete")}
                    className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-[var(--r-md)] bg-[var(--color-overlay)] text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Centered>
              <div className="grid h-14 w-14 place-items-center rounded-[var(--r-xl)] bg-[var(--color-surface-2)] text-[var(--color-ai)]">
                <Sparkles size={26} />
              </div>
              <div className="empty-title mt-3">{ready ? activeModel : t("statusNoModel")}</div>
              <p className="empty-text max-w-[340px]">
                {ready ? t("studioEmptyHint") : t("studioConnect")}
              </p>
            </Centered>
          )}

          {error && <div className="alert mx-4 mb-2 text-[length:var(--fs-xs)]">{error}</div>}

          {/* Prompt bar */}
          <div className="pointer-events-none sticky bottom-0 flex justify-center px-4 pb-4">
            <div className="pointer-events-auto flex w-full max-w-[720px] flex-col gap-2 rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2 shadow-[var(--e-2)]">
              {imageInput && refs.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {refs.map((r, i) => (
                    <button
                      key={r.id}
                      onClick={() => insertHandle(i)}
                      title={t("studioInsertRef")}
                      className="group relative flex items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] py-0.5 pl-0.5 pr-1.5 text-[length:var(--fs-xs)] hover:border-[var(--color-border-strong)]"
                    >
                      <img
                        src={refDataUrl(r)}
                        alt={r.name}
                        className="h-6 w-6 rounded-[var(--r-sm)] object-cover"
                      />
                      <span className="font-mono text-[var(--color-text-dim)]">@image{i + 1}</span>
                      <span
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRef(r.id);
                        }}
                        className="grid h-4 w-4 place-items-center rounded-full text-[var(--color-text-mute)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text)]"
                      >
                        <X size={11} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
              <button
                className="icon-btn h-8 w-8 shrink-0"
                title={imageInput ? t("attachFile") : t("studioNoRefs")}
                onClick={() => void handleAttach()}
                disabled={!imageInput || !ready || busy}
              >
                <Paperclip size={15} />
              </button>
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void generate();
                  }
                }}
                rows={1}
                placeholder={t("studioPromptPlaceholder")}
                disabled={!ready || busy}
                className="max-h-32 min-h-[32px] flex-1 resize-none bg-transparent py-1.5 text-[length:var(--fs-base)] outline-none placeholder:text-[var(--color-text-mute)]"
              />
              <button
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-md)] transition-colors",
                  prompt.trim() && ready && !busy
                    ? "bg-[var(--color-ai)] text-[var(--color-accent-fg)]"
                    : "bg-[var(--color-surface-3)] text-[var(--color-text-mute)]",
                )}
                onClick={() => void generate()}
                disabled={!prompt.trim() || !ready || busy}
                title={t("sendMessage")}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
              </div>
            </div>
          </div>
        </div>

        {/* Settings column */}
        {provider && (
          <aside className="w-[210px] shrink-0 overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <Section icon={Cpu} title={t("studioModel")}>
              {genConns.length > 1 && (
                <Select
                  className="mb-1.5"
                  value={conn?.id ?? ""}
                  onChange={(id) => {
                    const p = providerFor(
                      connections.find((c) => c.id === id)?.baseUrl ?? "",
                      modality,
                    );
                    setActive(id, p?.models[0] ?? "");
                  }}
                  options={genConns.map((c) => ({ value: c.id, label: c.name }))}
                />
              )}
              <Select
                value={activeModel ?? ""}
                onChange={(m) => conn && setActive(conn.id, m)}
                options={modelOptions.map((m) => ({ value: m, label: m }))}
                placeholder={t("statusNoModel")}
              />
            </Section>

            {(provider?.params ?? []).map((p) => (
              <Section key={p.key} icon={SlidersHorizontal} title={t(p.label)}>
                {p.type === "select" &&
                ["size", "image_size", "aspect_ratio"].includes(p.key) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {/* One chip per aspect ratio — several raw sizes can share a
                        ratio (1024² and 512² are both 1:1). */}
                    {dedupeByLabel(p.options ?? []).map((opt) => (
                      <button
                        key={opt}
                        className="toggle-pill h-7 px-2.5 text-[length:var(--fs-xs)]"
                        data-on={params[p.key] === opt}
                        onClick={() => setParams((v) => ({ ...v, [p.key]: opt }))}
                        title={opt}
                      >
                        {aspectLabel(opt)}
                      </button>
                    ))}
                  </div>
                ) : p.type === "select" ? (
                  <Select
                    value={String(params[p.key] ?? "")}
                    onChange={(val) => setParams((v) => ({ ...v, [p.key]: val }))}
                    options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
                  />
                ) : p.type === "number" ? (
                  <Stepper
                    value={Number(params[p.key] ?? p.min ?? 1)}
                    min={p.min ?? 1}
                    max={p.max ?? 9}
                    onChange={(n) => setParams((v) => ({ ...v, [p.key]: n }))}
                  />
                ) : null}
              </Section>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      {children}
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
