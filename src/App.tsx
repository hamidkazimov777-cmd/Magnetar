import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { useStore } from "./lib/store";
import { api } from "./lib/api";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connections = useStore((s) => s.connections);

  // Open settings on first run so the user lands on "paste your key".
  useEffect(() => {
    if (connections.length === 0) setSettingsOpen(true);
  }, [connections.length]);

  // Load the canon from SQLite, then ensure there's a session to type into.
  useEffect(() => {
    (async () => {
      await useStore.getState().hydrate();
      const st = useStore.getState();
      if (st.sessions.length === 0 || !st.activeSessionId) st.newSession();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm the model catalog across all connections so the adaptive router can
  // reason about which models are available (best-effort, offline-safe).
  useEffect(() => {
    (async () => {
      for (const c of connections) {
        if (!(await api.hasApiKey(c.id))) continue;
        try {
          const list = await api.listModels(c);
          useStore.getState().setModels(c.id, list);
        } catch {
          /* ignore — offline / bad key surfaces elsewhere */
        }
      }
    })();
  }, [connections]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
      <ChatView onOpenSettings={() => setSettingsOpen(true)} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
