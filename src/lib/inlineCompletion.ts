import type * as Monaco from "monaco-editor";
import { api } from "./api";
import { useStore } from "./store";

/* ==========================================================================
   INLINE COMPLETION (ghost text)

   A single provider registered once against the editor. It offers a suggestion
   at the cursor from the user's own model — opt-in, because it spends tokens and
   needs a configured key. Monaco already handles accepting it: Tab takes the
   whole thing, and its built-in commands take the next word or line, so this
   file only has to produce the text and get out of the way.

   Three costs are kept in check deliberately:
   - context is capped (a window before and after the cursor, not the file);
   - requests are debounced, so a burst of keystrokes fires one call, not ten;
   - a stale request is dropped the moment Monaco cancels it — the model may
     still bill for it, but it never lands on screen as the wrong suggestion.
   ========================================================================== */

/** How long the cursor must sit still before we ask the model. */
const DEBOUNCE_MS = 300;
/** Characters of context on each side of the cursor. */
const PREFIX_CAP = 2000;
const SUFFIX_CAP = 500;

const SYSTEM =
  "You are a code completion engine, like GitHub Copilot. You are given the " +
  "code before the cursor in <PREFIX> and the code after it in <SUFFIX>. " +
  "Reply with ONLY the code that should be inserted at the cursor to continue " +
  "naturally — no explanation, no markdown fences, no repetition of the prefix " +
  "or suffix. If nothing useful can be added, reply with an empty string.";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strip a stray markdown fence the model may wrap the code in anyway. */
export function clean(text: string): string {
  let s = text.replace(/^\s*```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  // A leading newline just pushes the suggestion off the cursor line.
  if (s.startsWith("\n")) s = s.slice(1);
  return s;
}

let registered = false;

/** Register the inline-completions provider. Idempotent — safe on every mount. */
export function registerInlineCompletion(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  const provider: Monaco.languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (model, position, _ctx, token) => {
        const st = useStore.getState();
        if (!st.prefs?.inlineCompletion) return { items: [] };

        // Prefer the dedicated background/memory model (cheap and fast); fall
        // back to whatever the chat is using.
        const pick =
          st.prefs.memoryModel ??
          (st.activeConnectionId && st.activeModel
            ? { connectionId: st.activeConnectionId, model: st.activeModel }
            : null);
        if (!pick) return { items: [] };
        const connection = st.connections.find((c) => c.id === pick.connectionId);
        if (!connection) return { items: [] };

        const prefixRange = new monaco.Range(1, 1, position.lineNumber, position.column);
        const prefix = model.getValueInRange(prefixRange).slice(-PREFIX_CAP);
        const lastLine = model.getLineCount();
        const suffixRange = new monaco.Range(
          position.lineNumber,
          position.column,
          lastLine,
          model.getLineMaxColumn(lastLine),
        );
        const suffix = model.getValueInRange(suffixRange).slice(0, SUFFIX_CAP);
        // Nothing to complete from an empty buffer.
        if (!prefix.trim()) return { items: [] };

        // Debounce: let the burst of keystrokes settle, then bail if a newer
        // request has already superseded this one.
        await delay(DEBOUNCE_MS);
        if (token.isCancellationRequested) return { items: [] };

        let text: string;
        try {
          text = await api.complete(
            connection,
            pick.model,
            [
              {
                id: "inline",
                role: "user",
                createdAt: 0,
                content: `<PREFIX>\n${prefix}\n</PREFIX>\n<SUFFIX>\n${suffix}\n</SUFFIX>`,
              },
            ],
            SYSTEM,
          );
        } catch {
          return { items: [] };
        }
        if (token.isCancellationRequested) return { items: [] };

        const insertText = clean(text);
        if (!insertText) return { items: [] };

        return {
          items: [
            {
              insertText,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      },
    disposeInlineCompletions: () => {},
  };

  monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, provider);
}
