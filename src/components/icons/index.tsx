/** Magnetar's own icon set.
 *
 *  A coherent, hand-built glyph language for the product's signature surfaces —
 *  so the chrome reads as *this* environment, not a generic 2025 AI app dressed
 *  in an off-the-shelf icon pack. One grid (24), one stroke rhythm (rounded
 *  caps/joins), geometric and quiet, at home in the monochrome/graphite theme.
 *
 *  The component API matches lucide's (`size`, `strokeWidth`, `className`, plus
 *  any SVG prop) so these drop into existing call sites unchanged. */

import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  size?: number | string;
  strokeWidth?: number | string;
}

/** Shared frame: currentColor stroke, no fill, rounded joins. */
function Glyph({
  size = 24,
  strokeWidth = 2,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

/** The type these icons satisfy — usable wherever a lucide icon component was. */
export type IconType = (props: IconProps) => React.ReactElement;

/* -- Mode selector ------------------------------------------------------- */

/** Discussion: two conversation bubbles, offset — a dialogue, not one voice. */
export const Discussion: IconType = (p) => (
  <Glyph {...p}>
    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h7A2.5 2.5 0 0 1 15 6.5v3A2.5 2.5 0 0 1 12.5 12H7l-4 3v-3.2A2.5 2.5 0 0 1 3 9.5z" />
    <path d="M9 14.2v.3A2.5 2.5 0 0 0 11.5 17H16l3 2.5V17h-.5" />
  </Glyph>
);

/** Agent: a compact head with an antenna spark — an actor, not a chat. */
export const Agent: IconType = (p) => (
  <Glyph {...p}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v4" />
    <circle cx="12" cy="3.2" r="1.1" />
    <path d="M9 12.5v2M15 12.5v2" />
  </Glyph>
);

/** Generation: a four-point spark — the universal "make something new". */
export const Generation: IconType = (p) => (
  <Glyph {...p}>
    <path d="M12 3c.3 4.2 1.5 5.4 5.7 5.7C13.5 9 12.3 10.2 12 14.4 11.7 10.2 10.5 9 6.3 8.7 10.5 8.4 11.7 7.2 12 3Z" />
    <path d="M18.5 14.5c.15 2 .7 2.55 2.7 2.7-2 .15-2.55.7-2.7 2.7-.15-2-.7-2.55-2.7-2.7 2-.15 2.55-.7 2.7-2.7Z" />
  </Glyph>
);

/* -- Hints toggle -------------------------------------------------------- */

export const Info: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
  </Glyph>
);

/* -- Code group ---------------------------------------------------------- */

/** Explorer: two stacked pages. */
export const Files: IconType = (p) => (
  <Glyph {...p}>
    <path d="M9 3h5l5 5v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5" />
    <path d="M7 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2" />
  </Glyph>
);

export const Search: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.7-4.7" />
  </Glyph>
);

/** Git: two nodes, one branching off. */
export const Git: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="6.5" cy="5" r="2.2" />
    <circle cx="6.5" cy="19" r="2.2" />
    <circle cx="17.5" cy="8" r="2.2" />
    <path d="M6.5 7.2v9.6" />
    <path d="M17.5 10.2v.8a4 4 0 0 1-4 4H8" />
  </Glyph>
);

/** Problems: a bolt — something to look at now. */
export const Problems: IconType = (p) => (
  <Glyph {...p}>
    <path d="M13 3 5 13.2h5.2L10 21l8-10.2h-5.2z" />
  </Glyph>
);

/** Changes: a reverse arc — the run's edits, revertable. */
export const Changes: IconType = (p) => (
  <Glyph {...p}>
    <path d="M4 5v4h4" />
    <path d="M4.5 9a8 8 0 1 1-1.2 5" />
    <path d="M12 8v4.3l3 1.8" />
  </Glyph>
);

/* -- Project group ------------------------------------------------------- */

/** Project memory: a chip — context the whole product plugs into. */
export const Memory: IconType = (p) => (
  <Glyph {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
  </Glyph>
);

/** Chats: a single bubble with lines — the conversation list. */
export const Chats: IconType = (p) => (
  <Glyph {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" />
    <path d="M8 8.5h8M8 12h5" />
  </Glyph>
);

/* -- Bottom rail --------------------------------------------------------- */

export const Projects: IconType = (p) => (
  <Glyph {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Glyph>
);

/** Subscriptions: a globe — the outside web. */
export const Globe: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9Z" />
  </Glyph>
);

export const Sun: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </Glyph>
);

export const Moon: IconType = (p) => (
  <Glyph {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
  </Glyph>
);

export const Monitor: IconType = (p) => (
  <Glyph {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </Glyph>
);

/** Language: an "A" and a stroke mark, sharing a baseline — translate. */
export const Languages: IconType = (p) => (
  <Glyph {...p}>
    <path d="M4 17 8 7l4 10M5.4 13.5h5.2" />
    <path d="M14 10h6M17 10v1c0 3-1.6 5.6-4 7M15 13.5c.6 2 2.2 3.7 4.5 4.5" />
  </Glyph>
);

/** Guide: an open book. */
export const Guide: IconType = (p) => (
  <Glyph {...p}>
    <path d="M12 6C10.5 4.8 8.5 4 6 4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1c2.5 0 4.5.8 6 2 1.5-1.2 3.5-2 6-2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1c-2.5 0-4.5.8-6 2Z" />
    <path d="M12 6v14" />
  </Glyph>
);

/** Keys: a round-bow key. */
export const Keys: IconType = (p) => (
  <Glyph {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.2 11.2 20 20M17 17l2-2M15 15l1.5-1.5" />
  </Glyph>
);

/** Settings: sliders — controls you tune, cleaner than a gear at this size. */
export const Settings: IconType = (p) => (
  <Glyph {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.4" />
    <circle cx="8" cy="17" r="2.4" />
  </Glyph>
);

export const Check: IconType = (p) => (
  <Glyph {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Glyph>
);
