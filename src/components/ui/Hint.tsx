import { useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../lib/store";

/** Learn mode tooltip.
 *
 *  Half of this product's behaviour is conditional — memory fills on a model
 *  switch, decisions after ten messages, the agent needs a folder. Those rules
 *  cannot live in a `title` attribute and should not clutter the interface for
 *  someone who already knows them. So they live here, behind the "i" toggle:
 *  off, this renders its child untouched; on, hovering explains the control.
 *
 *  Rendered through a portal so panel overflow never clips it. */
export function Hint({
  text,
  side = "right",
  children,
}: {
  text: string;
  side?: "right" | "left" | "top" | "bottom";
  children: ReactElement;
}) {
  const on = useStore((s) => s.hintsOn);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  if (!on) return children;

  const show = () => {
    const r = ref.current?.firstElementChild?.getBoundingClientRect();
    if (!r) return;
    const GAP = 8;
    const W = 260;
    let left = r.right + GAP;
    let top = r.top;
    if (side === "left") left = r.left - W - GAP;
    if (side === "top" || side === "bottom") {
      left = Math.max(8, r.left + r.width / 2 - W / 2);
      top = side === "top" ? r.top - GAP : r.bottom + GAP;
    }
    // Keep the card inside the window on both axes.
    left = Math.min(Math.max(8, left), window.innerWidth - W - 8);
    top = Math.min(Math.max(8, top), window.innerHeight - 90);
    setPos({ top, left });
  };

  return (
    <>
      <span
        ref={ref}
        className="contents"
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: pos.top, left: pos.left, width: 260 }}
            className="pointer-events-none fixed z-[200] rounded-[var(--r-md)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[length:var(--fs-xs)] leading-[var(--lh-base)] text-[var(--color-text)] shadow-[var(--e-3)]"
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
