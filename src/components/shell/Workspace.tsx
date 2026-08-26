import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PanelRightOpen, ShieldAlert } from "../icons";
import { ActivityBar } from "./ActivityBar";
import { StatusBar } from "./StatusBar";
import { TerminalPanel } from "./TerminalPanel";
import { ExplorerPanel } from "../panels/ExplorerPanel";
import { ChatsPanel } from "../panels/ChatsPanel";
import { SearchPanel } from "../panels/SearchPanel";
import { GitPanel } from "../panels/GitPanel";
import { ChangesPanel } from "../panels/ChangesPanel";
import { ProblemsPanel } from "../panels/ProblemsPanel";
import { ProjectPanel } from "../panels/ProjectPanel";
import { StudioView } from "../StudioView";
import { ChatView } from "../ChatView";
import { SettingsView } from "../SettingsView";
import { ProjectsView } from "../ProjectsView";
import { RoadmapView } from "../RoadmapView";
import { KnowledgeGraphView } from "../KnowledgeGraphView";
import { TimelineView } from "../TimelineView";
import { SubscriptionsView } from "../SubscriptionsView";
import { useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/cn";
import { ErrorBoundary } from "../ui/ErrorBoundary";

const SIDEBAR_MIN = 190;
const SIDEBAR_MAX = 460;
const AGENT_MIN = 320;
const AGENT_MAX = 720;

// Monaco is the largest optional surface. Keep it out of the initial workspace
// route so chat/project onboarding can become useful before editor assets load.
const EditorArea = lazy(() =>
  import("../editor/EditorArea").then(({ EditorArea: component }) => ({ default: component })),
);

/** The single workspace screen: activity rail → primary panel → center (editor
 *  or a full page) → agent panel, with a terminal dock and a status bar.
 *  Nothing here swaps the whole screen; every surface keeps its context. */
export function Workspace({
  onOpenSettings,
  onOpenGuide,
}: {
  onOpenSettings: () => void;
  onOpenGuide: () => void;
}) {
  const t = useT();
  const sidePanel = useStore((s) => s.sidePanel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const centerView = useStore((s) => s.centerView);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const agentPanelOpen = useStore((s) => s.agentPanelOpen);
  const toggleAgentPanel = useStore((s) => s.toggleAgentPanel);
  const activeTrack = useStore((s) => s.activeTrack);
  // Generation takes over the centre as a studio; the chat panel steps aside.
  const showAgentPanel = agentPanelOpen && activeTrack !== "generation";

  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const workspaceTrusted = useStore((s) => s.workspaceTrusted);
  const trustWorkspace = useStore((s) => s.trustWorkspace);

  const [sidebarW, setSidebarW] = useState(248);
  const [agentW, setAgentW] = useState(420);
  const [termH, setTermH] = useState(260);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-[var(--color-bg)]">
      <ActivityBar onOpenSettings={onOpenSettings} onOpenGuide={onOpenGuide} />

      <div className="flex min-w-0 flex-1 flex-col">
        {workspaceRoot && !workspaceTrusted && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-raised,var(--color-surface))] px-3 py-2 text-[length:var(--fs-xs)]">
            <ShieldAlert size={14} className="shrink-0 text-[var(--color-warning,var(--color-text-dim))]" />
            <span className="min-w-0 flex-1 text-[var(--color-text-dim)]">
              {t("trustBannerBody")}
            </span>
            <button onClick={trustWorkspace} className="btn btn-secondary btn-sm shrink-0">
              {t("trustBannerAction")}
            </button>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {/* Primary side panel */}
          {sidebarOpen && (
            <>
              <aside
                className="flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]"
                style={{ width: sidebarW }}
              >
                <ErrorBoundary surface={t("navExplorer")}>
                  {sidePanel === "explorer" && <ExplorerPanel />}
                  {sidePanel === "chats" && <ChatsPanel />}
                  {sidePanel === "search" && <SearchPanel />}
                  {sidePanel === "git" && <GitPanel />}
                  {sidePanel === "changes" && <ChangesPanel />}
                  {sidePanel === "problems" && <ProblemsPanel />}
                  {sidePanel === "project" && <ProjectPanel />}
                </ErrorBoundary>
              </aside>
              <Resizer
                axis="x"
                onDrag={(dx) =>
                  setSidebarW((w) => clamp(w + dx, SIDEBAR_MIN, SIDEBAR_MAX))
                }
              />
            </>
          )}

          {/* Center: editor + terminal dock. It sits on the app floor while
              the flanking panels sit on raised surfaces, so the three regions
              read as distinct working areas rather than one continuous sheet. */}
          <main className="flex min-w-[300px] flex-1 flex-col bg-[var(--color-bg)]">
            <div
              data-tauri-drag-region
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <ErrorBoundary surface={t("workspace")}>
                {centerView === "editor" && (
                  <Suspense
                    fallback={
                      <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">
                        Loading editor…
                      </div>
                    }
                  >
                    <EditorArea />
                  </Suspense>
                )}
                {centerView === "studio" && <StudioView />}
                {centerView === "settings" && <SettingsView />}
                {centerView === "projects" && <ProjectsView />}
                {centerView === "roadmap" && <RoadmapView />}
                {centerView === "knowledge" && <KnowledgeGraphView />}
                {centerView === "timeline" && <TimelineView />}
                {centerView === "subscriptions" && <SubscriptionsView />}
              </ErrorBoundary>
            </div>

            {terminalOpen && (
              <>
                <Resizer
                  axis="y"
                  onDrag={(dy) => setTermH((h) => clamp(h - dy, 120, 620))}
                />
                <div style={{ height: termH }} className="shrink-0">
                  <ErrorBoundary surface={t("terminalTitle")}>
                    <TerminalPanel />
                  </ErrorBoundary>
                </div>
              </>
            )}
          </main>

          {/* Agent panel */}
          {showAgentPanel && (
            <>
              <Resizer
                axis="x"
                onDrag={(dx) => setAgentW((w) => clamp(w - dx, AGENT_MIN, AGENT_MAX))}
              />
              <aside
                aria-label={t("agentPanel")}
                // container-type (for the header's container query) establishes a
                // stacking context, which trapped the helper popover below the
                // z-10 resizer. relative z-20 lifts the panel — and everything
                // that overflows out of it — back above the divider.
                className="relative z-20 flex shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] @container/agent"
                style={{ width: agentW }}
              >
                <ErrorBoundary surface={t("agentPanel")}>
                  <ChatView onOpenSettings={onOpenSettings} />
                </ErrorBoundary>
              </aside>
            </>
          )}
        </div>

        <StatusBar onOpenSettings={onOpenSettings} />
      </div>

      {/* When the agent panel is collapsed it takes its own reopen control with
          it — this pull-tab on the right edge brings it back without hunting
          through the chat list. */}
      {!agentPanelOpen && activeTrack !== "generation" && (
        <button
          onClick={() => toggleAgentPanel(true)}
          title={t("cmdToggleAgentPanel")}
          aria-label={t("cmdToggleAgentPanel")}
          className="absolute right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-[var(--r-md)] border border-r-0 border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-3 text-[var(--color-text-dim)] shadow-md transition-colors hover:text-[var(--color-text)]"
        >
          <PanelRightOpen size={16} />
        </button>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** A thin draggable divider. Reports movement deltas; the parent owns the size. */
function Resizer({
  axis,
  onDrag,
}: {
  axis: "x" | "y";
  onDrag: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const cur = axis === "x" ? e.clientX : e.clientY;
      onDrag(cur - last.current);
      last.current = cur;
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, axis, onDrag]);

  return (
    <div
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      onMouseDown={(e) => {
        // Without this the drag starts a text selection in whatever it passes
        // over — the transcript ends up highlighted every time you resize.
        e.preventDefault();
        last.current = axis === "x" ? e.clientX : e.clientY;
        setDragging(true);
      }}
      className={cn(
        "group/rz relative z-10 shrink-0 transition-colors",
        axis === "x" ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        dragging
          ? "bg-[var(--color-accent)]"
          : "bg-[var(--color-border)] hover:bg-[var(--color-border-strong)]",
      )}
    >
      {/* Wider invisible hit area than the 1px visual line. */}
      <span
        className={cn(
          "absolute",
          axis === "x" ? "-left-1 -right-1 inset-y-0" : "-top-1 -bottom-1 inset-x-0",
        )}
      />
    </div>
  );
}
