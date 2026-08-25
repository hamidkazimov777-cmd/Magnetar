import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Image as ImageIcon,
  Video,
  Music,
  Mic,
  Check,
  Loader2,
  Download,
  KeyRound,
  Plus,
} from "lucide-react";
import { api } from "../lib/api";
import {
  GEN_CATEGORIES,
  GEN_PROVIDERS,
  type GenCategory,
  type GenProvider,
  type GeneratedImage,
} from "../lib/generative";
import { useT } from "../lib/i18n";
import { LogoMark } from "./Logo";
import { cn } from "../lib/cn";

const CATEGORY_ICON: Record<GenCategory, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  voice: Mic,
};

/** Heuristic for "is this model an image model?" when a provider's /models
 *  endpoint returns a long list that includes chat models too. */
const IMAGE_MODEL_RE =
  /image|dall-e|flux|stable|sd|diffus|pixart|playground|gpt-image/i;

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function GenerationView() {
  const t = useT();
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkState, setCheckState] = useState<"idle" | "ok" | "fail">("idle");

  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string>();

  // Which providers already have a saved key (checked once on mount).
  useEffect(() => {
    let alive = true;
    const ids = GEN_PROVIDERS.filter((p) => p.available).map((p) => p.id);
    void Promise.all(ids.map(async (id) => [id, await api.hasApiKey(id)] as const))
      .then((rows) => {
        if (!alive) return;
        setConnected(Object.fromEntries(rows));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const selected = GEN_PROVIDERS.find((p) => p.id === selectedId);
  const selectedConnected = selected ? Boolean(connected[selected.id]) : false;

  const grouped = useMemo(() => {
    const map = new Map<GenCategory, GenProvider[]>();
    for (const cat of GEN_CATEGORIES) map.set(cat.id, []);
    for (const p of GEN_PROVIDERS) map.get(p.category)?.push(p);
    return GEN_CATEGORIES.map((c) => ({ cat: c.id, providers: map.get(c.id)! }));
  }, []);

  const select = (p: GenProvider) => {
    setSelectedId(p.id);
    setCheckState("idle");
    setError(undefined);
    setResults([]);
    setModel(p.models?.[0] ?? "");
    setSize(p.sizes?.[0] ?? "");
    setCount(1);
    setPrompt("");
  };

  const check = async (p: GenProvider) => {
    if (!key.trim() || !p.baseUrl) return;
    setChecking(true);
    setCheckState("idle");
    setError(undefined);
    try {
      // Save first: listModels reads the key back out of the secret store.
      await api.saveApiKey(p.id, key.trim());
      const models = await api.listModels({
        id: p.id,
        name: p.name,
        kind: "openai_compat",
        baseUrl: p.baseUrl,
      });
      const ids = models.map((m) => m.id);
      const imageIds = ids.filter((m) => IMAGE_MODEL_RE.test(m));
      const chosen = imageIds.length ? imageIds : p.models ?? [];
      if (chosen.length) setModel(chosen[0]);
      setConnected((c) => ({ ...c, [p.id]: true }));
      setCheckState("ok");
    } catch (e) {
      setCheckState("fail");
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const generate = async () => {
    if (!selected || !selected.baseUrl || !model || !prompt.trim()) return;
    setGenerating(true);
    setError(undefined);
    setResults([]);
    try {
      const imgs = await api.generateImage(
        selected,
        model,
        prompt.trim(),
        count,
        size || selected.sizes?.[0] || "1024x1024",
      );
      setResults(imgs);
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const srcOf = (img: GeneratedImage) =>
    img.b64 ? `data:image/png;base64,${img.b64}` : img.url ?? "";

  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-8 pb-12 pt-10">
        <div data-tauri-drag-region className="mb-7 flex items-center gap-3">
          <LogoMark size={32} />
          <div className="min-w-0">
            <h1 className="text-[length:var(--fs-xl)] font-semibold">
              {t("genTitle")}
            </h1>
            <p className="mt-1 text-[length:var(--fs-md)] text-[var(--color-text-dim)]">
              {t("genIntro")}
            </p>
          </div>
        </div>

        {grouped.map(({ cat, providers }) => {
          const Icon = CATEGORY_ICON[cat];
          return (
            <div key={cat} className="mb-8">
              <h2 className="section-label flex items-center gap-1.5 px-0">
                <Icon size={13} className="opacity-70" />
                {t(`genCat${cap(cat)}`)}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    p={p}
                    connected={Boolean(connected[p.id])}
                    selected={p.id === selectedId}
                    onSelect={() => select(p)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <p className="mt-1 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
          {t("genSoonHint")}
        </p>

        {selected && selected.available && (
          <div className="panel mt-6 space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="text-[length:var(--fs-md)] font-semibold">
                {selected.name}
              </div>
              {selectedConnected ? (
                <span className="flex items-center gap-1.5 text-[length:var(--fs-xs)] text-[var(--color-success)]">
                  <Check size={13} /> {t("genConnected")}
                </span>
              ) : (
                <span className="text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
                  {t("genConnect")}
                </span>
              )}
            </div>

            {!selectedConnected ? (
              <ConnectForm
                baseUrl={selected.baseUrl ?? ""}
                value={key}
                onChange={setKey}
                checking={checking}
                checkState={checkState}
                onCheck={() => void check(selected)}
              />
            ) : (
              <GenerateForm
                model={model}
                onModel={setModel}
                models={selected.models ?? []}
                prompt={prompt}
                onPrompt={setPrompt}
                size={size}
                onSize={setSize}
                sizes={selected.sizes ?? []}
                count={count}
                onCount={setCount}
                generating={generating}
                onGenerate={() => void generate()}
              />
            )}

            {error && (
              <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-danger)]">
                {t("genError")}: {error}
              </p>
            )}

            {results.length > 0 && (
              <div>
                <div className="section-label px-0">{t("genResult")}</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {results.map((img, i) => {
                    const src = srcOf(img);
                    return (
                      <div
                        key={i}
                        className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]"
                      >
                        {src ? (
                          <img
                            src={src}
                            alt={`${t("genResult")} ${i + 1}`}
                            className="h-auto w-full object-contain"
                            style={{ maxHeight: 360 }}
                          />
                        ) : (
                          <div className="grid h-40 place-items-center text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                            {t("genResult")}
                          </div>
                        )}
                        {img.b64 && (
                          <a
                            href={src}
                            download={`generated-${i + 1}.png`}
                            className="btn btn-secondary m-2 inline-flex"
                          >
                            <Download size={14} /> {t("genDownload")}
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  p,
  connected,
  selected,
  onSelect,
}: {
  p: GenProvider;
  connected: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const Icon = CATEGORY_ICON[p.category];
  return (
    <button
      onClick={onSelect}
      data-selected={selected}
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-4 text-left transition-colors",
        "hover:border-[var(--color-border-strong)]",
        selected && "border-[var(--color-accent)]",
        !p.available && "opacity-70",
      )}
    >
      <span
        className="grid h-9 w-9 place-items-center rounded-[var(--r-md)]"
        style={{ background: `${p.color}22`, color: p.color }}
      >
        <Icon size={18} />
      </span>
      <span className="w-full truncate text-center text-[length:var(--fs-base)]">
        {p.name}
      </span>
      {p.available ? (
        connected ? (
          <span className="flex items-center gap-1 text-[length:var(--fs-2xs)] font-medium text-[var(--color-success)]">
            <Check size={11} /> {t("genConnected")}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[length:var(--fs-2xs)] text-[var(--color-text-dim)]">
            <Plus size={11} /> {t("genConnect")}
          </span>
        )
      ) : (
        <span className="text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
          {t("genSoon")}
        </span>
      )}
    </button>
  );
}

function ConnectForm({
  baseUrl,
  value,
  onChange,
  checking,
  checkState,
  onCheck,
}: {
  baseUrl: string;
  value: string;
  onChange: (v: string) => void;
  checking: boolean;
  checkState: "idle" | "ok" | "fail";
  onCheck: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div>
        <div className="section-label px-0">{t("genBaseUrl")}</div>
        <div className="input flex items-center gap-2 font-mono text-[length:var(--fs-xs)] opacity-80">
          <KeyRound size={13} className="shrink-0" />
          <span className="truncate">{baseUrl}</span>
        </div>
      </div>
      <div>
        <div className="section-label px-0">{t("genApiKey")}</div>
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-…"
          className="input font-mono"
        />
        <p className="mt-1 text-[length:var(--fs-2xs)] text-[var(--color-text-mute)]">
          {t("genConnectHint")}
        </p>
      </div>
      <button
        onClick={onCheck}
        disabled={checking || !value.trim()}
        className="btn btn-primary"
      >
        {checking ? (
          <Loader2 size={15} className="animate-spin" />
        ) : checkState === "ok" ? (
          <Check size={15} />
        ) : (
          <Sparkles size={15} />
        )}
        {checking
          ? t("genChecking")
          : checkState === "ok"
            ? t("genCheckOk")
            : t("genCheck")}
      </button>
    </div>
  );
}

function GenerateForm({
  model,
  onModel,
  models,
  prompt,
  onPrompt,
  size,
  onSize,
  sizes,
  count,
  onCount,
  generating,
  onGenerate,
}: {
  model: string;
  onModel: (v: string) => void;
  models: string[];
  prompt: string;
  onPrompt: (v: string) => void;
  size: string;
  onSize: (v: string) => void;
  sizes: string[];
  count: number;
  onCount: (v: number) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="section-label px-0">{t("genModel")}</div>
          <select
            value={model}
            onChange={(e) => onModel(e.target.value)}
            className="input w-full"
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="section-label px-0">{t("genSize")}</div>
          <select
            value={size}
            onChange={(e) => onSize(e.target.value)}
            className="input w-full"
          >
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="section-label px-0">{t("genCount")}</div>
          <select
            value={count}
            onChange={(e) => onCount(Number(e.target.value))}
            className="input w-full"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="section-label px-0">{t("genPrompt")}</div>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={3}
          placeholder={t("genPromptPlaceholder")}
          className="input"
        />
      </div>
      <button
        onClick={onGenerate}
        disabled={generating || !prompt.trim() || !model}
        className="btn btn-primary"
      >
        {generating ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Sparkles size={15} />
        )}
        {generating ? t("genGenerating") : t("genGenerate")}
      </button>
    </div>
  );
}
