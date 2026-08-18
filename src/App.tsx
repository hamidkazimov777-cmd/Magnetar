import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { SettingsDialog } from "./components/SettingsDialog";
import { useStore } from "./lib/store";
import { api } from "./lib/api";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connections = useStore((s) => s.connections);
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const newSession = useStore((s) => s.newSession);

  // Open settings on first run so the user lands on "paste your key".
  useEffect(() => {
    if (connections.length === 0) setSettingsOpen(true);
  }, [connections.length]);

  // Always have a session to type into.
  useEffect(() => {
    if (sessions.length === 0 || !activeSessionId) newSession();
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
