import { useEffect, useState } from "react";
import { Workspace } from "./components/shell/Workspace";
import { CommandPalette } from "./components/shell/CommandPalette";
import { WelcomeView } from "./components/WelcomeView";
import { SettingsDialog } from "./components/SettingsDialog";
import { GuideDialog } from "./components/GuideDialog";
import { Splash } from "./components/Splash";
import { useStore } from "./lib/store";
import { api } from "./lib/api";
import { installLinkInterceptor } from "./lib/links";
import { ensureProjectFacts } from "./lib/facts";
import { verifyProjectFacts } from "./lib/verify";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const connections = useStore((s) => s.connections);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const hydrated = useStore((s) => s.hydrated);
  const onboarded = useStore((s) => s.onboarded);
  const setOnboarded = useStore((s) => s.setOnboarded);

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

  // Global shortcuts: ⌘K palette, ⌘J terminal, ⌘B sidebar, ⌘⇧A agent panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const st = useStore.getState();
      if (e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "j") {
        e.preventDefault();
        st.toggleTerminal();
      } else if (e.key === "b") {
        e.preventDefault();
        st.toggleSidebar();
      } else if (e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        st.toggleAgentPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // First launch goes through the walkthrough, not straight into an empty IDE.
  const showWelcome = hydrated && !onboarded;

  return (
    <>
      {showWelcome ? (
        <WelcomeView
          onOpenSettings={() => setSettingsOpen(true)}
          onFinish={() => setOnboarded(true)}
        />
      ) : (
        <Workspace
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenGuide={() => setGuideOpen(true)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenGuide={() => setGuideOpen(true)}
      />

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {guideOpen && <GuideDialog onClose={() => setGuideOpen(false)} />}
      {showSplash && <Splash onDone={() => setShowSplash(false)} />}
    </>
  );
}
