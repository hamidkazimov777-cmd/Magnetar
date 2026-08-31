import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Bot, Check, Copy, FileText, Pencil, X } from "./icons";
import { cn } from "../lib/cn";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { AgentTrace } from "./AgentTrace";
import { ReasoningBlock, TurnStats } from "./ReasoningBlock";
import { acceptProposal, extractProposal, rejectProposal, stripProposalTags } from "../lib/proposal";
import { loadBytes } from "../lib/attachments";
import type { Attachment, ChatMessage } from "../lib/types";

function extractMagnetarPrompt(content: string): string | null {
  const m = content.match(/<MagnetarPrompt>([\s\S]*?)<\/MagnetarPrompt>/i);
  return m ? m[1].trim() : null;
}

function stripMagnetarPromptTags(content: string): string {
  return content.replace(/<\/?MagnetarPrompt>/gi, "");
}

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

export const Message = memo(function Message({
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
  const inChatTrack = useStore((s) => s.activeTrack === "chat");
  // The project this message belongs to, and whether it carries a proposal. The
  // derived string selector keeps the memoized Message from re-rendering on
  // every append — it only fires when the project actually changes.
  const projectId = useStore(
    (s) =>
      s.sessions.find((x) => x.id === s.activeSessionId)?.projectId ??
      s.activeProjectId,
  );
  const proposals = useStore((s) => (projectId ? s.proposals[projectId] : undefined));
  const proposal = !isUser && message.content ? extractProposal(message.content) : null;
  const proposalRecord = proposal && projectId
    ? proposals?.find((p) => p.messageId === message.id)
    : undefined;
    
  const generatedPrompt = !isUser && message.content ? extractMagnetarPrompt(message.content) : null;
  
  let renderedContent = message.content;
  if (!isUser) {
    renderedContent = stripProposalTags(renderedContent);
    renderedContent = stripMagnetarPromptTags(renderedContent);
  }

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(renderedContent);
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
                  {a.type === "image" ? (
                    <AttachedImage attachment={a} />
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
            // In the agent track the assistant's prose is its working voice —
            // narrating what it is doing between steps — not a chat answer, so
            // it reads in italic (code stays upright). The discussion track is a
            // real conversation and stays normal.
            <div className={cn(!isUser && !inChatTrack && "agent-say")}>
              {renderedContent && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{ pre: Pre }}
                >
                  {renderedContent}
                </ReactMarkdown>
              )}
              {generatedPrompt && (
                <div className="mt-3 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <div className="mb-2 text-[length:var(--fs-xs)] font-medium text-[var(--color-text-mute)] uppercase tracking-wide">
                    {t("promptGenerated")}
                  </div>
                  <div className="prose-chat mb-3 text-[length:var(--fs-md)]">
                    <pre className="whitespace-pre-wrap break-words rounded-[var(--r-sm)] bg-[var(--color-surface-2)] p-2">
                      {generatedPrompt}
                    </pre>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(generatedPrompt)}
                      className="btn btn-secondary btn-sm"
                    >
                      <Copy size={13} className="mr-1.5" />
                      {t("copy")}
                    </button>
                    <button
                      onClick={() => useStore.getState().requestStudioPrompt(generatedPrompt)}
                      className="btn btn-primary btn-sm"
                    >
                      {t("promptSendToStudio")}
                    </button>
                  </div>
                </div>
              )}
            </div>
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
            {/* Only in the discussion track: the whole point of talking a task
                through here is handing the result to the agent. It lands in the
                composer rather than being sent — a prompt is almost always
                worth one edit before it runs. */}
            {inChatTrack && (
              <button
                onClick={() => {
                  const st = useStore.getState();
                  st.switchTrack("agent");
                  st.requestPrompt(renderedContent);
                }}
                className="flex items-center gap-1 text-[length:var(--fs-xs)] text-[var(--color-ai)] hover:opacity-80"
                title={t("sendToAgentHint")}
              >
                <Bot size={12} />
                {t("sendToAgent")}
              </button>
            )}
            {message.model && (
              <span className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                {message.model}
              </span>
            )}
            <TurnStats message={message} />
          </div>
        )}

        {proposal && projectId && (
          <div className="mt-2">
            {proposalRecord ? (
              <div className="flex flex-col gap-1 text-[length:var(--fs-xs)]">
                <span className="text-[var(--color-text-mute)]">
                  {proposalRecord.status === "accepted"
                    ? t("proposalAccepted")
                    : t("proposalRejected")}
                </span>
                {proposalRecord.review && (
                  <span className="whitespace-pre-wrap text-[var(--color-text-dim)]">
                    {proposalRecord.review}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => acceptProposal(message.id, proposal, projectId)}
                  className="btn btn-sm btn-primary"
                >
                  {t("addToMemory")}
                </button>
                <button
                  onClick={() => rejectProposal(message.id, proposal, projectId)}
                  className="btn btn-sm btn-ghost"
                >
                  {t("reject")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}


/** An attached image, fetched only when it is on screen.
 *
 *  A reopened conversation carries the attachment's metadata, not its bytes —
 *  loading every image anyone ever attached at startup would be paid for on
 *  every launch to show the handful that are actually scrolled to.
 *
 *  A missing file is not an error to shout about: someone who cleared the
 *  folder should still be able to read the conversation, with the attachment
 *  shown as gone rather than as a broken image.
 */
function AttachedImage({ attachment }: { attachment: Attachment }) {
  const t = useT();
  const [data, setData] = useState<string | null>(attachment.data ?? null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    void loadBytes(attachment).then((bytes) => {
      if (cancelled) return;
      if (bytes) setData(bytes);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment, data]);

  if (data)
    return (
      <img
        src={`data:${attachment.mimeType};base64,${data}`}
        alt={attachment.name}
        className="max-h-44 max-w-full object-contain"
      />
    );

  if (attachment.path && !missing)
    return (
      <img
        src={attachment.path}
        alt={attachment.name}
        className="max-h-44 max-w-full object-contain"
      />
    );

  return (
    <div className="flex items-center gap-2 bg-[var(--color-surface-2)] px-3 py-2">
      <FileText size={15} className="shrink-0 text-[var(--color-text-dim)]" />
      <span className="truncate text-[length:var(--fs-base)] text-[var(--color-text-dim)]">
        {missing ? t("attachmentMissing").replace("{name}", attachment.name) : attachment.name}
      </span>
    </div>
  );
}
