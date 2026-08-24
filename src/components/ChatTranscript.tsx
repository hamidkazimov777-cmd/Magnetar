import { memo, useEffect, useMemo, useRef } from "react";
import { TriangleAlert, X, RotateCcw } from "lucide-react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { LogoMark } from "./Logo";
import { Message } from "./Message";
import { cn } from "../lib/cn";

interface ChatTranscriptProps {
  ready: boolean;
  hasWorkspace: boolean;
  onOpenSettings: () => void;
  onEdit: (messageId: string, text: string) => void;
  onRetry: () => void;
}

export const ChatTranscript = memo(function ChatTranscript({
  ready,
  hasWorkspace,
  onOpenSettings,
  onEdit,
  onRetry,
}: ChatTranscriptProps) {
  const t = useT();
  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const lastError = useStore((s) => s.lastError);
  const setLastError = useStore((s) => s.setLastError);
  const scrollRef = useRef<HTMLDivElement>(null);

  const session = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );
  const messages = session?.messages ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full px-3 py-4">
        {messages.length === 0 ? (
          <EmptyChat
            ready={ready}
            hasWorkspace={hasWorkspace}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <Message key={m.id} message={m} onEdit={onEdit} />
            ))}
          </div>
        )}

        {lastError && lastError.sessionId === activeSessionId && (
          <div className="alert anim-in mt-3 flex-col items-stretch">
            <div className="flex items-start gap-2">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{t("errorRequestFailed")}</div>
                <p className="mt-1 break-words text-[length:var(--fs-sm)] opacity-90">
                  {lastError.message}
                </p>
              </div>
              <button
                className="icon-btn h-5 w-5 shrink-0"
                title={t("errorDismiss")}
                onClick={() => setLastError(undefined)}
              >
                <X size={12} />
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-sm btn-secondary" onClick={onRetry}>
                <RotateCcw size={13} />
                {t("retry")}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onOpenSettings}>
                {t("errorCheckSettings")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

/** Empty transcript: brand, plus whichever setup step is still missing. */
function EmptyChat({
  ready,
  hasWorkspace,
  onOpenSettings,
}: {
  ready: boolean;
  hasWorkspace: boolean;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const setSidePanel = useStore((s) => s.setSidePanel);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center px-1 text-center">
      <LogoMark size={52} className="opacity-90" />
      <p className="mt-4 max-w-[300px] text-[length:var(--fs-base)] leading-relaxed text-[var(--color-text-dim)]">
        {ready ? t("emptyReady") : t("stepConnectText")}
      </p>

      <div className="mt-5 w-full space-y-2 text-left">
        {!ready && (
          <button className="card" onClick={onOpenSettings}>
            <span className="step-chip">1</span>
            <span className="min-w-0">
              <span className="card-title">{t("stepConnectTitle")}</span>
              <span className="card-text">{t("stepConnectAction")}</span>
            </span>
          </button>
        )}
        {!hasWorkspace && (
          <button className="card" onClick={() => setSidePanel("explorer")}>
            <span className="step-chip" data-done={hasWorkspace}>
              2
            </span>
            <span className="min-w-0">
              <span className="card-title">{t("stepFolderTitle")}</span>
              <span className="card-text">{t("stepFolderAction")}</span>
            </span>
          </button>
        )}
      </div>

      {ready && hasWorkspace && (
        <p className={cn("mt-4 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]")}>
          {t("stepStartText")}
        </p>
      )}
    </div>
  );
}
