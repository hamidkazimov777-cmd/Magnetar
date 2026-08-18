import { EditorView } from "./EditorView";
import { ChatView } from "./ChatView";

/** Default IDE shell: familiar Explorer → editor → agent flow in one place. */
export function IdeWorkspace({
  onOpenSettings,
  onNavigate,
}: {
  onOpenSettings: () => void;
  onNavigate: (tab: string) => void;
}) {
  return (
    <main className="flex min-w-0 flex-1 bg-[var(--color-bg)]">
      <section className="min-w-0 flex-[1.5] border-r border-[var(--color-border)]">
        <EditorView embedded />
      </section>
      <aside className="flex min-w-[360px] flex-1 flex-col bg-[var(--color-surface)]">
        <ChatView onOpenSettings={onOpenSettings} onNavigate={onNavigate} embedded />
      </aside>
    </main>
  );
}
