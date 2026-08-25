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
  ChevronDown,
  Check,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import {
  providerForBaseUrl,
  providerFor,
  type GenerationKind,
} from "../lib/generation";
import { buildGenerationContext } from "../lib/memory";
import { cn } from "../lib/cn";

/* ==========================================================================
   GENERATION STUDIO

   Generation is its own full-screen work zone: modality tabs on top, the model
   and its results in the centre, a data-driven settings column on the right
   (model + the provider's own parameters), and the same project-context toggle
   the rest of the app has. Real providers (fal.ai/Replicate, video, audio) land
   in phase 3; the frame and controls are provider-agnostic.
   ========================================================================== */

interface Result {
  src: string;
  name: string;
  kind: GenerationKind;
}

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

  const conn = connections.find((c) => c.id === activeConnectionId);
  // The provider follows the modality tab, so one fal.ai key serves images and
  // video from the same connection.
  const provider = conn ? providerFor(conn.baseUrl, modality) : undefined;
  const ready = Boolean(conn && activeModel && provider?.available);

  // Generation connections: those pointing at an available generative provider.
  const genConns = useMemo(
    () => connections.filter((c) => providerForBaseUrl(c.baseUrl)?.available),
    [connections],
  );
  // Models to offer for this modality: the provider's catalogue.
  const modelOptions = useMemo(() => provider?.models ?? [], [provider]);

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
    const needFix =
      target.id !== activeConnectionId ||
      !activeModel ||
      !(p?.models.includes(activeModel) ?? false);
    if (needFix) setActive(target.id, p?.models[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genConns, conn?.id, modality]);

  const generate = async () => {
    const text = prompt.trim();
    if (!text || !conn || !activeModel || !provider?.available) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...params };
      if (provider.responseFormat) body.response_format = provider.responseFormat;

      const sess = useStore.getState().sessions.find((s) => s.id === activeSessionId);
      const brief = buildGenerationContext(sess);
      const full = brief ? `${brief}\n\n${text}` : text;

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
      // Long jobs (video/audio) go through the polling command.
      const res =
        provider.strategy === "poll"
          ? await api.generateAsync(conn, req)
          : await api.generate(conn, req);
      const next: Result[] = res.assets.map((a, i) => ({
        src: a.url ?? (a.b64 ? `data:${a.mimeType ?? "image/png"};base64,${a.b64}` : ""),
        name: `${provider.name} · ${i + 1}`,
        kind: provider.kind,
      }));
      if (!next.length) setError(t("genEmpty"));
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
        <div className="segmented shrink-0">
          {tabs.map((tab) => (
            <button key={tab.id} data-on={modality === tab.id} onClick={() => setModality(tab.id)}>
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
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
              {shown.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]",
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
            <div className="pointer-events-auto flex w-full max-w-[720px] items-end gap-2 rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2 shadow-[var(--e-2)]">
              <button className="icon-btn h-8 w-8 shrink-0" title={t("attachFile")} disabled>
                <Paperclip size={15} />
              </button>
              <textarea
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

        {/* Settings column */}
        {provider && (
          <aside className="w-[210px] shrink-0 overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <Section icon={Cpu} title={t("studioModel")}>
              {genConns.length > 1 && (
                <StudioSelect
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
              <StudioSelect
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
                  <StudioSelect
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

/** A dropdown in the app's own style — the native <select> read as a stray
 *  macOS control against the monochrome chrome. */
function StudioSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[length:var(--fs-sm)] text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)]"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? (
            <span className="text-[var(--color-text-mute)]">{placeholder ?? "—"}</span>
          )}
        </span>
        <ChevronDown size={13} className="shrink-0 text-[var(--color-text-mute)]" />
      </button>
      {open && (
        <div className="anim-in absolute right-0 top-full z-30 mt-1 max-h-64 w-max min-w-full max-w-[340px] overflow-auto rounded-[var(--r-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-[var(--e-3)]">
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
              {placeholder ?? "—"}
            </div>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[length:var(--fs-sm)] hover:bg-[var(--color-surface-2)]"
            >
              {/* Full name — fal ids like …/kling-video/v2/master must be
                  readable to tell v2.0 from v2.5. */}
              <span className="min-w-0 flex-1 break-all">{o.label}</span>
              {o.value === value && (
                <Check size={12} className="mt-0.5 shrink-0 text-[var(--color-ai)]" />
              )}
            </button>
          ))}
        </div>
      )}
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
