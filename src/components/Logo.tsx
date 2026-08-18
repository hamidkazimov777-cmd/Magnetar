/** Magnetar mark — two triangles meeting at a glowing core, forming an "M".
 *  Matches the brand reference (violet gradient, bright center). */
export function LogoMark({
  size = 32,
  className,
  glow = true,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  const uid = "m" + Math.round(size);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-label="Magnetar"
    >
      <defs>
        <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d8d2ff" />
          <stop offset="0.5" stopColor="#8b7ff5" />
          <stop offset="1" stopColor="#574bc9" />
        </linearGradient>
        <radialGradient id={`${uid}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#d8d2ff" />
          <stop offset="1" stopColor="#8b7ff5" stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>

      {/* Soft outer glow copy */}
      {glow && (
        <g
          stroke={`url(#${uid}-stroke)`}
          strokeWidth="7"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter={`url(#${uid}-blur)`}
          opacity="0.7"
        >
          <path d="M20 26 L50 50 L20 74 Z" />
          <path d="M80 26 L50 50 L80 74 Z" />
        </g>
      )}

      {/* Crisp mark */}
      <g
        stroke={`url(#${uid}-stroke)`}
        strokeWidth="6.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M20 26 L50 50 L20 74 Z" />
        <path d="M80 26 L50 50 L80 74 Z" />
      </g>

      {/* Bright core */}
      <circle cx="50" cy="50" r={glow ? 11 : 8} fill={`url(#${uid}-core)`} />
      <circle cx="50" cy="50" r="2.6" fill="#ffffff" />
    </svg>
  );
}

/** "MAGNETAR" wordmark — thin, wide letter-spacing, uppercase. */
export function Wordmark({
  className,
  tagline = false,
}: {
  className?: string;
  tagline?: boolean;
}) {
  return (
    <div className={className}>
      <div
        className="font-light uppercase text-[var(--color-text)]"
        style={{ letterSpacing: "0.42em" }}
      >
        Magnetar
      </div>
      {tagline && (
        <div
          className="mt-1 text-[10px] uppercase text-[var(--color-text-dim)]"
          style={{ letterSpacing: "0.34em" }}
        >
          Your AI Command Center
        </div>
      )}
    </div>
  );
}
