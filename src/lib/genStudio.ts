import type { Connection } from "./types";

/* ==========================================================================
   GENERATION STUDIO — model registry (data-driven)

   Every generative model is one curated JSON entry. The Studio's right-hand
   settings panel is rendered from `params`, so picking a different model
   instantly rebuilds the panel — no hardcoded per-model UI.

   Wire shapes (all verified live against real keys):
   - openai_images : POST {base}/images/generations → data[].b64_json|url
   - chat_image    : POST {base}/chat/completions + modalities → message.images[]
   - video_poll    : POST {base}/video/generations → task_id, then poll
                     GET {base}/video/generations/{id} → data.result_url

   A model is reached through whichever Connection has the same base URL, so its
   API key comes from the existing Keychain-backed connection — no separate
   "generative" connection kind. Add TokenRouter / OpenRouter as ordinary
   connections in Settings and their models light up here.
   ========================================================================== */

export type GenKind = "image" | "video";
export type GenApi = "openai_images" | "chat_image" | "video_poll";

/** One adjustable control rendered in the right settings panel. */
export interface GenParam {
  key: string;
  /** i18n key for the label. */
  label: string;
  type: "select" | "number";
  options?: string[];
  min?: number;
  max?: number;
  default?: unknown;
}

export interface GenModel {
  /** Stable unique key for the editable registry (add/edit/delete). */
  key: string;
  /** Wire model id sent to the provider. */
  id: string;
  /** Human label in the picker. */
  label: string;
  provider: "tokenrouter" | "openrouter" | "custom";
  /** Base URL used to find the connection that holds the key. */
  baseUrl: string;
  /** Exact connection that holds the key. Preferred over `baseUrl` matching so
   *  the right key is used when several connections share one base URL. */
  connectionId?: string;
  kind: GenKind;
  api: GenApi;
  params: GenParam[];
}

const SIZE: GenParam = {
  key: "size",
  label: "genParamSize",
  type: "select",
  options: ["1024x1024", "1792x1024", "1024x1792"],
  default: "1024x1024",
};
const COUNT: GenParam = {
  key: "n",
  label: "genParamCount",
  type: "number",
  min: 1,
  max: 4,
  default: 1,
};

const TR = "https://api.tokenrouter.com/v1";
const OR = "https://openrouter.ai/api/v1";

/** Curated, live-verified generative models. Video is TokenRouter-only (async
 *  job → poll). Image works on both; OpenRouter returns the picture inline in
 *  the chat reply, TokenRouter via the OpenAI-shaped images endpoint. */
export const GEN_MODELS: GenModel[] = [
  // ---- image · TokenRouter (OpenAI-shaped) ----
  { key: "tr-gemini-25-image", id: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", provider: "tokenrouter", baseUrl: TR, kind: "image", api: "openai_images", params: [SIZE, COUNT] },
  { key: "tr-seedream-45", id: "bytedance-seed/seedream-4.5", label: "Seedream 4.5", provider: "tokenrouter", baseUrl: TR, kind: "image", api: "openai_images", params: [SIZE, COUNT] },
  { key: "tr-gpt5-image", id: "openai/gpt-5-image", label: "GPT-5 Image", provider: "tokenrouter", baseUrl: TR, kind: "image", api: "openai_images", params: [SIZE, COUNT] },
  { key: "tr-gpt5-image-mini", id: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini", provider: "tokenrouter", baseUrl: TR, kind: "image", api: "openai_images", params: [SIZE, COUNT] },
  { key: "tr-mai-image", id: "microsoft/mai-image-2.5", label: "MAI Image 2.5", provider: "tokenrouter", baseUrl: TR, kind: "image", api: "openai_images", params: [SIZE, COUNT] },

  // ---- image · OpenRouter (chat + modalities) ----
  { key: "or-gemini-25-image", id: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (OpenRouter)", provider: "openrouter", baseUrl: OR, kind: "image", api: "chat_image", params: [] },
  { key: "or-gemini-31-image", id: "google/gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image (OpenRouter)", provider: "openrouter", baseUrl: OR, kind: "image", api: "chat_image", params: [] },

  // ---- video · TokenRouter (async submit → poll) ----
  { key: "tr-hailuo-23", id: "MiniMax-Hailuo-2.3", label: "MiniMax Hailuo 2.3", provider: "tokenrouter", baseUrl: TR, kind: "video", api: "video_poll", params: [] },
  { key: "tr-kling-v26", id: "kling-v2-6", label: "Kling v2.6", provider: "tokenrouter", baseUrl: TR, kind: "video", api: "video_poll", params: [] },
  { key: "tr-dreamina-25", id: "dreamina-seedance-2-5-hc", label: "Dreamina Seedance 2.5", provider: "tokenrouter", baseUrl: TR, kind: "video", api: "video_poll", params: [] },
  { key: "tr-kling-v3", id: "kling-v3", label: "Kling v3 (premium)", provider: "tokenrouter", baseUrl: TR, kind: "video", api: "video_poll", params: [] },
];

/** Default params for a freshly added model, by wire shape. */
export function paramsForApi(api: GenApi): GenParam[] {
  return api === "openai_images" ? [SIZE, COUNT] : [];
}

export const newModelKey = () =>
  `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const norm = (u: string) => u.trim().replace(/\/+$/, "");

/* ---- editable registry (persisted per-machine in localStorage) ----------- */

const LS_KEY = "magnetar.genModels.v1";

/** The user's model list — the curated defaults on first run, then whatever the
 *  user has added/edited/deleted. Never throws: a corrupt value falls back to
 *  the defaults. */
export function loadRegistry(): GenModel[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as GenModel[];
    }
  } catch {
    /* private mode / blocked storage — use defaults */
  }
  return GEN_MODELS;
}

export function saveRegistry(list: GenModel[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Wipe user edits and return the built-in defaults. */
export function resetRegistry(): GenModel[] {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  return GEN_MODELS;
}

export const modelsByKind = (kind: GenKind): GenModel[] =>
  GEN_MODELS.filter((m) => m.kind === kind);

/** The connection that carries the API key for a model. Prefers the exact
 *  connection the model was bound to; falls back to base-URL matching for the
 *  built-in presets that carry no connection id. */
export function connectionForModel(
  connections: Connection[],
  model: GenModel,
): Connection | undefined {
  if (model.connectionId) {
    const byId = connections.find((c) => c.id === model.connectionId);
    if (byId) return byId;
  }
  return connections.find((c) => norm(c.baseUrl) === norm(model.baseUrl));
}

/** Whether any configured connection can serve this model. */
export function isModelReady(connections: Connection[], model: GenModel): boolean {
  return Boolean(connectionForModel(connections, model));
}

/** Default parameter values for a model, used to seed the settings panel. */
export function defaultParams(model: GenModel): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of model.params) if (p.default !== undefined) out[p.key] = p.default;
  return out;
}
