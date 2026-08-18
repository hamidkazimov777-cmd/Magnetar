import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { OPENAI_COMPAT_PRESETS } from "../lib/types";
import { cn } from "../lib/cn";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const connections = useStore((s) => s.connections);
  const addConnection = useStore((s) => s.addConnection);
  const removeConnection = useStore((s) => s.removeConnection);

  const [name, setName] = useState("OpenRouter");
  const [baseUrl, setBaseUrl] = useState(OPENAI_COMPAT_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState("");
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

  const add = async () => {
    setError(null);
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) {
      setError("Name, base URL and API key are all required.");
      return;
    }
    setBusy(true);
    try {
      const id = addConnection({
        name: name.trim(),
        kind: "openai_compat",
        baseUrl: baseUrl.trim(),
      });
      await api.saveApiKey(id, apiKey.trim());
      setApiKey("");
      setName("");
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-base font-semibold">Connections</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          {connections.length > 0 && (
            <div className="space-y-2">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-xs text-[var(--color-text-dim)]">
                      {c.baseUrl}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex items-center gap-1 text-xs",
                        keyed[c.id]
                          ? "text-emerald-400"
                          : "text-[var(--color-text-dim)]",
                      )}
                    >
                      {keyed[c.id] ? <Check size={13} /> : <KeyRound size={13} />}
                      {keyed[c.id] ? "Key in Keychain" : "No key"}
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
            <div className="text-sm font-medium">Add connection</div>

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
                      "border-[var(--color-accent)] text-[var(--color-accent)]",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="OpenRouter"
                className={inputCls}
              />
            </Field>
            <Field label="Base URL">
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className={inputCls}
              />
            </Field>
            <Field label="API key">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                className={inputCls}
              />
            </Field>

            <p className="text-xs text-[var(--color-text-dim)]">
              Keys are stored in the macOS Keychain, never on disk in plaintext.
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
              Add connection
            </button>
          </div>
        </div>
      </div>
    </div>
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
