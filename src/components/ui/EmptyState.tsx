import type { LucideIcon } from "lucide-react";

/** The single empty-state treatment used by every panel and view in the app:
 *  icon, title, one line of guidance, and — crucially — a way forward. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  secondaryAction,
}: {
  icon?: LucideIcon;
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <div className="empty-inner">
        {Icon && <Icon size={34} strokeWidth={1.5} className="empty-icon" />}
        <div className="empty-title">{title}</div>
        {text && <p className="empty-text">{text}</p>}
        {(action || secondaryAction) && (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {action && (
              <button className="btn btn-primary" onClick={action.onClick}>
                {action.label}
              </button>
            )}
            {secondaryAction && (
              <button className="btn btn-secondary" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
