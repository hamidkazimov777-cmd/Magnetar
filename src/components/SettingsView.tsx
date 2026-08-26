import { useState } from "react";
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
  Save,
} from "./icons";
import { useStore, DEFAULT_PREFS } from "../lib/store";
import { useT, LANGS } from "../lib/i18n";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import { Select } from "./ui/Select";
import { exportSettings, parseSettings } from "../lib/settingsFile";
import { importVsCodeKeybindings } from "../lib/keybindings";

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
  const pinned = prefs.memoryModel;

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
            max={300}
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
            <BackgroundModelPicker
              pinned={pinned}
              onChange={(v) => setPrefs({ memoryModel: v })}
            />
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
          <Toggle
            label={t("prefAutosave")}
            hint={t("prefAutosaveHint")}
            value={prefs.autosave}
            onChange={(v) => setPrefs({ autosave: v })}
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

        {/* Portable configuration */}
        <Section icon={Save} title={t("settingsPortable")}>
          <SettingsFileControls />
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


/** Choosing the background model in two steps: the provider, then one of its
 *  models.
 *
 *  The flat list this replaces could only offer models whose catalogue happened
 *  to load at startup, so a provider whose /models call failed (TokenRouter did)
 *  simply had no models to pick — with nothing on screen explaining why. Now the
 *  catalogue is fetched when you pick the provider, there is a retry, and if the
 *  provider will not list its models you can still type the id by hand. */
function BackgroundModelPicker({
  pinned,
  onChange,
}: {
  pinned?: { connectionId: string; model: string };
  onChange: (v: { connectionId: string; model: string } | undefined) => void;
}) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const models = useStore((s) => s.models);
  const modelStatus = useStore((s) => s.modelStatus);
  const setModels = useStore((s) => s.setModels);

  const [connId, setConnId] = useState(pinned?.connectionId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const list = connId ? (models[connId] ?? []) : [];

  const load = async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    if (!conn) return;
    setLoading(true);
    setError(null);
    try {
      setModels(conn.id, await api.listModels(conn));
    } catch (e) {
      // Say why it is empty. A silent failure here is what made the list look
      // like the provider simply had no models.
      setError(String(e).slice(0, 160));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <Select
        value={connId}
        onChange={(id) => {
          setConnId(id);
          setError(null);
          if (!id) {
            onChange(undefined);
            return;
          }
          if (!models[id]?.length) void load(id);
        }}
        options={[
          { value: "", label: t("prefMemoryModelAuto") },
          ...connections.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      {connId && (
        <div className="flex items-center gap-2">
          <Select
            className="min-w-0 flex-1"
            value={pinned?.connectionId === connId ? pinned.model : ""}
            disabled={loading || list.length === 0}
            placeholder={loading ? t("loading") : list.length ? t("prefMemoryModelPick") : "—"}
            onChange={(m) =>
              m
                ? onChange({ connectionId: connId, model: m })
                : onChange(undefined)
            }
            options={list.map((m) => ({
              value: m.id,
              label:
                m.id +
                (modelStatus[`${connId}::${m.id}`] === "denied" ? ` — ${t("modelDenied")}` : ""),
            }))}
          />
          <button
            className="btn btn-secondary btn-sm shrink-0"
            disabled={loading}
            onClick={() => void load(connId)}
          >
            {t("refresh")}
          </button>
        </div>
      )}

      {connId && !loading && list.length === 0 && (
        <div className="space-y-1.5">
          <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-warning)]">
            {error ?? t("prefMemoryModelNoList")}
          </p>
          <div className="flex items-center gap-2">
            <input
              className="input min-w-0 flex-1"
              placeholder={t("prefMemoryModelManual")}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manual.trim())
                  onChange({ connectionId: connId, model: manual.trim() });
              }}
            />
            <button
              className="btn btn-secondary btn-sm shrink-0"
              disabled={!manual.trim()}
              onClick={() => onChange({ connectionId: connId, model: manual.trim() })}
            >
              {t("save")}
            </button>
          </div>
        </div>
      )}

      {pinned && (
        <p className="text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          {connections.find((c) => c.id === pinned.connectionId)?.name ?? "?"} · {pinned.model}
        </p>
      )}
    </div>
  );
}


/** Carrying the setup to another machine, and getting it back after a reset.
 *
 *  Every outcome is reported, including the partial ones: an import that says
 *  "done" while ignoring half the file teaches people not to trust it.
 */
function SettingsFileControls() {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const say = (text: string) => setNote(text.slice(0, 160));

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setNote(null);
    try {
      const said = await work();
      if (said) say(said);
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const readChosen = async (): Promise<string | null> => {
    const chosen = await api.pickAttachments(["json"]);
    if (!chosen.length) return null;
    return atob(await api.readFileBase64(chosen[0]));
  };

  return (
    <div className="py-3">
      {note && (
        <p className="mb-2 rounded-[var(--r-sm)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const st = useStore.getState();
              const path = await exportSettings({
                prefs: st.prefs,
                keybindings: st.keybindings,
                theme: st.theme,
                lang: st.lang,
              });
              return path ? t("settingsExported").replace("{name}", path.split("/").pop() ?? path) : null;
            })
          }
        >
          {t("settingsExport")}
        </button>

        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const json = await readChosen();
              if (!json) return null;
              const parsed = parseSettings(json);
              const st = useStore.getState();
              st.setPrefs(parsed.prefs);
              st.setKeybindings(parsed.keybindings);
              if (parsed.theme) st.setTheme(parsed.theme as never);
              if (parsed.lang) st.setLang(parsed.lang as never);
              return parsed.ignored.length
                ? t("settingsImportedPartly").replace("{keys}", parsed.ignored.join(", "))
                : t("settingsImported");
            })
          }
        >
          {t("settingsImport")}
        </button>

        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const json = await readChosen();
              if (!json) return null;
              const result = importVsCodeKeybindings(json);
              useStore.getState().setKeybindings(result.bindings);
              const parts = [t("keysImported")];
              if (result.unsupported.length)
                parts.push(
                  t("keysUnsupported").replace("{commands}", result.unsupported.slice(0, 4).join(", ")),
                );
              if (result.conflicts.length)
                parts.push(t("keysConflicts").replace("{list}", result.conflicts[0]));
              return parts.join(" · ");
            })
          }
        >
          {t("keysImport")}
        </button>
      </div>
      <p className="mt-2 text-[length:var(--fs-2xs)] leading-relaxed text-[var(--color-text-mute)]">
        {t("settingsPortableHint")}
      </p>
    </div>
  );
}
