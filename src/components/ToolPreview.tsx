import { diffLines } from "diff";

/** Human-readable preview of a destructive tool call shown in the confirm modal.
 *  edit_file → colored line diff; write_file → new content; run_bash → command. */
export function ToolPreview({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}) {
  if (name === "edit_file") {
    const path = String(args.path ?? "");
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    return (
      <div className="space-y-2">
        <PathLabel path={path} />
        <DiffBlock oldStr={oldStr} newStr={newStr} />
      </div>
    );
  }

  if (name === "write_file") {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    return (
      <div className="space-y-2">
        <PathLabel path={path} />
        <pre className="max-h-72 overflow-auto rounded-lg border border-[color-mix(in_srgb,var(--color-added)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-added)_6%,transparent)] p-3 text-[length:var(--fs-xs)] leading-relaxed">
          {content.split("\n").map((l, i) => (
            <div key={i} className="text-[var(--color-added)]">
              <span className="mr-2 select-none text-[var(--color-added)] opacity-60">+</span>
              {l}
            </div>
          ))}
        </pre>
      </div>
    );
  }

  if (name === "run_bash") {
    return (
      <div className="space-y-2">
        {args.cwd ? <PathLabel path={String(args.cwd)} /> : null}
        {/* Wrap instead of scrolling sideways: a long one-liner used to stretch
            the dialog past the window, pushing the buttons off screen. */}
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[length:var(--fs-xs)] leading-relaxed">
          <span className="mr-1 select-none text-[var(--color-text-mute)]">$</span>
          {String(args.command ?? "")}
        </pre>
      </div>
    );
  }

  return (
    <pre className="max-h-56 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[length:var(--fs-xs)]">
      {JSON.stringify(args, null, 2)}
    </pre>
  );
}

function PathLabel({ path }: { path: string }) {
  return (
    <div className="truncate rounded-[var(--r-sm)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[length:var(--fs-xs)] text-[var(--color-text-dim)]">
      {path}
    </div>
  );
}

function DiffBlock({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const parts = diffLines(oldStr, newStr);
  return (
    <pre className="max-h-72 overflow-auto rounded-[var(--r-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[length:var(--fs-xs)] leading-relaxed">
      {parts.map((p, i) => {
        const lines = p.value.replace(/\n$/, "").split("\n");
        return lines.map((l, j) => (
          <div
            key={`${i}-${j}`}
            className={
              p.added
                ? "bg-[color-mix(in_srgb,var(--color-added)_12%,transparent)] text-[var(--color-added)]"
                : p.removed
                  ? "bg-[color-mix(in_srgb,var(--color-removed)_12%,transparent)] text-[var(--color-removed)]"
                  : "text-[var(--color-text-dim)]"
            }
          >
            <span className="mr-2 select-none opacity-60">
              {p.added ? "+" : p.removed ? "-" : " "}
            </span>
            {l}
          </div>
        ));
      })}
    </pre>
  );
}
