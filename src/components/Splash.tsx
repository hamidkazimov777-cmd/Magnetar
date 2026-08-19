import { useEffect } from "react";
import { LogoMark } from "./Logo";

/** Launch screen: the mark and the name on a flat ground, nothing else.
 *  No animation, no particles — it exists to hold the frame while the
 *  workspace mounts, then gets out of the way. Click to skip. */
export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1100);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="splash-root" onClick={onDone} data-tauri-drag-region>
      <div className="splash-center">
        <LogoMark size={132} />
        <div className="splash-word">Magnetar</div>
      </div>
    </div>
  );
}
