import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { MessagesSquare, Bot, Sparkles } from "./icons";

export function TrackSwitcher() {
  const t = useT();
  const activeTrack = useStore((s) => s.activeTrack);
  const switchTrack = useStore((s) => s.switchTrack);

  return (
    <div className="flex gap-1 rounded-[var(--r-md)] bg-[var(--color-surface-2)] p-0.5 shadow-inner">
      <button
        onClick={() => switchTrack("chat")}
        data-active={activeTrack === "chat"}
        title={t("trackChat")}
        className="row h-7 rounded-[var(--r-sm)] px-2.5 text-[length:var(--fs-xs)] font-medium text-[var(--color-text-mute)] hover:text-[var(--color-text)] data-[active=true]:bg-[var(--color-surface)] data-[active=true]:text-[var(--color-text)] data-[active=true]:shadow-sm transition-all"
      >
        <MessagesSquare size={14} className="shrink-0" />
        {t("trackChat")}
      </button>
      <button
        onClick={() => switchTrack("agent")}
        data-active={activeTrack === "agent"}
        title={t("agent")}
        className="row h-7 rounded-[var(--r-sm)] px-2.5 text-[length:var(--fs-xs)] font-medium text-[var(--color-text-mute)] hover:text-[var(--color-text)] data-[active=true]:bg-[var(--color-surface)] data-[active=true]:text-[var(--color-text)] data-[active=true]:shadow-sm transition-all"
      >
        <Bot size={14} className="shrink-0" />
        {t("agent")}
      </button>
      <button
        onClick={() => switchTrack("generation")}
        data-active={activeTrack === "generation"}
        title={t("trackGeneration")}
        className="row h-7 rounded-[var(--r-sm)] px-2.5 text-[length:var(--fs-xs)] font-medium text-[var(--color-text-mute)] hover:text-[var(--color-text)] data-[active=true]:bg-[var(--color-surface)] data-[active=true]:text-[var(--color-text)] data-[active=true]:shadow-sm transition-all"
      >
        <Sparkles size={14} className="shrink-0" />
        {t("trackGeneration")}
      </button>
    </div>
  );
}
