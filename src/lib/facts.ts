import { useStore } from "./store";
import type { FactKind, FactOrigin, MemoryFact, Project, VerifySpec } from "./types";

/* ==========================================================================
   PROJECT MEMORY AS FACTS

   Memory used to be seven text columns. Prose cannot answer the two questions
   that decide whether a coder should act on it — where did this come from, and
   is it still true — so every claim carried the same weight: the stack read out
   of package.json and an architecture a model once guessed at looked identical
   in the prompt. A false fact is worse than a missing one, because it is
   trusted. Facts carry their origin and their verification date, and say so to
   the model.
   ========================================================================== */

const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

export const FACT_KINDS: FactKind[] = ["stack", "architecture", "constraint", "state"];

export function newFact(
  projectId: string,
  kind: FactKind,
  text: string,
  origin: FactOrigin,
  originDetail?: string,
  verify?: VerifySpec,
): MemoryFact {
  const at = Date.now();
  return {
    id: uid(),
    projectId,
    kind,
    text: text.trim(),
    origin,
    originDetail,
    verify: verify ? JSON.stringify(verify) : undefined,
    // Nothing is born verified. Confirmation is something a machine does later.
    status: "unverified",
    createdAt: at,
    updatedAt: at,
  };
}

export function parseVerify(f: MemoryFact): VerifySpec | null {
  if (!f.verify) return null;
  try {
    const v = JSON.parse(f.verify) as VerifySpec;
    if (v?.kind === "grep" && v.pattern && v.file) return v;
    if (v?.kind === "check" && v.checkId) return v;
    return null;
  } catch {
    return null;
  }
}

/** Split a prose field into one fact per line, the way it was written. */
function linesToFacts(
  projectId: string,
  kind: FactKind,
  text: string | undefined,
  fieldName: string,
): MemoryFact[] {
  if (!text?.trim()) return [];
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 1)
    .slice(0, 40)
    .map((l) => newFact(projectId, kind, l.slice(0, 400), "legacy", fieldName));
}

/** One-time split of the old prose fields into facts.
 *
 *  The columns stay in the database untouched — this is a widening, not a
 *  destructive rewrite — but once a project is migrated they stop reaching the
 *  model, so there is exactly one source of truth in the prompt. `decisions` is
 *  deliberately left behind: decisions become an event log of their own, not
 *  facts, and migrating them here would flatten out the "why".
 */
export async function migrateLegacyMemory(p: Project): Promise<void> {
  if (p.factsMigratedAt) return;
  const st = useStore.getState();

  const rows = [
    ...linesToFacts(p.id, "stack", p.techStack, "techStack"),
    ...linesToFacts(p.id, "architecture", p.architectureNotes, "architectureNotes"),
    ...linesToFacts(p.id, "constraint", p.codingStandards, "codingStandards"),
    ...linesToFacts(p.id, "constraint", p.risks, "risks"),
    ...linesToFacts(p.id, "state", p.activeGoals, "activeGoals"),
  ];
  if (p.lastState?.trim())
    rows.push(newFact(p.id, "state", p.lastState.trim().slice(0, 2000), "legacy", "lastState"));

  if (rows.length) st.saveFacts(rows);
  st.updateProject({ ...p, factsMigratedAt: Date.now(), updatedAt: Date.now() });
  st.logMemory({
    kind: "audit",
    status: "ok",
    detail: `facts:${rows.length}`,
    projectId: p.id,
  });
}

/** Make sure the open project's facts are in the store, migrating the old
 *  fields on first sight. Everything that reads memory goes through the store
 *  synchronously, so the loading has to happen when the project is selected —
 *  not when the prompt is being built. */
export async function ensureProjectFacts(projectId: string): Promise<void> {
  const st = useStore.getState();
  if (!st.facts[projectId]) await st.loadFacts(projectId);
  const p = useStore.getState().projects.find((x) => x.id === projectId);
  if (p) await migrateLegacyMemory(p);
}

const KIND_HEADING: Record<FactKind, string> = {
  stack: "Stack",
  architecture: "Architecture",
  constraint: "Constraints",
  state: "Current state",
};

const ORIGIN_WORD: Record<FactOrigin, string> = {
  extracted: "read from",
  user: "stated by the user",
  inferred: "concluded by a model",
  legacy: "older note",
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** How a single fact appears to the model: the claim, then its provenance.
 *  The provenance is not decoration — it is what lets a model treat "SQLite,
 *  read from package.json, verified today" and "hexagonal architecture, the
 *  user said so, never checked" differently. */
export function renderFact(f: MemoryFact): string {
  const bits: string[] = [];
  bits.push(
    f.origin === "extracted" && f.originDetail
      ? `${ORIGIN_WORD.extracted} ${f.originDetail}`
      : ORIGIN_WORD[f.origin],
  );
  if (f.status === "verified" && f.checkedAt) bits.push(`verified ${day(f.checkedAt)}`);
  else if (f.status === "stale") bits.push("STALE — was true, the project has changed since");
  else if (f.status === "refuted") bits.push("REFUTED by a check — do not rely on it");
  else bits.push("unverified");
  return `- ${f.text}  [${bits.join("; ")}]`;
}

/** Render a set of facts as the memory section of the system prompt. */
export function renderFacts(facts: MemoryFact[]): string {
  const usable = facts.filter((f) => f.status !== "refuted");
  if (!usable.length) return "";

  const parts: string[] = [];
  for (const kind of FACT_KINDS) {
    const group = usable.filter((f) => f.kind === kind);
    if (!group.length) continue;
    // Confirmed facts first: if the prompt gets truncated anywhere downstream,
    // what survives should be the part a machine stands behind.
    group.sort((a, b) => Number(b.status === "verified") - Number(a.status === "verified"));
    parts.push(`\n${KIND_HEADING[kind]}:\n${group.map(renderFact).join("\n")}`);
  }
  if (!parts.length) return "";

  parts.push(
    `\nEach fact above says where it came from and whether a machine confirmed it.` +
      ` An unverified fact is a claim, not the truth: if it decides what you write, check it in the code first.`,
  );
  return parts.join("\n");
}

/** Facts for a project, straight from the store (already loaded by then). */
export function projectFacts(projectId: string | undefined): MemoryFact[] {
  if (!projectId) return [];
  return useStore.getState().facts[projectId] ?? [];
}
