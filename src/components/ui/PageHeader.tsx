import type { IconType } from "../icons";

/** Header for every full-width page in the center area.
 *
 *  The subtitle is not decoration: it is where each page states what it holds
 *  (facts, tasks, knowledge, history), which is how the product explains its
 *  own structure without a tour. */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: IconType;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header
      data-tauri-drag-region
      className="mx-auto flex w-full max-w-[1080px] shrink-0 items-start gap-4 px-8 pb-7 pt-9"
    >
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2.5 text-[length:var(--fs-xl)] font-semibold tracking-[-0.015em]">
          <Icon
            size={18}
            strokeWidth={1.75}
            className="shrink-0 text-[var(--color-text-dim)]"
          />
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-[620px] text-[length:var(--fs-base)] leading-[var(--lh-base)] text-[var(--color-text-dim)]">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}
