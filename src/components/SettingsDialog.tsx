import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import {
  GIGACHAT_BASE,
  OPENAI_COMPAT_PRESETS,
  type ProviderKind,
} from "../lib/types";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";

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

  const [kind, setKind] = useState<ProviderKind>("openai_compat");
  const [name, setName] = useState("OpenRouter");
  const [baseUrl, setBaseUrl] = useState(OPENAI_COMPAT_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [scope, setScope] = useState("GIGACHAT_API_PERS");
  const [caPath, setCaPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyed, setKeyed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        connections.map(async (c) => [c.id, await api.hasApiKey(c.id)] as const),
      );
      setKeyed(Object.fromEntries(entries));
    })();
  }, [connections]);

  const selectKind = (k: ProviderKind) => {
    setKind(k);
    setError(null);
    if (k === "gigachat") {
      setName("GigaChat");
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

  const remove = async (id: string) => {
    await api.deleteApiKey(id);
    removeConnection(id);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-0 gap-0 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]">
        <DialogHeader className="border-b border-[var(--color-border)] px-5 py-4">
          <DialogTitle className="text-base font-semibold">{t("connectionsTitle")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          {connections.length > 0 && (
            <div className="space-y-2">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate text-sm font-medium">
                      {c.name}
                      <span className="rounded-md bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">
                        {c.kind === "gigachat" ? "GigaChat" : "OpenAI-compat"}
                      </span>
                    </div>
                    <div className="truncate text-xs text-[var(--color-text-dim)]">
                      {c.baseUrl}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs",
                        keyed[c.id]
                          ? "text-[var(--color-accent-strong)]"
                          : "text-[var(--color-text-dim)]",
                      )}
                    >
                      {keyed[c.id] ? <Check size={13} /> : <KeyRound size={13} />}
                      {keyed[c.id] ? t("keyInKeychain") : t("noKey")}
                    </span>
                    <button
                      onClick={() => remove(c.id)}
                      className="rounded-lg p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-red-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <div className="text-sm font-medium">{t("addConnection")}</div>

            {/* Provider kind */}
            <div className="flex gap-1.5">
              {(
                [
                  ["openai_compat", t("providerOpenai")],
                  ["gigachat", t("providerGiga")],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => selectKind(k)}
                  className={cn(
                    "flex-1 rounded-lg border px-2.5 py-1.5 text-xs",
                    kind === k
                      ? "border-[var(--color-accent)] text-[var(--color-accent-strong)]"
                      : "border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {kind === "openai_compat" && (
              <div className="flex flex-wrap gap-1.5">
                {OPENAI_COMPAT_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => {
                      setName(p.name);
                      setBaseUrl(p.baseUrl);
                    }}
                    className={cn(
                      "rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-2)]",
                      baseUrl === p.baseUrl &&
                        "border-[var(--color-accent)] text-[var(--color-accent-strong)]",
                    )}
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

            {kind === "openai_compat" && (
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
                placeholder={kind === "gigachat" ? "base64 client_id:secret" : "sk-…"}
                className={inputCls}
              />
            </Field>

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
                <p className="text-xs text-[var(--color-text-dim)]">
                  {t("gigaNote")}
                </p>
              </>
            )}

            <p className="text-xs text-[var(--color-text-dim)]">
              {t("keychainNote")}
            </p>

            {error && <div className="text-sm text-red-400">{error}</div>}

            <button
              onClick={add}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-[var(--color-accent-fg)] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={15} />
              )}
              {t("addConnectionBtn")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-[var(--color-text-dim)]">{label}</span>
      {children}
    </label>
  );
}
