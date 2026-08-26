import { memo, useEffect, useMemo, useRef } from "react";
import { TriangleAlert, X, RotateCcw } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

  // The error banner rides as a footer item so it stays below the last message
  // and participates in the same auto-scroll.
  const activeError =
    lastError?.sessionId === activeSessionId ? lastError : undefined;
  const itemCount = messages.length + (activeError ? 1 : 0);

  // Messages have variable height (markdown, code blocks, reasoning, tool
  // traces), so each row is measured as it enters the window.
  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    overscan: 8,
    getItemKey: (index) =>
      index < messages.length ? messages[index].id : "__chat-error__",
  });

  // Follow the newest message, but never fight the user: only stay pinned while
  // they are already at the bottom. Once they scroll up to read — even mid-run,
  // while the agent is streaming — we stop steering, so the view holds still.
  const stick = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  // Sending a new message always snaps back to the bottom, even if they had
  // scrolled up in the previous turn.
  const lastRole = messages[messages.length - 1]?.role;
  if (lastRole === "user") stick.current = true;

  useEffect(() => {
    if (itemCount > 0 && stick.current)
      virtualizer.scrollToIndex(itemCount - 1, { align: "end" });
  }, [messages, activeError, itemCount, virtualizer]);

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      {messages.length === 0 ? (
        <div className="w-full px-3 py-4">
          <EmptyChat
            ready={ready}
            hasWorkspace={hasWorkspace}
            onOpenSettings={onOpenSettings}
          />
          {activeError && (
            <ErrorBanner
              message={activeError.message}
              onRetry={onRetry}
              onOpenSettings={onOpenSettings}
              onDismiss={() => setLastError(undefined)}
            />
          )}
        </div>
      ) : (
        <div className="w-full px-3 py-4">
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const isError = vi.index >= messages.length;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <div className="pb-4">
                    {isError ? (
                      activeError && (
                        <ErrorBanner
                          message={activeError.message}
                          onRetry={onRetry}
                          onOpenSettings={onOpenSettings}
                          onDismiss={() => setLastError(undefined)}
                        />
                      )
                    ) : (
                      <Message message={messages[vi.index]} onEdit={onEdit} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

/** Retryable error banner shown below the last message (or alone when empty). */
function ErrorBanner({
  message,
  onRetry,
  onOpenSettings,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div className="alert anim-in mt-3 flex-col items-stretch">
      <div className="flex items-start gap-2">
        <TriangleAlert size={15} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t("errorRequestFailed")}</div>
          <p className="mt-1 break-words text-[length:var(--fs-sm)] opacity-90">
            {message}
          </p>
        </div>
        <button
          className="icon-btn h-5 w-5 shrink-0"
          title={t("errorDismiss")}
          onClick={onDismiss}
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
  );
}

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
