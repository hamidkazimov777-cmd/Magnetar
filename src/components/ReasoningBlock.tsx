import { useEffect, useRef, useState } from "react";
import { ChevronRight, Sparkles } from "./icons";
import { cn } from "../lib/cn";
import { useT } from "../lib/i18n";
import type { ChatMessage } from "../lib/types";

/** The model's thinking, shown the way a reader actually wants it: a single
 *  line while it is happening, expandable if you care, out of the way once the
 *  answer arrives.
 *
 *  Only some models expose this — Anthropic's extended thinking, DeepSeek and
 *  the reasoning models on OpenRouter. For everything else there is nothing to
 *  render and the block does not appear at all. */
export function ReasoningBlock({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the text while it is being written, but never fight the user: once
  // they collapse it, or the answer starts, we stop steering.
  useEffect(() => {
    if (open && streaming && bodyRef.current)
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [message.reasoning, open, streaming]);

  if (!message.reasoning?.trim()) return null;

  const thinking = streaming && !message.content;
  const seconds = message.thinkingMs ? Math.round(message.thinkingMs / 1000) : 0;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-[var(--r-sm)] px-1.5 py-1 text-[length:var(--fs-xs)] transition-colors",
          "text-[var(--color-text-mute)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-dim)]",
        )}
      >
        <ChevronRight
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
        {/* Violet marks AI state everywhere in this product; thinking is the
            purest case of it. Pulses only while the thought is still forming. */}
        <Sparkles
          size={11}
          className={cn(
            "shrink-0 text-[var(--color-ai)]",
            thinking && "animate-pulse",
          )}
        />
        <span className="font-medium">
          {thinking
            ? t("reasoningThinking")
            : seconds > 0
              ? t("reasoningTookSec", { n: String(seconds) })
              : t("reasoningTitle")}
        </span>
      </button>

      {open && (
        <div
          ref={bodyRef}
          // A rule down the left side and italic, dimmer type: unmistakably a
          // side channel, never mistaken for the answer itself.
          className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words border-l-2 border-[color-mix(in_srgb,var(--color-ai)_35%,transparent)] py-0.5 pl-3 pr-1 text-[length:var(--fs-xs)] italic leading-[var(--lh-relaxed)] text-[var(--color-text-mute)]"
        >
          {message.reasoning}
        </div>
      )}
    </div>
  );
}

/** One quiet line under a finished answer: how long it took, what it cost.
 *  Providers that do not report usage simply show the duration. */
export function TurnStats({ message }: { message: ChatMessage }) {
  const t = useT();
  const parts: string[] = [];

  if (message.durationMs && message.durationMs > 900)
    parts.push(t("statsSeconds", { n: String(Math.round(message.durationMs / 1000)) }));

  const inTok = message.usage?.inputTokens;
  const outTok = message.usage?.outputTokens;
  if (inTok || outTok)
    parts.push(t("statsTokens", { n: String((inTok ?? 0) + (outTok ?? 0)) }));

  if (message.thinkingMs && message.thinkingMs > 900)
    parts.push(
      t("statsThought", { n: String(Math.round(message.thinkingMs / 1000)) }),
    );

  if (parts.length === 0) return null;
  return (
    <span
      className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]"
      title={
        inTok || outTok ? `in ${inTok ?? "?"} · out ${outTok ?? "?"}` : undefined
      }
    >
      {parts.join(" · ")}
    </span>
  );
}
