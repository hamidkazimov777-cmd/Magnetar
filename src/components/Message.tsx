import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import type { ChatMessage } from "../lib/types";

/** A code block with a copy button, used inside the markdown renderer. */
function Pre({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = ref.current?.innerText ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="group/code relative">
      <button
        onClick={copy}
        className="absolute right-2 top-2 z-10 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]/80 p-1.5 text-[var(--color-text-dim)] opacity-0 transition group-hover/code:opacity-100 hover:text-[var(--color-text)]"
        title="Copy"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className={cn("group flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div className={cn("max-w-[85%]", isUser ? "items-end" : "w-full")}>
        <div
          className={cn(
            "prose-chat rounded-2xl px-4 py-3 text-[15px]",
            isUser
              ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
              : "bg-transparent text-[var(--color-text)]",
          )}
        >
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{ pre: Pre }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (
            <span className="inline-flex gap-1 text-[var(--color-text-dim)]">
              <Dot /> <Dot delay={150} /> <Dot delay={300} />
            </span>
          )}
        </div>

        {!isUser && message.content && (
          <div className="mt-1 flex items-center gap-2 px-4 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={copyAll}
              className="flex items-center gap-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            {message.model && (
              <span className="text-xs text-[var(--color-text-dim)]/70">
                {message.model}
              </span>
            )}
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
