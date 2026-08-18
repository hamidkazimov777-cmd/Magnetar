import type { Connection, ModelInfo } from "./types";

/** Model capability tiers. `light` = cheap/fast, `heavy` = frontier. */
export type Tier = "light" | "standard" | "heavy";

const TIER_ORDER: Tier[] = ["light", "standard", "heavy"];
export const tierRank = (t: Tier) => TIER_ORDER.indexOf(t);

/** Best-effort tier from a model id. Heuristic, provider-agnostic. */
export function modelTier(id: string): Tier {
  const s = id.toLowerCase();
  const heavy =
    /(opus|gpt-4|gpt-5|o1|o3|o4|sonnet|-70b|-72b|-405b|large|pro\b|ultra|deepseek-r|reasoner|command-r-plus|max\b)/;
  const light =
    /(mini|nano|flash|lite|tiny|small|haiku|-1\.5b|-3b|-4b|-7b|-8b|-9b|instruct-turbo|scout|gemma-2-2b)/;
  if (heavy.test(s)) return "heavy";
  if (light.test(s)) return "light";
  return "standard";
}

export interface Candidate {
  connectionId: string;
  connectionName: string;
  model: string;
  tier: Tier;
}

/** Flatten the cached model catalog across all connections. */
export function buildCatalog(
  connections: Connection[],
  models: Record<string, ModelInfo[]>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of connections) {
    for (const m of models[c.id] ?? []) {
      out.push({
        connectionId: c.id,
        connectionName: c.name,
        model: m.id,
        tier: modelTier(m.id),
      });
    }
  }
  return out;
}

export interface Classification {
  tier: Tier;
  reason: string;
}

/** Cheap, free heuristic classifier — runs before any network call. */
export function classifyPrompt(text: string): Classification {
  const t = text.trim();
  const lower = t.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;

  const heavySignals =
    /(напиши|создай|сдела|построй|разработай|отладь|исправь баг|рефактор|архитектур|алгоритм|оптимизир|докажи|спроектируй|build|create|implement|refactor|debug|design|architecture|algorithm|optimi|prove|write (a|the|me a)? ?(code|app|program|function|script|class))/;
  const codey = /```|\bfunction\b|\bclass\b|\bimport\b|=>|;\s*$|\bSELECT\b/i;
  const lightSignals =
    /^(привет|прив|здоров|хай|как дела|спасибо|ок|окей|пока|hi|hello|hey|thanks|thank you|yo|sup|how are you|good morning)\b/;

  if (lightSignals.test(lower) || (words <= 6 && !heavySignals.test(lower))) {
    return { tier: "light", reason: "короткий/бытовой запрос" };
  }
  if (heavySignals.test(lower) || codey.test(t) || words > 120) {
    return { tier: "heavy", reason: "сложная задача (код/большой объём)" };
  }
  return { tier: "standard", reason: "обычный запрос" };
}

export interface Recommendation {
  tier: Tier;
  reason: string;
  /** Best available model for this tier (may be the current one). */
  pick?: Candidate;
  /** A stronger option on another connection worth suggesting (opt-in switch). */
  upgrade?: Candidate;
  currentTier?: Tier;
}

/** Pick the closest available candidate to a desired tier: prefer exact tier,
 *  else the nearest by rank, tie-broken toward the current connection. */
function nearest(
  desired: Tier,
  catalog: Candidate[],
  preferConnectionId?: string,
): Candidate | undefined {
  if (catalog.length === 0) return undefined;
  const want = tierRank(desired);
  return [...catalog].sort((a, b) => {
    const da = Math.abs(tierRank(a.tier) - want);
    const db = Math.abs(tierRank(b.tier) - want);
    if (da !== db) return da - db;
    // Tie: prefer same connection, then higher tier.
    const sameA = a.connectionId === preferConnectionId ? 0 : 1;
    const sameB = b.connectionId === preferConnectionId ? 0 : 1;
    if (sameA !== sameB) return sameA - sameB;
    return tierRank(b.tier) - tierRank(a.tier);
  })[0];
}

export function recommend(
  text: string,
  catalog: Candidate[],
  current: { connectionId?: string; model?: string },
): Recommendation {
  const { tier, reason } = classifyPrompt(text);
  const currentTier = current.model ? modelTier(current.model) : undefined;
  const pick = nearest(tier, catalog, current.connectionId);

  // If the task wants more muscle than the current model and a heavier model
  // exists (possibly on another connection), surface it as an opt-in upgrade.
  let upgrade: Candidate | undefined;
  if (currentTier && tierRank(tier) > tierRank(currentTier)) {
    const stronger = catalog
      .filter((c) => tierRank(c.tier) >= tierRank(tier))
      .sort((a, b) => tierRank(b.tier) - tierRank(a.tier));
    upgrade = stronger.find(
      (c) => !(c.connectionId === current.connectionId && c.model === current.model),
    );
  }

  return { tier, reason, pick, upgrade, currentTier };
}
