import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, Trash2, Play } from "./icons";
import { api, type KeyStorage } from "../lib/api";
import { useStore } from "../lib/store";
import {
  ANTHROPIC_BASE,
  KIMI_BASES,
  GIGACHAT_BASE,
  OPENAI_COMPAT_PRESETS,
  type ProviderKind,
} from "../lib/types";
import { GEN_PROVIDERS, GEN_PROVIDER_CHIPS, GEN_BY_ID, providerForBaseUrl } from "../lib/generation";
import { useT, LANGS } from "../lib/i18n";
import { cn } from "../lib/cn";
import { SelfTest } from "./SelfTest";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const addConnection = useStore((s) => s.addConnection);
  const removeConnection = useStore((s) => s.removeConnection);
  const setActive = useStore((s) => s.setActive);
  const setModels = useStore((s) => s.setModels);
  const setModelStatus = useStore((s) => s.setModelStatus);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  const [kind, setKind] = useState<ProviderKind>("openai_compat");
  const [name, setName] = useState("OpenRouter");
  const [baseUrl, setBaseUrl] = useState(OPENAI_COMPAT_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [scope, setScope] = useState("GIGACHAT_API_PERS");
  const [caPath, setCaPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Not a boolean: a key in the debug fallback file is stored, but it is not
   *  in the Keychain, and the difference is exactly what the user needs told. */
  const [keyed, setKeyed] = useState<Record<string, KeyStorage>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  /** Which provider category the dialog is showing. Derived from the active
   *  track when the dialog mounts, so "Подключить модель" from the Generation
   *  track lands on the right tab without a separate settings screen. */
  const [category, setCategory] = useState<"llm" | "generation">(() =>
    useStore.getState().activeTrack === "generation" ? "generation" : "llm",
  );
  const [genProviderId, setGenProviderId] = useState(
    () => GEN_PROVIDERS.find((p) => p.available)?.id ?? GEN_PROVIDERS[0].id,
  );
  const [genKey, setGenKey] = useState("");

  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        connections.map(async (c) => [c.id, await api.keyStorage(c.id)] as const),
      );
      setKeyed(Object.fromEntries(entries));
    })();
  }, [connections]);

  /** What the form offers. "kimi" is not a ProviderKind — Moonshot speaks
   *  plain OpenAI — but it deserves its own button so the base URL and the
   *  region are not something the user has to know. */
  type FormKind = ProviderKind | "kimi";
  const [formKind, setFormKind] = useState<FormKind>("openai_compat");
  const [kimiRegion, setKimiRegion] = useState<keyof typeof KIMI_BASES>("global");

  const llmConnections = connections.filter((c) => c.kind !== "generative");
  const genConnections = connections.filter((c) => c.kind === "generative");
  const visibleConnections = category === "generation" ? genConnections : llmConnections;
  const genProvider = GEN_BY_ID.get(genProviderId) ?? GEN_PROVIDERS[0];

  const selectKind = (k: FormKind) => {
    setFormKind(k);
    setKind(k === "kimi" ? "openai_compat" : k);
    setError(null);
    if (k === "gigachat") {
      setName("GigaChat");
    } else if (k === "anthropic") {
      setName("Claude");
    } else if (k === "kimi") {
      setName("Kimi");
      setBaseUrl(KIMI_BASES[kimiRegion]);
    } else {
      setName("OpenRouter");
      setBaseUrl(OPENAI_COMPAT_PRESETS[0].baseUrl);
    }
  };

  const add = async () => {
    setError(null);
    if (!name.trim() || !apiKey.trim()) {
      setError(t("errFillNameKey"));
      return;
    }
    if (kind === "openai_compat" && !baseUrl.trim()) {
      setError(t("errNeedBaseUrl"));
      return;
    }
    setBusy(true);
    try {
      const id =
        kind === "gigachat"
          ? addConnection({
              name: name.trim(),
              kind: "gigachat",
              baseUrl: GIGACHAT_BASE,
              scope: scope.trim() || "GIGACHAT_API_PERS",
              caPath: caPath.trim() || undefined,
            })
          : kind === "anthropic"
            ? addConnection({
                name: name.trim(),
                kind: "anthropic",
                baseUrl: ANTHROPIC_BASE,
              })
            : addConnection({
                name: name.trim(),
                kind: "openai_compat",
                baseUrl: baseUrl.trim(),
              });
      await api.saveApiKey(id, apiKey.trim());
      setApiKey("");
      setCaPath("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addGeneration = async () => {
    setError(null);
    if (!genProvider?.available) {
      setError(t("genProviderUnavailable"));
      return;
    }
    if (!genKey.trim()) {
      setError(t("errFillNameKey"));
      return;
    }
    setBusy(true);
    try {
      // Same connection manager + key storage as LLM providers. The only
      // difference is `kind: "generative"` and a catalogue-fixed base URL.
      const id = addConnection({
        name: genProvider.name,
        kind: "generative",
        baseUrl: genProvider.baseUrl,
      });
      await api.saveApiKey(id, genKey.trim());
      setGenKey("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(t("connectionDeleteConfirm", { name }))) return;
    await api.deleteApiKey(id);
    removeConnection(id);
  };

  /** Providers happily list models a token cannot actually call (404 "No such
   *  model", 403, or a broken free tier). Walk the catalogue until one really
   *  answers, mark the failures, and activate the first that works. */
  const MAX_PROBES = 14;

  const testConnection = async (c: (typeof connections)[number]) => {
    setTesting(c.id);
    setTestResult((prev) => ({ ...prev, [c.id]: t("connectionTesting") }));
    try {
      const models = await api.listModels(c);
      if (!models[0]) throw new Error(t("noModels"));
      setModels(c.id, models);

      // Try models the token has not already been refused for first.
      const status = useStore.getState().modelStatus;
      const ordered = [...models].sort(
        (a, b) =>
          Number(status[`${c.id}::${a.id}`] === "denied") -
          Number(status[`${c.id}::${b.id}`] === "denied"),
      );

      let lastError = "";
      for (const [i, m] of ordered.slice(0, MAX_PROBES).entries()) {
        setTestResult((prev) => ({
          ...prev,
          [c.id]: t("connectionProbing", {
            n: String(i + 1),
            total: String(Math.min(ordered.length, MAX_PROBES)),
            model: m.id,
          }),
        }));
        try {
          const answer = await api.complete(c, m.id, [
            { id: "health", role: "user", content: "Reply exactly: OK", createdAt: 0 },
          ]);
          if (!/ok/i.test(answer)) throw new Error(answer.slice(0, 80) || "empty reply");
          setModelStatus(c.id, m.id, "ok");
          setActive(c.id, m.id);
          setTestResult((prev) => ({
            ...prev,
            [c.id]: t("connectionTestOk", {
              count: String(models.length),
              model: m.id,
            }),
          }));
          return;
        } catch (e) {
          // Name the model in the error. Gateways often answer 400 with no
          // body at all, and "400 Bad Request" on its own tells the user
          // nothing about which model the token cannot actually call.
          lastError = `${m.id} — ${String(e)}`;
          setModelStatus(c.id, m.id, "denied");
        }
      }
      throw new Error(lastError || t("noModels"));
    } catch (e) {
      setTestResult((prev) => ({
        ...prev,
        [c.id]: `${t("connectionTestFail")}: ${String(e).slice(0, 160)}`,
      }));
    } finally {
      setTesting(null);
    }
  };

  /** Validate a generative connection: a successful `/models` call proves the
   *  key works. The catalogue holds the curated model list, not the raw
   *  `/models` response (which for OpenAI lists every text model too). */
  const testGenerative = async (c: (typeof connections)[number]) => {
    setTesting(c.id);
    setTestResult((prev) => ({ ...prev, [c.id]: t("connectionTesting") }));
    try {
      await api.listModels(c);
      const provider = providerForBaseUrl(c.baseUrl);
      const count = provider?.models.length ?? 0;
      setTestResult((prev) => ({
        ...prev,
        [c.id]: count
          ? `${t("genCheckOk")} · ${count} ${t("modelsCount")}`
          : t("genCheckOk"),
      }));
    } catch (e) {
      setTestResult((prev) => ({
        ...prev,
        [c.id]: `${t("genCheckFail")}: ${String(e).slice(0, 160)}`,
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]">
        <DialogHeader className="border-b border-[var(--color-border)] px-5 py-4">
          <DialogTitle className="text-[length:var(--fs-lg)] font-semibold">
            {t("connectionsTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          <div className="panel space-y-2 p-4">
            <div className="text-[length:var(--fs-md)] font-semibold">
              {t("settingsAppearance")}
            </div>
            <div className="flex items-center gap-2">
              <span className="field-label mb-0 flex-1">{t("language")}</span>
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
          </div>

          {/* Category switcher: LLM (chat/agent) vs generation. One dialog,
              one connection manager — the tab only filters what is shown. */}
          <div className="flex gap-1.5">
            <button
              className="toggle-pill flex-1 justify-center"
              data-on={category === "llm"}
              onClick={() => setCategory("llm")}
            >
              {t("connTabLlm")}
            </button>
            <button
              className="toggle-pill flex-1 justify-center"
              data-on={category === "generation"}
              onClick={() => setCategory("generation")}
            >
              {t("trackGeneration")}
            </button>
          </div>

          {category === "llm" && llmConnections.length >= 1 && <SelfTest />}
          {visibleConnections.length > 0 && (
            <div className="space-y-2">
              {visibleConnections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-2 rounded-[var(--r-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[length:var(--fs-md)] font-medium">
                      <span className="truncate">{c.name}</span>
                      <span className="badge shrink-0">
                        {c.kind === "gigachat"
                          ? "GigaChat"
                          : c.kind === "anthropic"
                            ? "Claude"
                            : c.kind === "generative"
                              ? t("trackGeneration")
                              : "OpenAI"}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                      {c.baseUrl}
                    </div>
                    {testResult[c.id] && (
                      <p
                        className={cn(
                          "mt-1 text-[length:var(--fs-xs)]",
                          testResult[c.id].startsWith(t("connectionTestFail")) ||
                            testResult[c.id].startsWith(t("genCheckFail"))
                            ? "text-[var(--color-danger)]"
                            : "text-[var(--color-success)]",
                        )}
                      >
                        {testResult[c.id]}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "flex items-center gap-1 text-[length:var(--fs-xs)]",
                        keyed[c.id] === "keychain"
                          ? "text-[var(--color-accent-strong)]"
                          : keyed[c.id] === "plaintextfile"
                            ? "text-[var(--color-warning,var(--color-text-dim))]"
                            : "text-[var(--color-text-dim)]",
                      )}
                    >
                      {keyed[c.id] === "keychain" ? <Check size={13} /> : <KeyRound size={13} />}
                      {keyed[c.id] === "keychain"
                        ? t("keyInKeychain")
                        : keyed[c.id] === "plaintextfile"
                          ? t("keyInPlaintextFile")
                          : t("noKey")}
                    </span>
                    <button
                      onClick={() =>
                        void (c.kind === "generative" ? testGenerative(c) : testConnection(c))
                      }
                      disabled={testing !== null}
                      className="btn btn-secondary btn-sm"
                      title={t("connectionTest")}
                    >
                      {testing === c.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Play size={12} />
                      )}
                      {t("connectionTest")}
                    </button>
                    <button
                      onClick={() => void remove(c.id, c.name)}
                      className="icon-btn hover:text-[var(--color-danger)]"
                      title={t("delete")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {category === "llm" && (
            <div className="panel space-y-3 p-4">
              <div className="text-[length:var(--fs-md)] font-semibold">{t("addConnection")}</div>

              {/* Provider kind */}
              <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["openai_compat", t("providerOpenai")],
                  ["anthropic", t("providerAnthropic")],
                  ["kimi", t("providerKimi")],
                  ["gigachat", t("providerGiga")],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => selectKind(k)}
                  className="toggle-pill"
                  data-on={formKind === k}
                >
                  {label}
                </button>
              ))}
            </div>

            {formKind === "kimi" && (
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["global", t("kimiGlobal")],
                    ["cn", t("kimiCn")],
                  ] as const
                ).map(([r, label]) => (
                  <button
                    key={r}
                    onClick={() => {
                      setKimiRegion(r);
                      setBaseUrl(KIMI_BASES[r]);
                    }}
                    className="toggle-pill h-6 text-[length:var(--fs-xs)]"
                    data-on={kimiRegion === r}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {formKind === "kimi" && (
              <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
                {t("kimiNote")}
              </p>
            )}

            {formKind === "openai_compat" && (
              <div className="flex flex-wrap gap-1.5">
                {OPENAI_COMPAT_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setName(p.name);
                      setBaseUrl(p.baseUrl);
                    }}
                    className="toggle-pill h-6 text-[length:var(--fs-xs)]"
                    data-on={baseUrl === p.baseUrl}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <Field label={t("fieldName")}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </Field>

            {formKind === "openai_compat" && (
              <Field label={t("fieldBaseUrl")}>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className={inputCls}
                />
              </Field>
            )}

            <Field
              label={kind === "gigachat" ? t("fieldGigaAuth") : t("fieldApiKey")}
            >
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  kind === "gigachat"
                    ? "base64 client_id:secret"
                    : kind === "anthropic"
                      ? "sk-ant-…"
                      : "sk-…"
                }
                className={inputCls}
              />
            </Field>

            {kind === "anthropic" && (
              <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-dim)]">
                {t("anthropicNote")}
              </p>
            )}

            {kind === "gigachat" && (
              <>
                <Field label={t("fieldScope")}>
                  <input
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    placeholder="GIGACHAT_API_PERS"
                    className={inputCls}
                  />
                </Field>
                <Field label={t("fieldCaPath")}>
                  <input
                    value={caPath}
                    onChange={(e) => setCaPath(e.target.value)}
                    placeholder="/Users/…/russian_trusted_root_ca.pem"
                    className={inputCls}
                  />
                </Field>
                <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-dim)]">
                  {t("gigaNote")}
                </p>
              </>
            )}

            <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
              {t("keychainNote")}
            </p>

            {error && <div className="alert text-[length:var(--fs-sm)]">{error}</div>}

            <button
              onClick={add}
              disabled={busy}
              className="btn btn-primary"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}
              {t("addConnectionBtn")}
            </button>
          </div>
          )}

          {category === "generation" && (
            <div className="panel space-y-3 p-4">
              <div className="text-[length:var(--fs-md)] font-semibold">{t("addConnection")}</div>
              <p className="text-[length:var(--fs-xs)] leading-relaxed text-[var(--color-text-mute)]">
                {t("genConnectHint")}
              </p>

              {/* Generative providers, all from the shared catalogue. */}
              <div className="flex flex-wrap gap-1.5">
                {GEN_PROVIDER_CHIPS.map((p) => (
                  <button
                    key={p.id}
                    disabled={!p.available}
                    onClick={() => setGenProviderId(p.id)}
                    className="toggle-pill h-7"
                    data-on={genProviderId === p.id}
                    title={p.available ? undefined : t("genSoonHint")}
                  >
                    {p.name}
                    {!p.available && (
                      <span className="ml-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                        {t("genSoon")}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <Field label={t("genBaseUrl")}>
                <input
                  value={genProvider?.baseUrl ?? ""}
                  readOnly
                  className={cn(inputCls, "opacity-70")}
                />
              </Field>

              <Field label={t("fieldApiKey")}>
                <input
                  type="password"
                  value={genKey}
                  onChange={(e) => setGenKey(e.target.value)}
                  placeholder="sk-…"
                  className={inputCls}
                />
              </Field>

              {error && <div className="alert text-[length:var(--fs-sm)]">{error}</div>}

              <button
                onClick={addGeneration}
                disabled={busy || !genProvider?.available}
                className="btn btn-primary"
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={15} />
                )}
                {t("addConnectionBtn")}
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const inputCls = "input";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
