import blackMark from "../assets/magnetar-mark-black.png";
import whiteMark from "../assets/magnetar-mark-white.png";
import { useResolvedTheme } from "../lib/useTheme";
import { cn } from "../lib/cn";

/** The Magnetar mark. Two artworks, one per theme: black on light, white on
 *  dark. The glyph is wider than it is tall, so `size` is the width and the
 *  height follows the artwork's own ratio. */
export function LogoMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const theme = useResolvedTheme();
  return (
    <img
      src={theme === "dark" ? whiteMark : blackMark}
      alt="Magnetar"
      draggable={false}
      className={cn("select-none", className)}
      style={{ width: size, height: "auto", objectFit: "contain" }}
    />
  );
}

/** "MAGNETAR" wordmark — light weight, wide tracking, uppercase. */
export function Wordmark({
  className,
  size = "var(--fs-md)",
}: {
  className?: string;
  size?: string;
}) {
  return (
    <div
      className={cn("font-medium uppercase text-[var(--color-text)]", className)}
      style={{ letterSpacing: "0.22em", fontSize: size }}
    >
      Magnetar
    </div>
  );
}
