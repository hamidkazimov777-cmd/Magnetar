import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, FileText, Pencil, X } from "lucide-react";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { AgentTrace } from "./AgentTrace";
import { ReasoningBlock, TurnStats } from "./ReasoningBlock";
import type { ChatMessage } from "../lib/types";

/** A code block with a copy button, used inside the markdown renderer. */
function Pre({ children }: { children?: React.ReactNode }) {
  const t = useT();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the code is still selectable */
    }
  };
  return (
    <div className="group/code relative">
      <button
        onClick={copy}
        title={copied ? t("copied") : t("copy")}
        className="absolute right-2 top-2 z-10 rounded-[var(--r-sm)] border border-[var(--color-border)] bg-[var(--color-surface)]/85 p-1.5 text-[var(--color-text-dim)] opacity-0 transition group-hover/code:opacity-100 hover:text-[var(--color-text)]"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export function Message({
  message,
  onEdit,
}: {
  message: ChatMessage;
  /** Resend this turn with new wording; everything after it is discarded. */
  onEdit?: (messageId: string, text: string) => void;
}) {
  const t = useT();
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const trace = useStore((s) => s.agentTrace[message.id]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const isPending = !message.content && !trace?.length && !message.reasoning;

  if (editing)
    return (
      <div className="flex w-full justify-end">
        <div className="w-full max-w-[92%]">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim()) onEdit?.(message.id, draft.trim());
                setEditing(false);
              }
              if (e.key === "Escape") {
                setDraft(message.content);
                setEditing(false);
              }
            }}
            rows={Math.min(10, draft.split("\n").length + 1)}
            className="input text-[length:var(--fs-md)]"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
            >
              <X size={13} />
              {t("cancel")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!draft.trim() || draft.trim() === message.content}
              onClick={() => {
                onEdit?.(message.id, draft.trim());
                setEditing(false);
              }}
            >
              {t("editResend")}
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0", isUser ? "max-w-[92%]" : "w-full")}>
        <div
          className={cn(
            "prose-chat rounded-[var(--r-lg)] text-[length:var(--fs-md)]",
            isUser
              ? "bg-[var(--color-surface-2)] px-3.5 py-2.5 text-[var(--color-text)]"
              : "bg-transparent",
          )}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <div
                  key={a.id}
                  className="overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)]"
                  title={a.name}
                >
                  {a.type === "image" && a.data ? (
                    <img
                      src={`data:${a.mimeType};base64,${a.data}`}
                      alt={a.name}
                      className="max-h-44 max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex items-center gap-2 bg-[var(--color-surface-2)] px-3 py-2">
                      <FileText size={15} className="shrink-0 text-[var(--color-text-dim)]" />
                      <span className="truncate text-[length:var(--fs-base)]">{a.name}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Thinking first, then the run's steps, then the answer — the order
              things actually happened in. */}
          {!isUser && <ReasoningBlock message={message} streaming={isPending || !message.content} />}

          {!isUser && trace && trace.length > 0 && <AgentTrace events={trace} />}

          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{ pre: Pre }}
            >
              {message.content}
            </ReactMarkdown>
          ) : isPending ? (
            <span className="inline-flex gap-1 text-[var(--color-text-dim)]">
              <Dot /> <Dot delay={150} /> <Dot delay={300} />
            </span>
          ) : null}
        </div>

        {isUser && onEdit && (
          <div className="mt-1 flex justify-end opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              className="flex items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-text-mute)] hover:text-[var(--color-text)]"
            >
              <Pencil size={11} />
              {t("edit")}
            </button>
          </div>
        )}

        {!isUser && message.content && (
          <div className="mt-1 flex items-center gap-2.5 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={copyAll}
              className="flex items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? t("copied") : t("copy")}
            </button>
            {message.model && (
              <span className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                {message.model}
              </span>
            )}
            <TurnStats message={message} />
          </div>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
