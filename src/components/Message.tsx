import { cn } from "../lib/cn";
import type { ChatMessage } from "../lib/types";

/** Very small markdown-ish renderer: fenced code blocks + paragraphs. Keeps the
 *  MVP dependency-free; a full markdown lib can slot in later. */
function renderContent(text: string) {
  const parts = text.split(/```/);
  return parts.map((part, i) => {
    // Odd indices are inside a fence.
    if (i % 2 === 1) {
      const nl = part.indexOf("\n");
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      return (
        <pre key={i}>
          <code>{code}</code>
        </pre>
      );
    }
    return part.split(/\n{2,}/).map((para, j) =>
      para.trim() ? <p key={`${i}-${j}`}>{para}</p> : null,
    );
  });
}

export function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "prose-chat max-w-[85%] rounded-2xl px-4 py-3 text-[15px]",
          isUser
            ? "bg-[var(--color-surface-2)] text-[var(--color-text)]"
            : "bg-transparent text-[var(--color-text)]",
        )}
      >
        {message.content ? (
          renderContent(message.content)
        ) : (
          <span className="inline-flex gap-1 text-[var(--color-text-dim)]">
            <Dot /> <Dot delay={150} /> <Dot delay={300} />
          </span>
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
