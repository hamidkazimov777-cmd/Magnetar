import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert, RotateCcw } from "lucide-react";
import { translate } from "../../lib/i18n";
import { useStore } from "../../lib/store";

interface Props {
  children: ReactNode;
  /** Optional label so the message says which surface failed. */
  surface?: string;
}
interface State {
  error: Error | null;
}

/** Keeps one broken panel from blanking the whole window. Renders a readable
 *  failure with a way to recover instead of an empty screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Magnetar] UI error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const lang = useStore.getState().lang;
    const t = (k: string) => translate(lang, k);

    return (
      <div className="empty">
        <div className="empty-inner">
          <TriangleAlert size={32} strokeWidth={1.5} className="empty-icon" />
          <div className="empty-title">{t("errorTitle")}</div>
          {this.props.surface && (
            <p className="mt-1 text-[length:var(--fs-xs)] uppercase tracking-wide text-[var(--color-text-mute)]">
              {this.props.surface}
            </p>
          )}
          <p className="empty-text break-words font-mono text-[length:var(--fs-xs)]">
            {error.message}
          </p>
          <button
            className="btn btn-secondary mt-5"
            onClick={() => this.setState({ error: null })}
          >
            <RotateCcw size={14} />
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }
}
