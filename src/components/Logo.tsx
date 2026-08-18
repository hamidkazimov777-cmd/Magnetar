/** Magnetar mark — a neutron star (black core) with a violet dipole magnetic
 *  field and a bright cross-flare, matching the brand icon. Transparent bg so it
 *  sits on the dark UI; the app icon wraps this in a glassy squircle. */

const CX = 50;
const TOP = 8; // field lines converge near the top pole
const BOT = 92; // …and the bottom pole
const LOOPS = [10, 17, 24, 31, 38, 44];

/** A tall dipole field line: from the top pole, bulging out by `e` at the
 *  equator, down to the bottom pole. */
function loop(e: number): string {
  return (
    `M ${CX} ${TOP} ` +
    `C ${CX + e * 0.62} ${TOP + 17}, ${CX + e} ${42}, ${CX + e} ${50} ` +
    `C ${CX + e} ${58}, ${CX + e * 0.62} ${BOT - 17}, ${CX} ${BOT}`
  );
}

export function LogoMark({
  size = 32,
  className,
  glow = true,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  const uid = "mg" + Math.round(size);
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
        <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9e4ff" />
          <stop offset="0.5" stopColor="#9a8cff" />
          <stop offset="1" stopColor="#6a4fe0" />
        </linearGradient>
        <radialGradient id={`${uid}-core`} cx="50%" cy="42%" r="60%">
          <stop offset="0" stopColor="#2a1f4a" />
          <stop offset="0.55" stopColor="#0b0714" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`${uid}-flare`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#c9c2ff" />
          <stop offset="1" stopColor="#8b7ff5" stopOpacity="0" />
        </radialGradient>
        <filter id={`${uid}-blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      {/* axis glow */}
      <g stroke={`url(#${uid}-line)`} strokeWidth="0.7" opacity="0.5">
        <line x1="50" y1="4" x2="50" y2="96" />
        <line x1="6" y1="50" x2="94" y2="50" />
      </g>

      {/* soft glow copy of field lines */}
      {glow && (
        <g
          stroke={`url(#${uid}-line)`}
          strokeWidth="2.4"
          strokeLinecap="round"
          filter={`url(#${uid}-blur)`}
          opacity="0.55"
        >
          {LOOPS.map((e, i) => (
            <g key={i}>
              <path d={loop(e)} />
              <path d={loop(-e)} />
            </g>
          ))}
        </g>
      )}

      {/* crisp field lines */}
      <g stroke={`url(#${uid}-line)`} strokeWidth="1.5" strokeLinecap="round">
        {LOOPS.map((e, i) => (
          <g key={i}>
            <path d={loop(e)} />
            <path d={loop(-e)} />
          </g>
        ))}
      </g>

      {/* flare halo */}
      <circle cx="50" cy="50" r="20" fill={`url(#${uid}-flare)`} />

      {/* neutron-star core */}
      <circle cx="50" cy="50" r="13.5" fill={`url(#${uid}-core)`} />
      <ellipse cx="45.5" cy="45" rx="4.5" ry="3" fill="#ffffff" opacity="0.14" />

      {/* cross flare */}
      <path
        d="M50 34 C 51 47, 53 49, 63 50 C 53 51, 51 53, 50 66 C 49 53, 47 51, 37 50 C 47 49, 49 47, 50 34 Z"
        fill="#ffffff"
      />
      <circle cx="50" cy="50" r="2.4" fill="#ffffff" />
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
