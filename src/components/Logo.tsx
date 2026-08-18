import iconUrl from "../assets/magnetar-icon.png";

/** Magnetar mark — the brand icon (neutron star + violet dipole field). Uses the
 *  real icon PNG so it matches the app icon exactly. */
export function LogoMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      alt="Magnetar"
      draggable={false}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
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
