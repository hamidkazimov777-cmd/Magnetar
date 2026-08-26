/** Magnetar's own icon set — a drop-in replacement for lucide-react.
 *
 *  A coherent, hand-built glyph language for the whole product, so the chrome
 *  reads as *this* environment rather than a generic AI app in an off-the-shelf
 *  icon pack. One grid (24), one stroke rhythm (2px, rounded caps/joins),
 *  geometric and quiet, at home in the monochrome / graphite theme.
 *
 *  Every export matches the lucide name it replaces, and the component API
 *  matches lucide's (`size`, `strokeWidth`, `className`, plus any SVG prop), so
 *  a call site switches over just by changing its import source. */

import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "stroke"> {
  size?: number | string;
  strokeWidth?: number | string;
}

/** The type these icons satisfy — usable wherever a lucide icon component was. */
export type IconType = (props: IconProps) => React.ReactElement;

/** Shared frame: currentColor stroke, no fill, rounded joins. */
function G({
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

/* ======================================================================
   Navigation / modes
   ====================================================================== */

export const MessagesSquare: IconType = (p) => (
  <G {...p}>
    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h7A2.5 2.5 0 0 1 15 6.5v3A2.5 2.5 0 0 1 12.5 12H7l-4 3v-3.2A2.5 2.5 0 0 1 3 9.5z" />
    <path d="M9 14.2v.3A2.5 2.5 0 0 0 11.5 17H16l3 2.5V17h-.5" />
  </G>
);
export const Bot: IconType = (p) => (
  <G {...p}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4v4" />
    <circle cx="12" cy="3.2" r="1.1" />
    <path d="M9 12.5v2M15 12.5v2" />
  </G>
);
export const Clapperboard: IconType = (p) => (
  <G {...p}>
    <path d="M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M4 9 5.2 4.6a1 1 0 0 1 1.2-.7l12.5 3.3a1 1 0 0 1 .7 1.2L20 9" />
    <path d="m8.5 4.8-1 3.6M13 5.9l-1 3.6" />
  </G>
);
export const MessageSquare: IconType = (p) => (
  <G {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" />
    <path d="M8 8.5h8M8 12h5" />
  </G>
);
export const MessageCircleQuestion: IconType = (p) => (
  <G {...p}>
    <path d="M20 11.5a8 8 0 0 1-11.5 7.2L4 20l1.3-4.5A8 8 0 1 1 20 11.5Z" />
    <path d="M10 9.2a2 2 0 1 1 2.7 1.9c-.5.2-.7.5-.7 1v.4" />
    <circle cx="12" cy="15.2" r="0.5" fill="currentColor" stroke="none" />
  </G>
);
export const MessageSquareCode: IconType = (p) => (
  <G {...p}>
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" />
    <path d="m10 8-2 2 2 2M14 8l2 2-2 2" />
  </G>
);

/* ======================================================================
   Code / project rail
   ====================================================================== */

export const Files: IconType = (p) => (
  <G {...p}>
    <path d="M9 3h5l5 5v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5" />
    <path d="M7 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2" />
  </G>
);
export const Search: IconType = (p) => (
  <G {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.7-4.7" />
  </G>
);
export const GitBranch: IconType = (p) => (
  <G {...p}>
    <circle cx="6.5" cy="5" r="2.2" />
    <circle cx="6.5" cy="19" r="2.2" />
    <circle cx="17.5" cy="8" r="2.2" />
    <path d="M6.5 7.2v9.6" />
    <path d="M17.5 10.2v.8a4 4 0 0 1-4 4H8" />
  </G>
);
export const GitCommit: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M3 12h5.8M15.2 12H21" />
  </G>
);
export const GitCompare: IconType = (p) => (
  <G {...p}>
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="18" cy="18" r="2.2" />
    <path d="M8.2 6H15a3 3 0 0 1 3 3v6.5" />
    <path d="M15.8 18H9a3 3 0 0 1-3-3V8.5" />
  </G>
);
export const Zap: IconType = (p) => (
  <G {...p}>
    <path d="M13 3 5 13.2h5.2L10 21l8-10.2h-5.2z" />
  </G>
);
export const History: IconType = (p) => (
  <G {...p}>
    <path d="M4 5v4h4" />
    <path d="M4.5 9a8 8 0 1 1-1.2 5" />
    <path d="M12 8v4.3l3 1.8" />
  </G>
);
export const BrainCircuit: IconType = (p) => (
  <G {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
  </G>
);
export const Brain: IconType = (p) => (
  <G {...p}>
    <path d="M12 5.5A2.5 2.5 0 0 0 7 5 3 3 0 0 0 4.5 9 3 3 0 0 0 5 15a2.5 2.5 0 0 0 3 3.5A2.5 2.5 0 0 0 12 19z" />
    <path d="M12 5.5A2.5 2.5 0 0 1 17 5a3 3 0 0 1 2.5 4 3 3 0 0 1-.5 6 2.5 2.5 0 0 1-3 3.5A2.5 2.5 0 0 1 12 19z" />
  </G>
);
export const FolderGit2: IconType = (p) => (
  <G {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="14" r="1.6" />
    <path d="M12 9.5v2.9M13.6 14H17" />
  </G>
);

/* ======================================================================
   Files & folders
   ====================================================================== */

export const File: IconType = (p) => (
  <G {...p}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5" />
  </G>
);
export const FileText: IconType = (p) => (
  <G {...p}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 16.5h4" />
  </G>
);
export const FileCode2: IconType = (p) => (
  <G {...p}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M14 3v5h5" />
    <path d="m10 12-2 2 2 2M14 12l2 2-2 2" />
  </G>
);
export const FilePenLine: IconType = (p) => (
  <G {...p}>
    <path d="M13 3H7a2 2 0 0 0-2 2v10" />
    <path d="M13 3v5h5" />
    <path d="M19 8v2.5" />
    <path d="M18.4 13.6 12 20H9v-3l6.4-6.4a1.4 1.4 0 0 1 2 2Z" />
  </G>
);
export const FilePlus2: IconType = (p) => (
  <G {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M12 12v5M9.5 14.5h5" />
  </G>
);
export const FileQuestion: IconType = (p) => (
  <G {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M10.3 12.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.5-.7 1v.3" />
    <circle cx="12" cy="17.6" r="0.5" fill="currentColor" stroke="none" />
  </G>
);
export const FileSearch: IconType = (p) => (
  <G {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M14 3v5h5" />
    <circle cx="15.5" cy="15.5" r="2.5" />
    <path d="m20 20-2.2-2.2" />
  </G>
);
export const FileCode2Alt: IconType = FileCode2;

export const Folder: IconType = (p) => (
  <G {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </G>
);
export const FolderOpen: IconType = (p) => (
  <G {...p}>
    <path d="M3 8V7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v.5" />
    <path d="m3.5 10.5 1.6 6a2 2 0 0 0 1.9 1.5h10a2 2 0 0 0 1.9-1.4l1.6-5a1 1 0 0 0-1-1.3H4.5a1 1 0 0 0-1 1.2Z" />
  </G>
);
export const FolderPlus: IconType = (p) => (
  <G {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </G>
);
export const FolderX: IconType = (p) => (
  <G {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="m10.5 12 4 4M14.5 12l-4 4" />
  </G>
);
export const FolderTree: IconType = (p) => (
  <G {...p}>
    <path d="M3 5.5a1.5 1.5 0 0 1 1.5-1.5h2l1.2 1.5H12a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 12 10.5H4.5A1.5 1.5 0 0 1 3 9z" />
    <path d="M3 14.5A1.5 1.5 0 0 1 4.5 13h2l1.2 1.5H12a1.5 1.5 0 0 1 1.5 1.5v2A1.5 1.5 0 0 1 12 19.5H4.5A1.5 1.5 0 0 1 3 18z" />
    <path d="M17 6.5h4M17 16.5h4M19 6.5v10" />
  </G>
);

/* ======================================================================
   Arrows & chevrons
   ====================================================================== */

export const ArrowRight: IconType = (p) => (
  <G {...p}>
    <path d="M4 12h15" />
    <path d="m13 6 6 6-6 6" />
  </G>
);
export const ArrowRightCircle: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h7M12 8.5l3.5 3.5L12 15.5" />
  </G>
);
export const ArrowUp: IconType = (p) => (
  <G {...p}>
    <path d="M12 20V5" />
    <path d="m6 11 6-6 6 6" />
  </G>
);
export const ArrowUpRight: IconType = (p) => (
  <G {...p}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </G>
);
export const ArrowDownToLine: IconType = (p) => (
  <G {...p}>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </G>
);
export const ArrowUpFromLine: IconType = (p) => (
  <G {...p}>
    <path d="M12 20V9" />
    <path d="m7 14 5-5 5 5" />
    <path d="M5 4h14" />
  </G>
);
export const ChevronDown: IconType = (p) => (
  <G {...p}>
    <path d="m5 9 7 7 7-7" />
  </G>
);
export const ChevronRight: IconType = (p) => (
  <G {...p}>
    <path d="m9 5 7 7-7 7" />
  </G>
);
export const CornerDownLeft: IconType = (p) => (
  <G {...p}>
    <path d="M20 5v6a3 3 0 0 1-3 3H5" />
    <path d="m9 10-4 4 4 4" />
  </G>
);
export const Undo2: IconType = (p) => (
  <G {...p}>
    <path d="M9 7 4 12l5 5" />
    <path d="M4 12h11a5 5 0 0 1 0 10h-2" />
  </G>
);
export const RotateCcw: IconType = (p) => (
  <G {...p}>
    <path d="M4 5v4h4" />
    <path d="M4.5 9a8 8 0 1 1-1.2 5" />
  </G>
);
export const RefreshCw: IconType = (p) => (
  <G {...p}>
    <path d="M20 6v4h-4" />
    <path d="M19.5 10a8 8 0 1 0-.5 6" />
  </G>
);
export const RefreshCcwDot: IconType = (p) => (
  <G {...p}>
    <path d="M4 6v4h4" />
    <path d="M4.5 10a8 8 0 1 1 .3 5.5" />
    <circle cx="12" cy="12" r="1.4" />
  </G>
);

/* ======================================================================
   Actions
   ====================================================================== */

export const Copy: IconType = (p) => (
  <G {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </G>
);
export const ClipboardPaste: IconType = (p) => (
  <G {...p}>
    <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
    <path d="M16 6h2a2 2 0 0 1 2 2v3M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </G>
);
export const Save: IconType = (p) => (
  <G {...p}>
    <path d="M5 4h11l3 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
    <path d="M8 4v4h6V4" />
    <rect x="8" y="13" width="8" height="7" rx="1" />
  </G>
);
export const Download: IconType = (p) => (
  <G {...p}>
    <path d="M12 4v10" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 19h14" />
  </G>
);
export const Trash2: IconType = (p) => (
  <G {...p}>
    <path d="M4 6.5h16" />
    <path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5" />
    <path d="M6 6.5 6.8 19a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 6.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </G>
);
export const Eraser: IconType = (p) => (
  <G {...p}>
    <path d="m4.5 14.5 6-6a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 18H8.5l-4-3.5Z" />
    <path d="M8.5 18H20" />
  </G>
);
export const Pencil: IconType = (p) => (
  <G {...p}>
    <path d="M15.5 5.5 18.5 8.5" />
    <path d="M4 20v-3L16 5a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6L7 20Z" />
  </G>
);
export const Replace: IconType = (p) => (
  <G {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 6h3a2 2 0 0 1 2 2v2M10 18H7a2 2 0 0 1-2-2v-2" />
  </G>
);
export const Plus: IconType = (p) => (
  <G {...p}>
    <path d="M12 5v14M5 12h14" />
  </G>
);
export const Minus: IconType = (p) => (
  <G {...p}>
    <path d="M5 12h14" />
  </G>
);
export const X: IconType = (p) => (
  <G {...p}>
    <path d="M6 6 18 18M18 6 6 18" />
  </G>
);
export const XIcon: IconType = X;
export const Play: IconType = (p) => (
  <G {...p}>
    <path d="M7 5.5v13l11-6.5z" />
  </G>
);
export const Square: IconType = (p) => (
  <G {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </G>
);
export const Command: IconType = (p) => (
  <G {...p}>
    <path d="M9 6.5A2.5 2.5 0 1 0 6.5 9H9zM15 6.5A2.5 2.5 0 1 1 17.5 9H15zM9 17.5A2.5 2.5 0 1 1 6.5 15H9zM15 17.5A2.5 2.5 0 1 0 17.5 15H15z" />
    <rect x="9" y="9" width="6" height="6" />
  </G>
);
export const MoreHorizontal: IconType = (p) => (
  <G {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </G>
);
export const Link2: IconType = (p) => (
  <G {...p}>
    <path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2" />
    <path d="M8 12h8" />
  </G>
);
export const ExternalLink: IconType = (p) => (
  <G {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
  </G>
);
export const Eye: IconType = (p) => (
  <G {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </G>
);
export const Ban: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </G>
);
export const Slash: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 16 16 8" />
  </G>
);

/* ======================================================================
   Status / alerts
   ====================================================================== */

export const Check: IconType = (p) => (
  <G {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </G>
);
export const CheckCheck: IconType = (p) => (
  <G {...p}>
    <path d="m2.5 13 4 4 8-9" />
    <path d="m12 15 1.5 1.5 8-9" />
  </G>
);
export const CheckCircle2: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 2.7 2.7L16 9" />
  </G>
);
export const Circle: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="8.5" />
  </G>
);
export const MinusCircle: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </G>
);
export const AlertCircle: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5" />
    <circle cx="12" cy="16.3" r="0.6" fill="currentColor" stroke="none" />
  </G>
);
export const Info: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
  </G>
);
export const AlertTriangle: IconType = (p) => (
  <G {...p}>
    <path d="M10.3 4.3 2.7 17.4A2 2 0 0 0 4.4 20.5h15.2a2 2 0 0 0 1.7-3.1L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4.2" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </G>
);
export const TriangleAlert: IconType = AlertTriangle;
export const ShieldAlert: IconType = (p) => (
  <G {...p}>
    <path d="M12 3 5 6v5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6Z" />
    <path d="M12 8.5v3.5" />
    <circle cx="12" cy="15.2" r="0.6" fill="currentColor" stroke="none" />
  </G>
);
export const ShieldCheck: IconType = (p) => (
  <G {...p}>
    <path d="M12 3 5 6v5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6Z" />
    <path d="m9 11.5 2.2 2.2L15 10" />
  </G>
);
export const Loader2: IconType = (p) => (
  <G {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
  </G>
);
export const Sparkles: IconType = (p) => (
  <G {...p}>
    <path d="M12 3c.3 4.2 1.5 5.4 5.7 5.7C13.5 9 12.3 10.2 12 14.4 11.7 10.2 10.5 9 6.3 8.7 10.5 8.4 11.7 7.2 12 3Z" />
    <path d="M18.5 14.5c.15 2 .7 2.55 2.7 2.7-2 .15-2.55.7-2.7 2.7-.15-2-.7-2.55-2.7-2.7 2-.15 2.55-.7 2.7-2.7Z" />
  </G>
);

/* ======================================================================
   Objects / tools
   ====================================================================== */

export const Cpu: IconType = (p) => (
  <G {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
  </G>
);
export const Database: IconType = (p) => (
  <G {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="2.8" />
    <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
    <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
  </G>
);
export const Network: IconType = (p) => (
  <G {...p}>
    <rect x="9" y="3" width="6" height="5" rx="1" />
    <rect x="3" y="16" width="6" height="5" rx="1" />
    <rect x="15" y="16" width="6" height="5" rx="1" />
    <path d="M12 8v4M6 16v-2h12v2M12 12v4" />
  </G>
);
export const Gauge: IconType = (p) => (
  <G {...p}>
    <path d="M4 15a8 8 0 1 1 16 0" />
    <path d="m12 13 3.5-3.5" />
    <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
  </G>
);
export const Timer: IconType = (p) => (
  <G {...p}>
    <path d="M9.5 3h5" />
    <path d="M12 14V9.5" />
    <circle cx="12" cy="14" r="7" />
  </G>
);
export const Clock: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </G>
);
export const Wrench: IconType = (p) => (
  <G {...p}>
    <path d="M15.5 6.5a3.8 3.8 0 0 1-4.8 4.8L5.5 16.5a2 2 0 0 0 2.8 2.8l5.2-5.2a3.8 3.8 0 0 0 4.8-4.8l-2.3 2.3-2.5-.5-.5-2.5Z" />
  </G>
);
export const FlaskConical: IconType = (p) => (
  <G {...p}>
    <path d="M9.5 3v6.2L4.7 17a2 2 0 0 0 1.7 3h11.2a2 2 0 0 0 1.7-3l-4.8-7.8V3" />
    <path d="M8 3h8M7.2 14h9.6" />
  </G>
);
export const Palette: IconType = (p) => (
  <G {...p}>
    <path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.8-2.9c-.5-.9.1-2 1.2-2H17a4 4 0 0 0 4-4c0-4.4-4-7.1-9-7.1Z" />
    <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </G>
);
export const SlidersHorizontal: IconType = (p) => (
  <G {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.4" />
    <circle cx="8" cy="17" r="2.4" />
  </G>
);
export const ListTodo: IconType = (p) => (
  <G {...p}>
    <rect x="3" y="4.5" width="5" height="5" rx="1.2" />
    <path d="m4 7 1 1 2-2.2" />
    <path d="M11 6h9M11 17h9" />
    <rect x="3" y="14.5" width="5" height="5" rx="1.2" />
  </G>
);
export const Image: IconType = (p) => (
  <G {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m5 17 4.5-4.5a1.5 1.5 0 0 1 2 0L19 20" />
  </G>
);
export const Music: IconType = (p) => (
  <G {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </G>
);
export const Paperclip: IconType = (p) => (
  <G {...p}>
    <path d="M20 11.5 12 19.5a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2L12 9" />
  </G>
);
export const User: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </G>
);
export const Users: IconType = (p) => (
  <G {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M15.5 5.2a3.2 3.2 0 0 1 0 6M17 14.2A5.5 5.5 0 0 1 20.5 19" />
  </G>
);
export const TerminalSquare: IconType = (p) => (
  <G {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="m7 9 3 3-3 3M12.5 15h4" />
  </G>
);

/* ======================================================================
   Panels / layout
   ====================================================================== */

export const PanelRight: IconType = (p) => (
  <G {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M14.5 4.5v15" />
  </G>
);
export const PanelRightOpen: IconType = (p) => (
  <G {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M14.5 4.5v15" />
    <path d="m7 9.5 2.5 2.5L7 14.5" />
  </G>
);
export const PanelRightClose: IconType = (p) => (
  <G {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M14.5 4.5v15" />
    <path d="M10 9.5 7.5 12 10 14.5" />
  </G>
);

/* ======================================================================
   Bottom-rail / settings glyphs
   ====================================================================== */

export const Globe: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.5 4 5.6 4 9s-1.4 6.5-4 9c-2.6-2.5-4-5.6-4-9s1.4-6.5 4-9Z" />
  </G>
);
export const Sun: IconType = (p) => (
  <G {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </G>
);
export const Moon: IconType = (p) => (
  <G {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />
  </G>
);
export const Monitor: IconType = (p) => (
  <G {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16v4" />
  </G>
);
export const Languages: IconType = (p) => (
  <G {...p}>
    <path d="M4 17 8 7l4 10M5.4 13.5h5.2" />
    <path d="M14 10h6M17 10v1c0 3-1.6 5.6-4 7M15 13.5c.6 2 2.2 3.7 4.5 4.5" />
  </G>
);
export const BookOpen: IconType = (p) => (
  <G {...p}>
    <path d="M12 6C10.5 4.8 8.5 4 6 4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1c2.5 0 4.5.8 6 2 1.5-1.2 3.5-2 6-2a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1c-2.5 0-4.5.8-6 2Z" />
    <path d="M12 6v14" />
  </G>
);
export const KeyRound: IconType = (p) => (
  <G {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.2 11.2 20 20M17 17l2-2M15 15l1.5-1.5" />
  </G>
);
export const Settings: IconType = (p) => (
  <G {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.4" />
    <circle cx="8" cy="17" r="2.4" />
  </G>
);

/* ======================================================================
   Semantic aliases used by ActivityBar (kept so the rail needs no changes)
   ====================================================================== */

export const Discussion = MessagesSquare;
export const Agent = Bot;
export const Generation = Sparkles;
export const Git = GitBranch;
export const Problems = Zap;
export const Changes = History;
export const Memory = BrainCircuit;
export const Chats = MessageSquare;
export const Projects = FolderGit2;
export const Keys = KeyRound;
export const Guide = BookOpen;
