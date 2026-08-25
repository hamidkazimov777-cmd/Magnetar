import { useEffect, useState } from "react";
import {
  FolderOpen,
  Clock,
  KeyRound,
  Check,
  ArrowRight,
  Bot,
  X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { api } from "../lib/api";
import { analyzeFolderIntoMemory, activateProjectForPath } from "../lib/memory";
import { LogoMark } from "./Logo";
import { pickWorkspaceFolder } from "./panels/ExplorerPanel";
import { cn } from "../lib/cn";

/** First screen: open a folder. Everything else is secondary — the product is
 *  about working on a project, so that is the one prominent action. */
export function WelcomeView({
  onOpenSettings,
  onFinish,
}: {
  onOpenSettings: () => void;
  onFinish: () => void;
}) {
  const t = useT();
  const connections = useStore((s) => s.connections);
  const activeModel = useStore((s) => s.activeModel);
  const recentFolders = useStore((s) => s.recentFolders);
  const setWorkspaceRoot = useStore((s) => s.setWorkspaceRoot);
  const switchTrack = useStore((s) => s.switchTrack);
  const refreshExplorer = useStore((s) => s.refreshExplorer);
  const [keyed, setKeyed] = useState(false);

  // A connection only counts once its key actually landed in the Keychain.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const c of connections) {
        if (await api.hasApiKey(c.id)) {
          if (alive) setKeyed(true);
          return;
        }
      }
      if (alive) setKeyed(false);
    })();
  }, [connections]);

  const modelReady = keyed && Boolean(activeModel);

  const openFolder = async () => {
    const picked = await pickWorkspaceFolder();
    if (picked) onFinish();
  };

  const openRecent = (path: string) => {
    setWorkspaceRoot(path);
    switchTrack("agent");
    refreshExplorer();
    activateProjectForPath(path);
    void analyzeFolderIntoMemory(path).catch(() => {});
    onFinish();
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-y-auto bg-[var(--color-bg)]">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[var(--h-titlebar)]" />

      <div className="relative mx-auto flex w-full max-w-[600px] flex-col px-8 py-16">
        <div className="flex flex-col items-center text-center">
          <LogoMark size={72} />
          <h1
            className="mt-6 text-[length:var(--fs-2xl)] font-medium uppercase"
            style={{ letterSpacing: "0.22em" }}
          >
            Magnetar
          </h1>
          <p className="mt-2 text-[length:var(--fs-xs)] uppercase tracking-[0.18em] text-[var(--color-text-mute)]">
            {t("appTagline")}
          </p>
          <p className="mx-auto mt-6 max-w-[430px] text-[length:var(--fs-md)] leading-[var(--lh-relaxed)] text-[var(--color-text-dim)]">
            {t("welcomeSubtitle")}
          </p>
        </div>

        {/* The one primary action */}
        <button
          onClick={() => void openFolder()}
          className="mt-10 flex items-center gap-4 rounded-[var(--r-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-5 text-left shadow-[var(--e-1)] transition-all hover:border-[var(--color-border-strong)] hover:shadow-[var(--e-2)]"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--r-lg)] bg-[var(--color-accent-strong)] text-[var(--color-accent-fg)]">
            <FolderOpen size={20} strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[length:var(--fs-md)] font-semibold tracking-[-0.01em]">
              {t("welcomeOpenFolder")}
            </span>
            <span className="mt-1 block text-[length:var(--fs-base)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
              {t("welcomeOpenFolderText")}
            </span>
          </span>
          <ArrowRight size={17} className="shrink-0 text-[var(--color-text-mute)]" />
        </button>

        {recentFolders.length > 0 && (
          <div className="mt-7">
            <div className="section-label flex items-center gap-1.5 px-0">
              <Clock size={11} /> {t("welcomeRecent")}
            </div>
            <div className="mt-1 space-y-0.5">
              {recentFolders.slice(0, 5).map((p) => (
                <button
                  key={p}
                  onClick={() => openRecent(p)}
                  className="row h-8"
                  title={p}
                >
                  <FolderOpen size={14} className="shrink-0 opacity-70" />
                  <span className="truncate font-medium">{p.split(/[/\\]/).pop()}</span>
                  <span className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                    {p}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Model connection: a quiet status line, not a gate */}
        <div
          className={cn(
            "mt-7 flex items-center gap-3 rounded-[var(--r-lg)] border bg-[var(--color-surface)] px-4 py-3",
            modelReady
              ? "border-[color-mix(in_srgb,var(--color-success)_30%,var(--color-border))]"
              : "border-[var(--color-border)]",
          )}
        >
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-md)]",
              modelReady
                ? "bg-[color-mix(in_srgb,var(--color-success)_16%,transparent)] text-[var(--color-success)]"
                : "bg-[var(--color-surface-2)] text-[var(--color-text-dim)]",
            )}
          >
            {modelReady ? <Check size={16} /> : <KeyRound size={16} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[length:var(--fs-base)] font-medium">
              {modelReady
                ? t("welcomeModelReady", { model: activeModel ?? "" })
                : t("stepConnectTitle")}
            </span>
            <span className="block truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
              {modelReady ? t("welcomeModelReadyHint") : t("stepConnectText")}
            </span>
          </span>
          <button className="btn btn-secondary btn-sm shrink-0" onClick={onOpenSettings}>
            {modelReady ? t("settingsKeys") : t("connectModel")}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
          <Bot size={12} />
          {t("welcomeAgentNote")}
        </div>

        <button className="btn btn-ghost mt-4 self-center" onClick={onFinish}>
          <X size={14} />
          {t("welcomeSkipAll")}
        </button>
      </div>
    </div>
  );
}
