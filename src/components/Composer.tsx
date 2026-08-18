import { useRef, useState } from "react";
import { ArrowUp, Square, Paperclip, X, FileImage } from "lucide-react";
import { useT } from "../lib/i18n";
import { cn } from "../lib/cn";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { Attachment } from "../lib/types";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
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
  const ref = useRef<HTMLTextAreaElement>(null);

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  };

  const handleAttach = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"]
        }]
      });
      if (selected && Array.isArray(selected)) {
        const newAtts: Attachment[] = [];
        for (const file of selected) {
          const contents = await readFile(file);
          const mime = getMimeType(file);
          const base64 = arrayBufferToBase64(contents);
          newAtts.push({
            id: crypto.randomUUID(),
            type: "image",
            mimeType: mime,
            name: file.split(/[/\\]/).pop() || file,
            data: base64
          });
        }
        setAttachments(prev => [...prev, ...newAtts]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const submit = () => {
    const t = text.trim();
    if ((!t && attachments.length === 0) || disabled) return;
    onSend(t, attachments);
    setText("");
    setAttachments([]);
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto";
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              const dataUrl = event.target.result as string;
              const [header, base64] = dataUrl.split(",");
              const mime = header.split(":")[1].split(";")[0];
              setAttachments(prev => [...prev, {
                id: crypto.randomUUID(),
                type: "image",
                mimeType: mime,
                name: `image_${Date.now()}.png`,
                data: base64
              }]);
            }
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-5">
      <div
        className={cn(
          "flex flex-col rounded-2xl border border-[var(--color-border)]",
          "bg-[var(--color-surface)] px-3 py-2.5 shadow-lg",
          "focus-within:border-[var(--color-accent)]",
        )}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative group rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                {a.type === "image" && a.data ? (
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt={a.name} className="h-16 w-16 object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center">
                    <FileImage size={24} className="text-[var(--color-text-dim)]" />
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -top-1 -right-1 hidden group-hover:grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={handleAttach}
            disabled={disabled}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] transition disabled:opacity-30"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={ref}
            value={text}
            rows={1}
            disabled={disabled}
            placeholder={disabled ? t("addConnFirst") : t("messagePlaceholder")}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={handlePaste}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const files = Array.from(e.dataTransfer.files);
                for (const file of files) {
                  if (file.type.startsWith("image/")) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      if (event.target?.result) {
                        const dataUrl = event.target.result as string;
                        const [header, base64] = dataUrl.split(",");
                        const mime = header.split(":")[1].split(";")[0];
                        setAttachments(prev => [...prev, {
                          id: crypto.randomUUID(),
                          type: "image",
                          mimeType: mime,
                          name: file.name,
                          data: base64
                        }]);
                      }
                    };
                    reader.readAsDataURL(file);
                  }
                }
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            className="max-h-[220px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)] disabled:opacity-60"
          />
          {streaming ? (
            <button
              onClick={onStop}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text)] hover:opacity-80"
              title="Stop"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition disabled:cursor-not-allowed disabled:opacity-30"
              title="Send"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-[var(--color-text-dim)]">
        {t("sendHint")}
      </p>
    </div>
  );
}
