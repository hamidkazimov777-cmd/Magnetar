import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import {
  providerForBaseUrl,
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
}

/** Common image sizes read better as aspect ratios in the picker. */
function aspectLabel(size: string): string {
  const map: Record<string, string> = {
    "1024x1024": "1:1",
    "512x512": "1:1",
    "1792x1024": "16:9",
    "1024x1792": "9:16",
    "1024x768": "4:3",
    "768x1024": "3:4",
  };
  return map[size] ?? size;
}

export function StudioView() {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
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
  const provider = conn ? providerForBaseUrl(conn.baseUrl) : undefined;
  const ready = Boolean(conn && activeModel && provider?.available);

  // Generation connections: those pointing at an available generative provider.
  const genConns = useMemo(
    () => connections.filter((c) => providerForBaseUrl(c.baseUrl)?.available),
    [connections],
  );
  // Models to offer for the active connection: the provider's catalogue, plus
  // whatever the connection reported.
  const modelOptions = useMemo(() => {
    const fromProvider = provider?.models ?? [];
    const fromConn = (conn && models[conn.id]?.map((m) => m.id)) ?? [];
    return Array.from(new Set([...fromProvider, ...fromConn]));
  }, [provider, conn, models]);

  // Reset the parameter values to the provider's defaults whenever the provider
  // changes, so the controls never carry stale keys from another model.
  useEffect(() => {
    const next: Record<string, unknown> = {};
    for (const p of provider?.params ?? []) if (p.default !== undefined) next[p.key] = p.default;
    setParams(next);
  }, [provider]);

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

      const res = await api.generate(conn, {
        kind: provider.kind,
        model: activeModel,
        prompt: full,
        endpoint: provider.endpoint,
        params: body,
      });
      const next: Result[] = res.assets.map((a, i) => ({
        src: a.url ?? (a.b64 ? `data:${a.mimeType ?? "image/png"};base64,${a.b64}` : ""),
        name: `${provider.name} · ${i + 1}`,
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
          {modality !== "image" ? (
            <Centered>
              <div className="empty-title">
                {t(modality === "video" ? "studioVideo" : "studioAudio")}
              </div>
              <p className="empty-text">{t("studioSoon")}</p>
            </Centered>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-3">
              {results.map((r, i) => (
                <div
                  key={i}
                  className="aspect-square overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  {r.src ? (
                    <img src={r.src} alt={r.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="empty-text p-6">{t("genEmpty")}</div>
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
                disabled={!ready || busy || modality !== "image"}
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
                disabled={!prompt.trim() || !ready || busy || modality !== "image"}
                title={t("sendMessage")}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </div>

        {/* Settings column */}
        {modality === "image" && (
          <aside className="w-[210px] shrink-0 overflow-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <Section icon={Cpu} title={t("studioModel")}>
              {genConns.length > 1 && (
                <StudioSelect
                  value={conn?.id ?? ""}
                  onChange={(id) => {
                    const p = providerForBaseUrl(connections.find((c) => c.id === id)?.baseUrl ?? "");
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
                {p.type === "select" && p.key === "size" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(p.options ?? []).map((opt) => (
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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mb-1.5 w-full truncate rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[length:var(--fs-sm)] text-[var(--color-text)] outline-none"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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
