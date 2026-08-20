import type { Decision, MemoryFact } from "./types";

/* ==========================================================================
   PICKING WHAT GOES INTO THE PROMPT

   Memory used to be dumped into the system prompt whole. On a real project
   that is tens of thousands of tokens in which the two lines that matter are
   diluted by two hundred that do not — the model works worse and it costs more.
   Retrieval already applies to code (search_code, then read_file); memory gets
   the same treatment.

   The scoring is deliberately lexical and local: no embeddings, no model call,
   nothing that can fail or bill. Selection runs on every single turn, so it has
   to be free and instant, and a wrong pick has to be cheap.
   ========================================================================== */

/** Rules and stack are kept whole: they are few, and a constraint that did not
 *  reach the model is a constraint that gets violated. Architecture, state and
 *  decisions are the parts that grow without bound, so those get selected. */
const KEEP_ALL: MemoryFact["kind"][] = ["stack", "constraint"];

const STOP = new Set([
  "the","and","for","that","this","with","from","have","what","when","where","which","into",
  "как","что","чтобы","этот","эта","для","при","под","над","или","если","чем","так","það",
  "make","add","fix","use","del","los","las","por","para","que","una","uno",
]);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}_./-]{3,}/gu) ?? []).filter((w) => !STOP.has(w));
}

/** Overlap between a query and a piece of memory, normalised by length so a
 *  long paragraph does not win by simply containing more words. */
function overlap(queryTokens: Set<string>, text: string): number {
  const t = tokens(text);
  if (!t.length) return 0;
  let hits = 0;
  for (const w of new Set(t)) {
    if (queryTokens.has(w)) hits += 1;
    // A path or a symbol mentioned in the query is a strong signal even when it
    // only appears as part of a longer token ("src/lib/agent.ts" vs "agent.ts").
    else if (w.length > 5 && [...queryTokens].some((q) => q.includes(w) || w.includes(q)))
      hits += 0.5;
  }
  return hits / Math.sqrt(t.length);
}

/** How strongly a piece of text matches a query, 0 upwards. Shared so that
 *  matching a divergence to the fact it contradicts uses the same notion of
 *  "about the same thing" as choosing what goes into the prompt. */
export function similarity(query: string, text: string): number {
  return overlap(new Set(tokens(query)), text);
}

export interface Picked {
  facts: MemoryFact[];
  decisions: Decision[];
}

/** Choose the memory that belongs in this turn's prompt.
 *
 *  `budget` is a character cap over the selected text — a hard ceiling, so a
 *  project with a thousand facts cannot silently turn every request into a
 *  40k-token one.
 */
export function pickMemory(
  facts: MemoryFact[],
  decisions: Decision[],
  query: string,
  opts: { budget?: number; maxArchitecture?: number; maxDecisions?: number } = {},
): Picked {
  const budget = opts.budget ?? 6000;
  const maxArch = opts.maxArchitecture ?? 10;
  const maxDec = opts.maxDecisions ?? 8;
  const q = new Set(tokens(query));

  const alive = facts.filter((f) => f.status !== "refuted");
  const kept = alive.filter((f) => KEEP_ALL.includes(f.kind));

  const score = (f: MemoryFact) =>
    overlap(q, f.text) +
    // A confirmed fact is worth more than an unconfirmed one at equal
    // relevance — it is the part a machine stands behind.
    (f.status === "verified" ? 0.15 : 0) +
    (f.status === "stale" ? -0.2 : 0);

  const architecture = alive
    .filter((f) => f.kind === "architecture")
    .map((f) => ({ f, s: score(f) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, maxArch)
    .map((x) => x.f);

  // "Where we stopped" is about the present, so recency beats similarity.
  const state = alive
    .filter((f) => f.kind === "state")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 2);

  // Decisions: the newest few always (they are what the work is currently
  // built on), plus whatever the query actually touches.
  const recent = decisions.slice(0, 3);
  const relevant = decisions
    .slice(3)
    .map((d) => ({
      d,
      s: overlap(q, `${d.title} ${d.rationale ?? ""} ${d.alternatives ?? ""} ${d.files ?? ""}`),
    }))
    .filter((x) => x.s > 0.15)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(0, maxDec - recent.length))
    .map((x) => x.d);

  const pickedDecisions = [...recent, ...relevant].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  // Trim to the budget, dropping the least relevant first. Constraints and
  // stack are trimmed last: they are the cheapest to keep and the most
  // expensive to lose.
  const ordered = [...kept, ...architecture, ...state];
  const out: MemoryFact[] = [];
  let used = 0;
  for (const f of ordered) {
    const cost = f.text.length + 60; // provenance line included
    if (used + cost > budget) continue;
    out.push(f);
    used += cost;
  }

  return { facts: out, decisions: pickedDecisions };
}
