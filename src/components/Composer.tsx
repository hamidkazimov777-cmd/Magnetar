import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Paperclip, X, FileText } from "./icons";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { SLASH_COMMANDS, projectFiles, rankFiles } from "../lib/mentions";
import { AutocompletePopup, type AutocompleteItem } from "./composer/AutocompletePopup";
import type { Attachment } from "../lib/types";

function arrayBufferToBase64(bytes: Uint8Array) {
  let binary = "";
  const CHUNK = 0x8000; // avoid blowing the argument limit on big files
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "heic") return "image/heic";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
}: {
  disabled?: boolean;
  streaming?: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingPrompt = useStore((s) => s.pendingPrompt);
  const consumePrompt = useStore((s) => s.consumePrompt);
  const workspaceRoot = useStore((s) => s.workspaceRoot);

  /** Open autocomplete: `@` for files, `/` for commands. `start` is the index
   *  of the trigger character so we can replace the token on pick. */
  const [ac, setAc] = useState<{
    kind: "file" | "command";
    start: number;
    query: string;
  } | null>(null);
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([]);
  const [acCursor, setAcCursor] = useState(0);
  const [files, setFiles] = useState<string[]>([]);

  // Warm the file list once a folder is open, so `@` is instant.
  useEffect(() => {
    if (!workspaceRoot) {
      setFiles([]);
      return;
    }
    void projectFiles().then(setFiles);
  }, [workspaceRoot]);

  // Drag and drop goes through the webview, not the DOM.
  //
  // Tauri intercepts file drops at the window level, so the React onDrop below
  // never fires for a file dragged in from Finder — which is why attaching
  // anything meant reaching for the paperclip. This listener receives the real
  // paths, which is better anyway: an image arrives as a file we can read
  // rather than a browser blob.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragging(true);
        else if (event.payload.type === "drop") {
          setDragging(false);
          const paths = event.payload.paths ?? [];
          if (paths.length) {
            // The drop is window-wide, so make sure the panel it lands in is
            // actually on screen — otherwise the file attaches invisibly.
            useStore.getState().toggleAgentPanel(true);
            void ingestPaths(paths);
          }
        } else setDragging(false);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Another surface (e.g. "Run audit") can hand us a prompt to pre-fill.
  useEffect(() => {
    if (!pendingPrompt) return;
    const injected = consumePrompt();
    if (!injected) return;
    setText(injected);
    requestAnimationFrame(() => {
      ref.current?.focus();
      grow();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  // Recompute visible suggestions whenever the trigger or its query changes.
  useEffect(() => {
    if (!ac) {
      setAcItems([]);
      return;
    }
    if (ac.kind === "command") {
      const q = ac.query.toLowerCase();
      setAcItems(
        SLASH_COMMANDS.filter((c) => c.id.slice(1).startsWith(q)).map((c) => ({
          value: c.insert,
          label: c.id,
          hint: t(c.descKey),
        })),
      );
    } else {
      setAcItems(
        rankFiles(files, ac.query).map((path) => ({
          value: `@${path} `,
          label: path.split("/").pop() ?? path,
          hint: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined,
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ac, files]);

  /** Work out whether the caret sits inside an `@…` or a leading `/…` token. */
  const updateAutocomplete = (value: string, caret: number) => {
    const before = value.slice(0, caret);

    // Slash commands only make sense as the first thing in the message.
    const slash = before.match(/^\/([a-zа-яё]*)$/i);
    if (slash) {
      setAc({ kind: "command", start: 0, query: slash[1] });
      setAcCursor(0);
      return;
    }

    // `@` mention: from the last @ preceded by whitespace or the start.
    const at = before.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1]))) {
      const token = before.slice(at + 1);
      if (!/\s/.test(token)) {
        setAc({ kind: "file", start: at, query: token });
        setAcCursor(0);
        return;
      }
    }
    setAc(null);
  };

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  /** Replace the trigger token with the chosen value. */
  const applyPick = (item: AutocompleteItem) => {
    if (!ac) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const next = text.slice(0, ac.start) + item.value + text.slice(caret);
    setText(next);
    setAc(null);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = ac.start + item.value.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      grow();
    });
  };

  const addImageFromDataUrl = (dataUrl: string, name: string) => {
    const [header, base64] = dataUrl.split(",");
    const mime = header.split(":")[1].split(";")[0];
    setAttachments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: "image", mimeType: mime, name, data: base64 },
    ]);
  };

  /** Read files chosen from the picker: images inline, PDFs as extracted text. */
  const ingestPaths = async (paths: string[]) => {
    const next: Attachment[] = [];
    for (const file of paths) {
      const mime = getMimeType(file);
      const name = file.split(/[/\\]/).pop() || file;
      if (mime === "application/pdf") {
        let extractedText = "";
        try {
          extractedText = await api.extractPdfText(file);
        } catch {
          /* unreadable PDF still attaches by name */
        }
        next.push({
          id: crypto.randomUUID(),
          type: "file",
          mimeType: mime,
          name,
          path: file,
          extractedText,
        });
      } else if (mime.startsWith("image/")) {
        const contents = await readFile(file);
        next.push({
          id: crypto.randomUUID(),
          type: "image",
          mimeType: mime,
          name,
          data: arrayBufferToBase64(contents),
        });
      } else {
        // Anything else is treated as text: dropping a log or a source file
        // should hand the model its contents, not a base64 blob labelled as a
        // picture, which is what the old branch did to every non-image.
        let extractedText = "";
        try {
          extractedText = (await api.editorReadFile(file)).slice(0, 200_000);
        } catch {
          /* binary or unreadable — it still attaches by name and path */
        }
        next.push({
          id: crypto.randomUUID(),
          type: "file",
          mimeType: mime,
          name,
          path: file,
          extractedText,
        });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };

  const handleAttach = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "Images & PDF", extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf"] },
        ],
      });
      if (Array.isArray(selected)) await ingestPaths(selected);
    } catch {
      /* the user cancelled the dialog */
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const submit = () => {
    const body = text.trim();
    if ((!body && attachments.length === 0) || disabled) return;
    onSend(body, attachments);
    setText("");
    setAttachments([]);
    setAc(null);
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of Array.from(e.clipboardData.items)) {
      if (!item.type.startsWith("image")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result)
          addImageFromDataUrl(ev.target.result as string, `image_${Date.now()}.png`);
      };
      reader.readAsDataURL(blob);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result)
            addImageFromDataUrl(ev.target.result as string, file.name);
        };
        reader.readAsDataURL(file);
      } else if (file.type === "application/pdf") {
        // Tauri exposes a real path for dropped files; fall back to name only.
        const path = (file as File & { path?: string }).path;
        if (path) await ingestPaths([path]);
        else
          setAttachments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              type: "file",
              mimeType: file.type,
              name: file.name,
            },
          ]);
      }
    }
  };

  return (
    <div className="relative shrink-0 px-3 pb-3 pt-1">
      {ac && (
        <div className="absolute inset-x-3 bottom-[calc(100%-8px)]">
          <AutocompletePopup
            kind={ac.kind}
            items={acItems}
            cursor={acCursor}
            onPick={applyPick}
            onHover={setAcCursor}
          />
        </div>
      )}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        className={cn(
          "flex flex-col rounded-[var(--r-lg)] border bg-[var(--color-bg)] px-2.5 py-2 transition-colors",
          dragging
            ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,var(--color-bg))]"
            : "border-[var(--color-border)] focus-within:border-[var(--color-accent)]",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="group/att relative overflow-hidden rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]"
                title={a.name}
              >
                {a.type === "image" && a.data ? (
                  <img
                    src={`data:${a.mimeType};base64,${a.data}`}
                    alt={a.name}
                    className="h-14 w-14 object-cover"
                  />
                ) : (
                  <div className="grid h-14 w-14 place-items-center">
                    <FileText size={20} className="text-[var(--color-text-dim)]" />
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(a.id)}
                  title={t("removeAttachment")}
                  className="absolute right-0.5 top-0.5 hidden h-5 w-5 place-items-center rounded-full bg-black/70 text-white group-hover/att:grid"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <button
            onClick={handleAttach}
            disabled={disabled}
            className="icon-btn h-8 w-8 shrink-0"
            title={t("attachFile")}
            aria-label={t("attachFile")}
          >
            <Paperclip size={17} />
          </button>
          <textarea
            ref={ref}
            value={text}
            rows={1}
            disabled={disabled}
            placeholder={
              disabled
                ? t("addConnFirst")
                : streaming
                  ? t("interjectPlaceholder")
                  : t("messagePlaceholder")
            }
            onChange={(e) => {
              setText(e.target.value);
              updateAutocomplete(e.target.value, e.target.selectionStart ?? 0);
              grow();
            }}
            onKeyUp={(e) => {
              // Arrow keys move the caret without firing onChange.
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                updateAutocomplete(text, e.currentTarget.selectionStart ?? 0);
            }}
            onBlur={() => setAc(null)}
            onKeyDown={(e) => {
              if (ac && acItems.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAcCursor((c) => Math.min(c + 1, acItems.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAcCursor((c) => Math.max(c - 1, 0));
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applyPick(acItems[acCursor]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAc(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={handlePaste}
            className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[length:var(--fs-md)] leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-mute)] disabled:opacity-60"
          />
          {streaming && !text.trim() ? (
            <button
              onClick={onStop}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--color-surface-3)] text-[var(--color-text)] transition hover:opacity-80"
              title={t("stopGenerating")}
              aria-label={t("stopGenerating")}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-md)] bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-30"
              title={t("sendMessage")}
              aria-label={t("sendMessage")}
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[length:var(--fs-xs)] text-[var(--color-text-mute)]">
        {workspaceRoot ? t("sendHintMentions") : t("sendHint")}
      </p>
    </div>
  );
}
