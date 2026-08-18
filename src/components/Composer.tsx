import { useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
}: {
  disabled?: boolean;
  streaming?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-5">
      <div
        className={cn(
          "flex items-end gap-2 rounded-2xl border border-[var(--color-border)]",
          "bg-[var(--color-surface)] px-3 py-2.5 shadow-lg",
          "focus-within:border-[var(--color-accent)]",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? t("addConnFirst") : t("messagePlaceholder")}
          onChange={(e) => {
            setText(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[220px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)] disabled:opacity-60"
        />
        {streaming ? (
          <button
            onClick={onStop}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text)] hover:opacity-80"
            title="Stop"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={disabled || !text.trim()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition disabled:cursor-not-allowed disabled:opacity-30"
            title="Send"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-[var(--color-text-dim)]">
        {t("sendHint")}
      </p>
    </div>
  );
}
