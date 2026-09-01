import { db, type SessionMetaRow } from "../db";
import { reportPromise } from "../errors";
import type { Session } from "../types";

/* ==========================================================================
   SHARED STORE VOCABULARY

   The pieces every domain slice needs: the small shell/editor types, the
   preference defaults, and the write-through helper that keeps SQLite in step
   with memory. Kept free of any slice import so a slice can depend on this
   without depending on its neighbours.
   ========================================================================== */

/** Which panel the activity bar shows in the primary (left) sidebar. */
export type SidePanel =
  | "explorer"
  | "chats"
  | "git"
  | "search"
  | "changes"
  | "problems"
  | "tasks"
  | "debug"
  | "project";

/** What the center area renders: the code editor, or a full-width page. */
export type CenterView =
  | "editor"
  | "studio"
  | "settings"
  | "projects"
  | "roadmap"
  | "timeline"
  | "subscriptions";

/** An open editor tab. Tabs live in the store so the agent and Source Control
 *  can open things too. `kind: "diff"` renders a git diff instead of an editor. */
export interface EditorTab {
  path: string;
  name: string;
  kind?: "file" | "diff";
  /** Diff tabs only: show the staged diff rather than the working-tree diff. */
  staged?: boolean;
  /** Pinned tabs sort first and survive "close all".
   *
   *  The point is not decoration: the two or three files you keep coming back
   *  to get lost among the dozen a search or an agent run opened, and closing
   *  the clutter used to close them too. */
  pinned?: boolean;
}

/** Sentinel title for a freshly created chat; the UI renders it translated. */
export const NEW_CHAT_TITLE = "__new_chat__";

/** One file mutation made by the agent, kept so the user can review and undo.
 *  `before === null` means the agent created the file. */
export interface FileChange {
  id: string;
  path: string;
  before: string | null;
  after: string;
  tool: "write_file" | "edit_file";
  at: number;
  reverted?: boolean;
  /** The agent run that made this edit, so the Changes panel can group a task's
   *  edits and roll the whole task back at once. Absent for edits made outside a
   *  run. */
  runId?: string;
}

/** User-facing behaviour switches, surfaced in Settings. */
export interface Prefs {
  /** Apply agent edits immediately and let the user review/undo (VS Code-like),
   *  instead of blocking on a confirm dialog for every single write. */
  autoApplyEdits: boolean;
  /** Write a file to disk shortly after it stops being edited.
   *
   *  Off by default. Turning it on for someone silently means their editor
   *  starts changing files on disk without them asking, which is the opposite
   *  of what an agent-driven tool should assume. */
  autosave: boolean;
  /** Run the project's formatter before writing the file.
   *
   *  Off by default, like autosave and for the same reason: a tool that
   *  reformats someone's file the first time they press ⌘S, without being
   *  asked, produces a diff they did not write. */
  formatOnSave: boolean;
  /** How long the file has to sit still first. */
  autosaveDelayMs: number;
  /** Shell commands are never auto-approved unless the user opts in. */
  confirmBash: boolean;
  /** How many tool-use rounds the agent may take before stopping. */
  agentMaxSteps: number;
  /** Token ceiling for one run (input + output, summed across turns). A run
   *  that crosses it stops with an explainable reason instead of burning
   *  tokens until the provider runs out of credit — the failure mode that
   *  motivated the agent guardrails. 0 disables the ceiling. */
  agentMaxTokens: number;
  /** Seconds a single shell command may run (npm install/cargo build are slow). */
  bashTimeoutSecs: number;
  /** Model used for background work: project memory, handoff notes, knowledge
   *  graph. Undefined = pick automatically. Explicit is safer — the automatic
   *  pick can land on a catalogue entry the token cannot actually call. */
  memoryModel?: { connectionId: string; model: string };
  /** The bench of models helper agents run on. Tasks are handed out round
   *  robin, so three models and three parallel helpers means each task runs on
   *  a different one — mixing providers on purpose is allowed and useful.
   *  Empty means the helpers use the lead's model. */
  subagentRoster: { connectionId: string; model: string }[];
  /** How many helpers actually run at once. More than a handful is not
   *  followable on screen, and providers rate-limit anyway. */
  subagentParallel: number;
  editorFontSize: number;
  editorWordWrap: boolean;
  editorMinimap: boolean;
  /** Offer AI ghost-text completions in the editor. Off by default: it spends
   *  tokens on every pause and needs a configured model, so it is a choice the
   *  user makes, not a surprise on their bill. Uses the memory model when set,
   *  otherwise the chat's model. */
  inlineCompletion: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  autoApplyEdits: true,
  autosave: false,
  formatOnSave: false,
  autosaveDelayMs: 1000,
  confirmBash: true,
  agentMaxSteps: 80,
  agentMaxTokens: 400_000,
  bashTimeoutSecs: 600,
  subagentParallel: 3,
  subagentRoster: [],
  editorFontSize: 13,
  editorWordWrap: false,
  editorMinimap: true,
  inlineCompletion: false,
};

export const uid = () =>
  (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string;

export const now = () => Date.now();

/** The canon (sessions/messages) lives in SQLite; connections and preferences
 *  stay in localStorage. Mutations update memory immediately and write through
 *  to the DB in the background (fire-and-forget — chat never blocks on disk). */

function metaOf(s: Session): SessionMetaRow {
  return {
    id: s.id,
    title: s.title,
    connectionId: s.connectionId ?? null,
    model: s.model ?? null,
    summary: s.summary ?? null,
    summaryUpToId: s.summaryUpToId ?? null,
    projectId: s.projectId ?? null,
    track: s.track ?? null,
    seesProject: s.seesProject ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const persistMeta = (s: Session) =>
  void reportPromise(db.saveSession(metaOf(s)), "db:save_session");
