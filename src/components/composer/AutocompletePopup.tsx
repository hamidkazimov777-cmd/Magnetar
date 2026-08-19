import { useEffect, useRef } from "react";
import { FileCode2, Slash, CornerDownLeft } from "lucide-react";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";

export interface AutocompleteItem {
  /** Text inserted into the composer. */
  value: string;
  /** Primary label (file name or command). */
  label: string;
  /** Dimmed secondary line (directory or command description). */
  hint?: string;
}

/** Shared popup for `@` file mentions and `/` commands. Anchored above the
 *  composer, keyboard-driven, mirroring how Antigravity and Cursor do it. */
export function AutocompletePopup({
  kind,
  items,
  cursor,
  onPick,
  onHover,
}: {
  kind: "file" | "command";
  items: AutocompleteItem[];
  cursor: number;
  onPick: (item: AutocompleteItem) => void;
  onHover: (index: number) => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-[var(--r-lg)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[var(--e-3)]">
      <div className="section-label flex items-center gap-1.5 px-3">
        {kind === "file" ? <FileCode2 size={11} /> : <Slash size={11} />}
        {kind === "file" ? t("mentionFiles") : t("mentionCommands")}
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto p-1">
        {items.map((item, i) => (
          <button
            key={item.value}
            data-idx={i}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              // mousedown, not click: the textarea must not lose focus first.
              e.preventDefault();
              onPick(item);
            }}
            className={cn(
              "row h-8",
              i === cursor &&
                "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-[var(--color-accent-strong)]",
            )}
            title={item.hint ? `${item.label} — ${item.hint}` : item.label}
          >
            {kind === "file" ? (
              <FileCode2 size={13} className="shrink-0 opacity-70" />
            ) : (
              <Slash size={13} className="shrink-0 opacity-70" />
            )}
            <span className="shrink-0 font-medium">{item.label}</span>
            {item.hint && (
              <span className="truncate text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
                {item.hint}
              </span>
            )}
            {i === cursor && (
              <CornerDownLeft size={12} className="ml-auto shrink-0 opacity-60" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
