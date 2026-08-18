import { Bot, PanelRightOpen } from "lucide-react";
import { EditorView } from "./EditorView";
import { ChatView } from "./ChatView";
import { useT } from "../lib/i18n";

/** Default IDE shell: familiar Explorer → editor → agent flow in one place. */
export function IdeWorkspace({
  onOpenSettings,
  onNavigate,
}: {
  onOpenSettings: () => void;
  onNavigate: (tab: string) => void;
}) {
  const t = useT();
  return (
    <main className="flex min-w-0 flex-1 bg-[var(--color-bg)]">
      <section className="min-w-0 flex-[1.5] border-r border-[var(--color-border)]">
        <EditorView embedded />
      </section>
      <aside className="flex min-w-[360px] flex-1 flex-col bg-[var(--color-surface)]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><Bot size={16} className="text-[var(--color-accent-strong)]" />{t("agent")}</div>
          <PanelRightOpen size={16} className="text-[var(--color-text-dim)]" />
        </header>
        <ChatView onOpenSettings={onOpenSettings} onNavigate={onNavigate} embedded />
      </aside>
    </main>
  );
}
