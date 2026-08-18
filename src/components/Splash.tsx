import { useEffect, useMemo, useState } from "react";
import { LogoMark } from "./Logo";
import { cn } from "../lib/cn";

/** Cosmic welcome screen shown when the app opens. Auto-dismisses; click to skip. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  const finish = () => {
    setLeaving(true);
    setTimeout(onDone, 550);
  };

  useEffect(() => {
    const t = setTimeout(finish, 2800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stars = useMemo(
    () =>
      Array.from({ length: 60 }, () => ({
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: Math.random() * 1.8 + 0.6,
        delay: Math.random() * 2.4,
      })),
    [],
  );

  return (
    <div
      className={cn("splash-root", leaving && "splash-leaving")}
      onClick={finish}
    >
      {stars.map((s, i) => (
        <span
          key={i}
          className="splash-star"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      <div className="splash-ring" />
      <div className="splash-ring d" />

      <div className="splash-center">
        <LogoMark size={140} className="splash-mark" />
        <div className="splash-word">
          <div
            className="font-light uppercase text-[var(--color-text)]"
            style={{ letterSpacing: "0.42em", fontSize: "1.7rem" }}
          >
            Magnetar
          </div>
          <div
            className="splash-tag mt-2 text-[11px] uppercase text-[var(--color-text-dim)]"
            style={{ letterSpacing: "0.34em" }}
          >
            Your AI Command Center
          </div>
        </div>
      </div>
    </div>
  );
}
