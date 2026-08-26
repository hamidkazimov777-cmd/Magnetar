import { useEffect, useState } from "react";
import { X } from "./components/icons";
import { Workspace } from "./components/shell/Workspace";
import { CommandPalette } from "./components/shell/CommandPalette";
import { WelcomeView } from "./components/WelcomeView";
import { SettingsDialog } from "./components/SettingsDialog";
import { GuideDialog } from "./components/GuideDialog";
import { Splash } from "./components/Splash";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useStore } from "./lib/store";
import { chordOf, commandFor } from "./lib/keybindings";
import { useT } from "./lib/i18n";
import { api } from "./lib/api";
import { installLinkInterceptor } from "./lib/links";
import { ensureProjectFacts } from "./lib/facts";
import { verifyProjectFacts } from "./lib/verify";
import { ensureProjectDecisions } from "./lib/decisions";
import { ensureDivergences } from "./lib/divergence";
import { ensureProposals } from "./lib/proposal";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // The palette serves two shortcuts: ⌘K for commands, ⌘P for the project's
  // files. Same surface, different starting list.
  const [palette, setPalette] = useState<null | "commands" | "files">(null);
  const [showSplash, setShowSplash] = useState(true);

  const connections = useStore((s) => s.connections);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const setOnboarded = useStore((s) => s.setOnboarded);
  const startupError = useStore((s) => s.startupError);
  const setStartupError = useStore((s) => s.setStartupError);
  const t = useT();

  // Load the canon from SQLite, then ensure there's a session to type into.
  useEffect(() => {
    void (async () => {
      await useStore.getState().hydrate();
      const st = useStore.getState();
      if (st.sessions.length === 0 || !st.activeSessionId) st.newSession();
    })();
  }, []);

  // The open project's memory has to be loaded (and migrated off the old prose
  // fields) before anything builds a prompt from it.
  useEffect(() => {
    if (!activeProjectId) return;
    void (async () => {
      await ensureProjectFacts(activeProjectId);
      await ensureProjectDecisions(activeProjectId);
      await ensureDivergences(activeProjectId);
      await ensureProposals(activeProjectId);
      // Cheap verification (file greps, no model, no build) runs on open, so
      // memory that has quietly gone out of date says so before it is used.
      const st = useStore.getState();
      const root = st.projects.find((p) => p.id === activeProjectId)?.path ?? st.workspaceRoot;
      if (root) await verifyProjectFacts(root, activeProjectId);
    })();
  }, [activeProjectId]);

  // Warm the model catalog across all connections so the adaptive router can
  // reason about what is available (best-effort, offline-safe).
  useEffect(() => {
    void (async () => {
      for (const c of connections) {
        if (!(await api.hasApiKey(c.id))) continue;
        try {
          const list = await api.listModels(c);
          useStore.getState().setModels(c.id, list);
          const state = useStore.getState();
          if (state.activeConnectionId === c.id && !state.activeModel && list[0])
            state.setActiveModel(list[0].id);
        } catch {
          /* ignore — offline / bad key surfaces in Settings → Test */
        }
      }
    })();
  }, [connections]);

  // Links must never navigate the app window — see lib/links.ts.
  useEffect(installLinkInterceptor, []);

  // Global shortcuts, resolved through the bindings table rather than a chain
  // of key comparisons — so an imported VS Code binding reaches the same
  // commands, and ⌘⇧P works for anyone who has spent years pressing it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const st = useStore.getState();
      const command = commandFor(chordOf(e), st.keybindings);
      if (!command) return;

      switch (command) {
        case "palette.commands":
          e.preventDefault();
          setPalette((v) => (v === "commands" ? null : "commands"));
          break;
        case "palette.files":
          e.preventDefault();
          setPalette((v) => (v === "files" ? null : "files"));
          break;
        case "view.terminal":
          e.preventDefault();
          st.toggleTerminal();
          break;
        case "view.sidebar":
          e.preventDefault();
          st.toggleSidebar();
          break;
        case "view.agentPanel":
          e.preventDefault();
          st.toggleAgentPanel();
          break;
        case "search.focus":
          e.preventDefault();
          st.setSidePanel("search");
          break;
        // The editor owns save and close: it is the only thing that knows
        // which buffer is dirty and which tab is in front.
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // First launch goes through the walkthrough, not straight into an empty IDE.
  const showWelcome = hydrated && !onboarded;

  return (
    <>
      {startupError && (
        <div className="alert fixed inset-x-0 top-3 z-50 mx-auto w-[min(92vw,560px)] shadow-lg">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{t("startupErrorTitle")}</div>
            <p className="mt-1 break-words text-[length:var(--fs-sm)] opacity-90">
              {startupError}
            </p>
          </div>
          <button
            className="icon-btn h-5 w-5 shrink-0"
            title={t("close")}
            aria-label={t("close")}
            onClick={() => setStartupError(undefined)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {showWelcome ? (
        <ErrorBoundary surface={t("welcomeTitle")}>
          <WelcomeView
            onOpenSettings={() => setSettingsOpen(true)}
            onFinish={() => setOnboarded(true)}
          />
        </ErrorBoundary>
      ) : (
        <ErrorBoundary surface={t("workspace")}>
          <Workspace
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenGuide={() => setGuideOpen(true)}
          />
        </ErrorBoundary>
      )}

      <ErrorBoundary surface={t("commandPalette")}>
        <CommandPalette
          open={palette !== null}
          mode={palette ?? "commands"}
          onClose={() => setPalette(null)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGuide={() => setGuideOpen(true)}
        />
      </ErrorBoundary>

      {settingsOpen && (
        <ErrorBoundary surface={t("settingsTitle")}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </ErrorBoundary>
      )}
      {guideOpen && (
        <ErrorBoundary surface={t("guide")}>
          <GuideDialog onClose={() => setGuideOpen(false)} />
        </ErrorBoundary>
      )}
      {showSplash && (
        <ErrorBoundary surface="Magnetar">
          <Splash onDone={() => setShowSplash(false)} />
        </ErrorBoundary>
      )}
    </>
  );
}
