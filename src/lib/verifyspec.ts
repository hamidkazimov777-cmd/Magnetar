import type { FactKind, VerifySpec } from "./types";

/* ==========================================================================
   TURNING A CLAIM INTO A CHECK

   Kept free of every other import so it can be exercised on its own: this is
   the piece that decides whether memory gets confirmed or wrongly branded
   false, and it earned that scrutiny by doing the latter.
   ========================================================================== */

/** Build a grep that can actually confirm a claim — or nothing at all.
 *
 *  The first attempt took the longest word in the fact, which produced
 *  `management` for "State management uses Zustand 5.0.15" and `magnetar_lib.`
 *  (with the sentence's full stop attached) elsewhere. Both failed to match,
 *  and a failed match is recorded as REFUTED — so correct memory was being
 *  marked false. A wrong refutation is worse than no check: it destroys the
 *  very thing verification exists to protect.
 *
 *  So: strip punctuation, drop ordinary English, and keep only tokens that look
 *  like something a manifest would contain — a package name, a capitalised
 *  product, a version. Several candidates are combined, because any one of them
 *  appearing is enough to confirm the claim. When nothing qualifies, the fact
 *  gets no spec and honestly stays unverified.
 */
const COMMON_WORDS = new Set([
  "the","and","for","with","from","this","that","are","was","were","has","have","uses","used",
  "use","using","via","plus","all","also","include","includes","included","support","supports",
  "supported","built","build","project","application","app","code","file","files","local","state",
  "management","database","storage","stack","frontend","backend","desktop","shell","terminal",
  "editor","icons","primitives","surfaces","styling","rendered","provided","provides","comes",
  "come","runs","running","stored","handled","written","library","libraries","version","versions",
  "package","packages","module","modules","system","service","services","feature","features",
  "text","extraction","search","display","plugins","plugin","bundled","native","custom","main",
]);

export function grepPatternFor(text: string): string | undefined {
  const raw = text.match(/[A-Za-z0-9@][A-Za-z0-9_./@-]*/g) ?? [];

  // Candidates are graded, not merged. The first pass combined everything it
  // liked, so `macOS|Keychain|access` confirmed a fact because the file
  // happened to contain "access" — a match on a filler word is not evidence.
  // Only the best class available is used: a package name beats a version,
  // a version beats a capitalised product, and an ordinary long word is the
  // last resort.
  const named: string[] = []; // lucide-react, @xterm/addon-fit, magnetar_lib
  const versions: string[] = []; // 5.0.15, 0.12
  const products: string[] = []; // Zustand, SQLite, TypeScript
  const words: string[] = []; // rusqlite, tauri

  for (const token of raw) {
    // Sentence punctuation clings to the last word; a trailing dot turns the
    // pattern into something no manifest contains.
    const t = token.replace(/[.,;:]+$/, "");
    if (t.length < 3) continue;
    if (COMMON_WORDS.has(t.toLowerCase())) continue;

    if (/[-_/@]/.test(t)) named.push(t);
    else if (/^\d[\d.]*$/.test(t)) versions.push(t);
    else if (/[A-Z]/.test(t)) products.push(t);
    else if (t.length >= 6) words.push(t);
  }

  const best = [named, products, versions, words].find((g) => g.length > 0);
  if (!best) return undefined;

  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...new Set(best)].slice(0, 3).map(esc).join("|");
}

/** Only stack claims read out of a named file are machine-checkable, and only
 *  when a usable pattern could be built. Everything else stays unverified,
 *  which is the honest state rather than a guess dressed up as a check. */
export function buildVerify(
  extracted: boolean,
  kind: FactKind,
  text: string,
  source: string | undefined,
): VerifySpec | undefined {
  if (!extracted || kind !== "stack" || !source) return undefined;
  const pattern = grepPatternFor(text);
  return pattern ? { kind: "grep", pattern, file: source } : undefined;
}

