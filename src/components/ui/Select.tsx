import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "../icons";
import { cn } from "../../lib/cn";

/** The app's own dropdown. A native <select> renders as a stray macOS control
 *  against the monochrome chrome — this is the single styled replacement used
 *  everywhere a picker is needed (studio, settings, …). */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  up,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Open the menu upward (for pickers anchored near the bottom of the view). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={cn("relative", open && "z-40", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[length:var(--fs-sm)] text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {current?.label ?? (
            <span className="text-[var(--color-text-mute)]">{placeholder ?? "—"}</span>
          )}
        </span>
        <ChevronDown size={13} className="shrink-0 text-[var(--color-text-mute)]" />
      </button>
      {open && !disabled && (
        <div className={cn(
          "anim-in absolute left-0 z-30 max-h-64 w-full overflow-auto rounded-[var(--r-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-[var(--e-3)]",
          up ? "bottom-full mb-1" : "top-full mt-1",
        )}>
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
              {placeholder ?? "—"}
            </div>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left text-[length:var(--fs-sm)] hover:bg-[var(--color-surface-2)]"
            >
              {/* Full name — long ids (fal models, model slugs) must stay
                  readable to tell one variant from another. */}
              <span className="min-w-0 flex-1 break-all">{o.label}</span>
              {o.value === value && (
                <Check size={12} className="mt-0.5 shrink-0 text-[var(--color-ai)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
