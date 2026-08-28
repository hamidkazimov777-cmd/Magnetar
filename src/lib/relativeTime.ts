/** A timestamp as "3 days ago", in the app's language.
 *
 *  Blame and history show dates, and an absolute date makes you do the
 *  subtraction yourself to answer the only question you were asking: is this
 *  recent or old.
 */
export function relativeTime(unixSeconds: number, lang: "ru" | "en" | "es" = "en"): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 0) return unit(0, "minute", lang);
  const table: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [2592000, "day"],
    [31536000, "month"],
    [Infinity, "year"],
  ];
  const divisors: Record<string, number> = {
    second: 1,
    minute: 60,
    hour: 3600,
    day: 86400,
    month: 2592000,
    year: 31536000,
  };
  for (const [limit, u] of table) {
    if (diff < limit) return unit(Math.floor(diff / divisors[u]), u, lang);
  }
  return unit(Math.floor(diff / divisors.year), "year", lang);
}

function unit(n: number, u: Intl.RelativeTimeFormatUnit, lang: string): string {
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(-Math.max(n, 0), u);
  } catch {
    return `${n} ${u}${n === 1 ? "" : "s"} ago`;
  }
}
