import { api } from "./api";
import { queueDivergence } from "./divergence";
import { parseVerify, projectFacts } from "./facts";
import { discoverChecks, runCheck } from "./problems";
import { useStore } from "./store";
import type { MemoryFact } from "./types";

/* ==========================================================================
   VERIFYING MEMORY BY MACHINE

   Anything that reduces to a check should be executed, not believed. "We use
   SQLite" is a grep over the dependency manifests; "handlers return Result" is
   the linter's job. A model asked to confirm its own memory will agree with
   itself — that is not verification, it is an echo.

   Only facts that carry a verify spec are touched here. A fact with no spec
   stays unverified forever, and says so, which is the honest outcome: nobody
   checked it, and pretending otherwise is the failure mode this whole design
   exists to prevent.
   ========================================================================== */

export type VerifyOutcome = "verified" | "refuted" | "stale" | "skipped";

/** Run one fact's check. Returns the fact as it should now be stored, or null
 *  when there was nothing to run. */
export async function verifyFact(
  root: string,
  fact: MemoryFact,
): Promise<{ fact: MemoryFact; outcome: VerifyOutcome } | null> {
  const spec = parseVerify(fact);
  if (!spec) return null;

  const at = Date.now();
  const settle = (status: MemoryFact["status"], outcome: VerifyOutcome) => ({
    fact: { ...fact, status, checkedAt: at, updatedAt: at },
    outcome,
  });

  if (spec.kind === "grep") {
    let content: string;
    try {
      content = await api.editorReadFile(`${root}/${spec.file}`);
    } catch {
      // The file the fact was read out of is gone. That does not make the claim
      // false — it makes the evidence for it disappear, which is exactly what
      // "stale" means.
      return settle("stale", "stale");
    }
    let re: RegExp;
    try {
      re = new RegExp(spec.pattern, "i");
    } catch {
      return null; // A malformed pattern is our bug, not the project's.
    }
    return re.test(content) ? settle("verified", "verified") : settle("refuted", "refuted");
  }

  // spec.kind === "check": the fact holds while a project check passes.
  const checks = await discoverChecks(root);
  const check = checks.find((c) => c.id === spec.checkId);
  if (!check) return settle("stale", "stale");
  const run = await runCheck(root, check);
  if (run.status === "error") return null; // could not run — say nothing
  return run.status === "ok"
    ? settle("verified", "verified")
    : settle("refuted", "refuted");
}

/** Verify a project's facts and write the results back.
 *
 *  `includeChecks` is off by default: grep specs are local file reads and cost
 *  nothing, while a check spec runs the project's own tooling and can take
 *  minutes. Cheap verification can run whenever a project is opened; the
 *  expensive kind is something the user asks for.
 */
export async function verifyProjectFacts(
  root: string,
  projectId: string,
  opts: { includeChecks?: boolean } = {},
): Promise<{ verified: number; refuted: number; stale: number }> {
  const st = useStore.getState();
  const tally = { verified: 0, refuted: 0, stale: 0 };

  const candidates = projectFacts(projectId).filter((f) => {
    const spec = parseVerify(f);
    if (!spec) return false;
    return spec.kind === "grep" || opts.includeChecks === true;
  });
  if (!candidates.length) return tally;

  const updated: MemoryFact[] = [];
  for (const f of candidates) {
    try {
      const res = await verifyFact(root, f);
      if (!res) continue;
      if (res.outcome !== "skipped") tally[res.outcome] += 1;
      // Only write when something actually changed — a no-op write would churn
      // the panel and rewrite updatedAt for facts nobody touched.
      if (res.fact.status !== f.status || !f.checkedAt) updated.push(res.fact);

      // A refuted fact is a contradiction like any other, so it lands in the
      // same queue instead of quietly changing colour in a panel nobody has
      // open. Marking it is not the same as telling anyone.
      if (res.outcome === "refuted" && f.status !== "refuted") {
        const spec = parseVerify(f);
        queueDivergence(projectId, {
          summary: f.text,
          factId: f.id,
          evidence: spec?.kind === "grep" ? spec.file : spec?.checkId,
          source: "check",
        });
      }
    } catch (e) {
      st.logMemory({
        kind: "audit",
        status: "error",
        detail: String(e).slice(0, 200),
        projectId,
      });
    }
  }

  if (updated.length) useStore.getState().saveFacts(updated);
  st.logMemory({
    kind: "audit",
    status: "ok",
    detail: `verify ${tally.verified}/${tally.refuted}/${tally.stale}`,
    projectId,
  });
  return tally;
}
