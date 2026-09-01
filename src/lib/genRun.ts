import { api } from "./api";
import type { Connection } from "./types";
import type { GenModel } from "./genStudio";

/* ==========================================================================
   GENERATION STUDIO — the run chain

   One flow: (optional) LLM turns the user's words into a production prompt →
   the generative model renders → the result comes back as a URL/data-URI. The
   LLM step is a toggle, not a requirement: raw text can go straight to the
   generator.
   ========================================================================== */

const PROMPTER_SYSTEM =
  "You are a world-class prompt engineer for generative media. The user will " +
  "describe — often roughly, in their own words — what they want to create. " +
  "Turn it into ONE vivid, production-grade prompt in English (generators " +
  "perform best in English) while staying faithful to their subject and intent. " +
  "Be concrete: subject, composition, style, lighting, mood; for video add " +
  "camera movement and pacing. Output ONLY the final prompt — no preamble, no " +
  "quotes, no alternatives, no explanation.";

/** Refine a rough request into a generation prompt via a text model. Falls back
 *  to the raw text if the model returns nothing usable. */
export async function refinePrompt(
  textConnection: Connection,
  textModel: string,
  userText: string,
  projectContext?: string,
): Promise<string> {
  const content = projectContext ? `${projectContext}\n\n${userText}` : userText;
  const out = await api.complete(
    textConnection,
    textModel,
    [{ id: "p", role: "user", content, createdAt: Date.now() }],
    PROMPTER_SYSTEM,
  );
  const cleaned = out.trim().replace(/^["'`]|["'`]$/g, "").trim();
  return cleaned || userText;
}

/** One produced asset ready to render. `src` is a data-URI or hosted URL. */
export interface GenOutput {
  kind: "image" | "video";
  src: string;
}

export async function generateImage(
  connection: Connection,
  model: GenModel,
  prompt: string,
  params: Record<string, unknown>,
  references?: string[],
): Promise<GenOutput[]> {
  // OpenRouter only serves images through the chat endpoint, so force chat_image
  // there — otherwise a reference image would never reach the model.
  const isOpenRouter = /openrouter\.ai/i.test(connection.baseUrl);
  const api_kind =
    isOpenRouter || model.api === "chat_image" ? "chat_image" : "openai_images";
  const res = await api.genImage(connection, api_kind, model.id, prompt, params, references);
  const out: GenOutput[] = [];
  for (const a of res.assets) {
    const src = a.url ?? (a.b64 ? `data:${a.mime ?? "image/png"};base64,${a.b64}` : "");
    if (src) out.push({ kind: "image", src });
  }
  return out;
}

const DONE_RE = /(SUCC|FINISH|COMPLET|DONE|SUCCEED)/i;
const FAIL_RE = /(FAIL|ERROR|CANCEL)/i;

/** Submit a video job and poll to completion. `onProgress` reports the raw
 *  status/percent so the UI can show a live indicator. */
export async function generateVideo(
  connection: Connection,
  model: GenModel,
  prompt: string,
  params: Record<string, unknown>,
  onProgress?: (label: string) => void,
  opts: { intervalMs?: number; timeoutMs?: number; cancelled?: () => boolean } = {},
): Promise<GenOutput[]> {
  const { taskId } = await api.genVideoSubmit(connection, model.id, prompt, params);
  const interval = opts.intervalMs ?? 5000;
  const timeout = opts.timeoutMs ?? 12 * 60 * 1000;
  const started = Date.now();

  for (;;) {
    if (opts.cancelled?.()) throw new Error("cancelled");
    await new Promise((r) => setTimeout(r, interval));
    if (Date.now() - started > timeout) throw new Error("video timed out");

    let st: { status: string; progress?: string; url?: string; failReason?: string };
    try {
      st = await api.genVideoPoll(connection, taskId);
    } catch {
      continue; // a transient poll error should not abort a running job
    }
    onProgress?.(st.progress ? `${st.status} · ${st.progress}` : st.status);

    if (st.url && DONE_RE.test(st.status)) {
      return [{ kind: "video", src: st.url }];
    }
    if (st.url && !FAIL_RE.test(st.status)) {
      // Some providers set the url before the status flips — accept it.
      return [{ kind: "video", src: st.url }];
    }
    if (FAIL_RE.test(st.status)) {
      throw new Error(st.failReason || `video failed (${st.status})`);
    }
  }
}
