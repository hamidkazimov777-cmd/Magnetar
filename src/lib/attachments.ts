import { api } from "./api";
import { reportPromise } from "./errors";
import type { Attachment } from "./types";

/* ==========================================================================
   ATTACHMENTS THAT SURVIVE A RESTART

   What the user handed the model used to live only in memory. Reopen the app
   and the conversation still said "look at this image" with nothing attached —
   the transcript remembered the sentence and forgot the subject of it.

   The split is deliberate: metadata goes in the message row, bytes go to a file
   under the app's own data directory. A message row is read on every launch and
   on every render of the transcript, and making each one carry a few megabytes
   of base64 would be paid for continuously — to show a picture only at the
   moment it is actually on screen.
   ========================================================================== */

/** What is safe to keep in the row: everything except the payload. */
export function toMetadata(attachments: Attachment[] | undefined): string | null {
  if (!attachments?.length) return null;
  const light = attachments.map(({ data: _drop, ...rest }) => rest);
  return JSON.stringify(light);
}

/** Read the row back. A malformed value is treated as no attachments rather
 *  than taking the whole conversation down with it. */
export function fromMetadata(json: string | null | undefined): Attachment[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    const rows = parsed.filter(
      (a): a is Attachment =>
        !!a && typeof a.id === "string" && typeof a.name === "string",
    );
    return rows.length ? rows : undefined;
  } catch {
    return undefined;
  }
}

/** Write the bytes of everything that has any. Best-effort and detached: a
 *  failed write must not stop the message from being sent. */
export function keepBytes(attachments: Attachment[] | undefined): void {
  for (const a of attachments ?? []) {
    if (a.data) void reportPromise(api.attachmentWrite(a.id, a.data), "attachments:write");
  }
}

/** Fetch the bytes for one attachment, or null when the file is gone.
 *
 *  Gone is not an error: someone clearing the folder should leave the
 *  conversation readable, with the attachment shown as missing.
 */
export async function loadBytes(attachment: Attachment): Promise<string | null> {
  if (attachment.data) return attachment.data;
  try {
    return await api.attachmentRead(attachment.id);
  } catch {
    return null;
  }
}
