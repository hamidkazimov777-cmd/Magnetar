import {
  Bot,
  FileCode2,
  Gauge,
  Timer,
  BrainCircuit,
  Palette,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useStore, DEFAULT_PREFS } from "../lib/store";
import { useT, LANGS } from "../lib/i18n";
import { cn } from "../lib/cn";

/** Real settings: how the agent behaves and how the editor looks. Connections
 *  and API keys stay in their own dialog (they are security-sensitive). */
export function SettingsView() {
  const t = useT();
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
  const modelStatus = useStore((s) => s.modelStatus);

  // Every model we know about, flattened, so the background task can be pinned
  // to a specific one instead of relying on the name-based auto-pick.
  const allModels = connections.flatMap((c) =>
    (models[c.id] ?? []).map((m) => ({
      connectionId: c.id,
      connectionName: c.name,
      model: m.id,
      denied: modelStatus[`${c.id}::${m.id}`] === "denied",
    })),
  );
  const pinned = prefs.memoryModel;
  const pinnedValue = pinned ? `${pinned.connectionId}::${pinned.model}` : "";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-8 pb-16 pt-10">
        <h1
          data-tauri-drag-region
          className="text-[length:var(--fs-xl)] font-semibold tracking-[-0.015em]"
        >
          {t("settingsTitle")}
        </h1>

        {/* Agent */}
        <Section icon={Bot} title={t("settingsAgent")}>
          <Toggle
            label={t("prefAutoApply")}
            hint={t("prefAutoApplyHint")}
            value={prefs.autoApplyEdits}
            onChange={(v) => setPrefs({ autoApplyEdits: v })}
          />
          <Toggle
            label={t("prefConfirmBash")}
            hint={t("prefConfirmBashHint")}
            value={prefs.confirmBash}
            onChange={(v) => setPrefs({ confirmBash: v })}
          />
          <Slider
            icon={Gauge}
            label={t("prefMaxSteps")}
            hint={t("prefMaxStepsHint")}
            value={prefs.agentMaxSteps}
            min={5}
            max={100}
            step={5}
            onChange={(v) => setPrefs({ agentMaxSteps: v })}
          />
          <Slider
            icon={Timer}
            label={t("prefBashTimeout")}
            hint={t("prefBashTimeoutHint")}
            value={prefs.bashTimeoutSecs}
            min={60}
            max={1800}
            step={60}
            suffix=" c"
            onChange={(v) => setPrefs({ bashTimeoutSecs: v })}
          />
        </Section>

        {/* Project memory */}
        <Section icon={BrainCircuit} title={t("settingsMemory")}>
          <div className="py-3">
            <div className="text-[length:var(--fs-base)]">{t("prefMemoryModel")}</div>
            <p className="mt-0.5 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
              {t("prefMemoryModelHint")}
            </p>
            <select
              className="input mt-2"
              value={pinnedValue}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  setPrefs({ memoryModel: undefined });
                  return;
                }
                const [connectionId, ...rest] = v.split("::");
                setPrefs({ memoryModel: { connectionId, model: rest.join("::") } });
              }}
            >
              <option value="">{t("prefMemoryModelAuto")}</option>
              {allModels.map((m) => (
                <option
                  key={`${m.connectionId}::${m.model}`}
                  value={`${m.connectionId}::${m.model}`}
                >
                  {m.connectionName} · {m.model}
                  {m.denied ? ` — ${t("modelDenied")}` : ""}
                </option>
              ))}
            </select>
            {allModels.length === 0 && (
              <p className="mt-1.5 text-[length:var(--fs-xs)] text-[var(--color-warning)]">
                {t("prefMemoryModelEmpty")}
              </p>
            )}
          </div>
        </Section>

        {/* Editor */}
        <Section icon={FileCode2} title={t("settingsEditor")}>
          <Slider
            label={t("prefFontSize")}
            value={prefs.editorFontSize}
            min={10}
            max={22}
            step={1}
            onChange={(v) => setPrefs({ editorFontSize: v })}
            suffix="px"
          />
          <Toggle
            label={t("prefWordWrap")}
            value={prefs.editorWordWrap}
            onChange={(v) => setPrefs({ editorWordWrap: v })}
          />
          <Toggle
            label={t("prefMinimap")}
            value={prefs.editorMinimap}
            onChange={(v) => setPrefs({ editorMinimap: v })}
          />
        </Section>

        {/* Interface */}
        <Section icon={Palette} title={t("settingsAppearance")}>
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-[length:var(--fs-base)]">{t("theme")}</span>
            <div className="flex gap-1.5">
              {(
                [
                  ["light", Sun, t("themeLight")],
                  ["dark", Moon, t("themeDark")],
                  ["system", Monitor, t("themeSystem")],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  onClick={() => setTheme(id)}
                  className="toggle-pill"
                  data-on={theme === id}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-[length:var(--fs-base)]">{t("language")}</span>
            <div className="flex gap-1.5">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  className="toggle-pill"
                  data-on={lang === l.code}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <button
          className="btn btn-ghost mt-6"
          onClick={() => setPrefs(DEFAULT_PREFS)}
        >
          {t("prefReset")}
        </button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel mt-6 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-[length:var(--fs-md)] font-semibold">
        <Icon size={15} className="text-[var(--color-text-dim)]" />
        {title}
      </h2>
      <div className="divide-y divide-[var(--color-border)]">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-[length:var(--fs-base)]">{label}</div>
        {hint && (
          <p className="mt-0.5 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
            {hint}
          </p>
        )}
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          value ? "bg-[var(--color-accent)]" : "bg-[var(--color-surface-3)]",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-[var(--color-accent-fg)] transition-[left]",
            value ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function Slider({
  icon: Icon,
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  icon?: typeof Bot;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon size={13} className="shrink-0 text-[var(--color-text-mute)]" />}
          <span className="text-[length:var(--fs-base)]">{label}</span>
        </div>
        <span className="shrink-0 font-mono text-[length:var(--fs-base)] text-[var(--color-text)]">
          {value}
          {suffix}
        </span>
      </div>
      {hint && (
        <p className="mt-0.5 text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
          {hint}
        </p>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
