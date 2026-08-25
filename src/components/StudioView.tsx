import { useMemo, useState } from "react";
import {
  Image as ImageIcon,
  Clapperboard,
  Music,
  Sparkles,
  Folder,
  ArrowUp,
  Loader2,
  Paperclip,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { providerForBaseUrl, type GenerationKind } from "../lib/generation";
import { buildGenerationContext } from "../lib/memory";
import { cn } from "../lib/cn";

/* ==========================================================================
   GENERATION STUDIO

   Generation is not a cramped chat track — it is its own full-screen work
   zone: modality tabs on top, the model and its results in the centre, a
   settings column on the right (2b), and the same project-context toggle the
   rest of the app has. This is 2a: the frame + a working image flow.
   ========================================================================== */

interface Result {
  src: string;
  name: string;
}

export function StudioView() {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const activeConnectionId = useStore((s) => s.activeConnectionId);
  const activeModel = useStore((s) => s.activeModel);
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

  const conn = connections.find((c) => c.id === activeConnectionId);
  const provider = conn ? providerForBaseUrl(conn.baseUrl) : undefined;
  const ready = Boolean(conn && activeModel && provider?.available);

  const tabs: { id: GenerationKind; icon: typeof ImageIcon; label: string }[] = useMemo(
    () => [
      { id: "image", icon: ImageIcon, label: t("studioImages") },
      { id: "video", icon: Clapperboard, label: t("studioVideo") },
      { id: "audio", icon: Music, label: t("studioAudio") },
    ],
    [t],
  );

  const generate = async () => {
    const text = prompt.trim();
    if (!text || !conn || !activeModel || !provider?.available) return;
    setBusy(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      for (const p of provider.params) if (p.default !== undefined) params[p.key] = p.default;
      if (provider.responseFormat) params.response_format = provider.responseFormat;

      const sess = useStore.getState().sessions.find((s) => s.id === activeSessionId);
      const brief = buildGenerationContext(sess);
      const full = brief ? `${brief}\n\n${text}` : text;

      const res = await api.generate(conn, {
        kind: provider.kind,
        model: activeModel,
        prompt: full,
        endpoint: provider.endpoint,
        params,
      });
      const next: Result[] = res.assets.map((a, i) => ({
        src: a.url ?? (a.b64 ? `data:${a.mimeType ?? "image/png"};base64,${a.b64}` : ""),
        name: `${provider.name} · ${i + 1}`,
      }));
      if (!next.length) setError(t("genEmpty"));
      // Newest first.
      setResults((r) => [...next, ...r]);
      setPrompt("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--color-bg)]">
      {/* Modality tabs + project toggle */}
      <div
        data-tauri-drag-region
        className="flex h-[var(--h-titlebar)] shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3"
      >
        <div className="segmented shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-on={modality === tab.id}
              onClick={() => setModality(tab.id)}
            >
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

      {/* Canvas: gallery when there are results, hero otherwise. */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {modality !== "image" ? (
          <Centered>
            <div className="empty-title">{t(modality === "video" ? "studioVideo" : "studioAudio")}</div>
            <p className="empty-text">{t("studioSoon")}</p>
          </Centered>
        ) : results.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3">
            {results.map((r, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
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
            <div className="empty-title mt-3">
              {ready ? activeModel : t("statusNoModel")}
            </div>
            <p className="empty-text max-w-[340px]">
              {ready ? t("studioEmptyHint") : t("studioConnect")}
            </p>
          </Centered>
        )}

        {error && (
          <div className="alert mx-4 mb-2 text-[length:var(--fs-xs)]">{error}</div>
        )}

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
