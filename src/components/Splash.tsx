import { useEffect, useState } from "react";

/** Launch screen: the mark draws itself like an invisible pen inking a line —
 *  the thin diagonal beam first, then the main form — then the shape fills in,
 *  and the name fades up. One continuous gesture that then dissolves smoothly
 *  into the app — no idle pause, no hard cut. Click to skip. */
export function Splash({ onDone }: { onDone: () => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Start fading the moment the mark is inked (~1.3s), then hand off once the
    // fade finishes — so there is no dead time sitting on a finished logo.
    const fade = setTimeout(() => setExiting(true), 1300);
    const done = setTimeout(onDone, 1600);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div
      className="splash-root"
      data-exiting={exiting}
      onClick={onDone}
      data-tauri-drag-region
    >
      <div className="splash-center">
        <svg
          className="splash-mark"
          viewBox="0 0 600 338"
          role="img"
          aria-label="Magnetar"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="translate(0,338) scale(0.1,-0.1)">
            {/* Path order = draw order: the thin diagonal beam leads. */}
            <path
              className="p1"
              pathLength={1}
              d="M5464 2921 c-148 -87 -467 -279 -709 -426 -936 -570 -1433 -866 -1830 -1090 -516 -291 -1342 -717 -1825 -941 -264 -122 -313 -154 -318 -201 -2 -23 2 -34 15 -41 84 -44 301 -9 553 90 132 52 639 309 912 461 606 340 1053 616 1773 1097 598 400 1736 1208 1704 1210 -3 0 -126 -71 -275 -159z"
            />
            <path
              className="p2"
              pathLength={1}
              d="M2850 2210 c-61 -11 -95 -36 -277 -208 -786 -743 -1069 -999 -1620 -1467 -78 -66 -140 -121 -138 -123 5 -5 842 415 1155 580 272 144 807 435 1010 550 l95 54 3 217 c3 242 -3 279 -50 333 -49 56 -106 76 -178 64z"
            />
            <path
              className="p3"
              pathLength={1}
              d="M4365 1864 c-51 -13 -98 -39 -365 -204 -157 -97 -368 -228 -470 -290 -401 -245 -796 -490 -815 -504 -18 -13 -16 -14 25 -6 25 5 266 50 535 100 270 50 537 100 595 110 58 11 111 20 117 20 10 0 13 -85 15 -374 l3 -375 313 176 313 175 -3 522 -3 522 -27 41 c-16 25 -44 49 -71 62 -45 22 -125 34 -162 25z"
            />
          </g>
        </svg>
        <div className="splash-word wordmark">Magnetar</div>
      </div>
    </div>
  );
}
