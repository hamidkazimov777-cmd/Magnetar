import { monaco } from "./monaco";
import type { CheckRun, Problem } from "./problems";

/* ==========================================================================
   PROBLEMS AS MARKERS IN THE CODE

   The checks already run and their output is already parsed into file, line,
   column and message — but all of it lived in a panel. An error you have to go
   and look for in a list is an error you do not fix: every editor people have
   used puts it under the offending code, and its absence read as "the editor
   does not know about errors at all".

   Markers are owned by a single name, so a fresh run replaces the previous
   result instead of accumulating.
   ========================================================================== */

const OWNER = "magnetar-checks";

function severityOf(p: Problem): number {
  if (p.severity === "error") return monaco.MarkerSeverity.Error;
  if (p.severity === "warning") return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

/** Underline the word the compiler pointed at, or the whole line when it gave
 *  no column — a marker with a zero-width range is invisible, which defeats
 *  the point. */
function rangeFor(model: monaco.editor.ITextModel, p: Problem) {
  const lineNumber = Math.min(Math.max(1, p.line), model.getLineCount());
  const maxColumn = model.getLineMaxColumn(lineNumber);

  if (!p.column || p.column < 1) {
    const firstNonSpace = model.getLineFirstNonWhitespaceColumn(lineNumber) || 1;
    return {
      startLineNumber: lineNumber,
      startColumn: firstNonSpace,
      endLineNumber: lineNumber,
      endColumn: maxColumn,
    };
  }

  const startColumn = Math.min(p.column, maxColumn);
  const word = model.getWordAtPosition({ lineNumber, column: startColumn });
  return {
    startLineNumber: lineNumber,
    startColumn,
    endLineNumber: lineNumber,
    endColumn: word ? word.endColumn : maxColumn,
  };
}

/** Path of a model, whatever URI scheme it was created with. */
function pathOf(model: monaco.editor.ITextModel): string {
  return model.uri.path || model.uri.toString();
}

/** Put every check's problems onto whichever files are currently open.
 *
 *  Called both when a check finishes and when a tab opens: a problem found
 *  while the file was closed still has to appear once it is opened. */
export function syncCheckMarkers(runs: Record<string, CheckRun>): void {
  const byFile = new Map<string, Problem[]>();
  for (const run of Object.values(runs)) {
    for (const p of run.problems ?? []) {
      const list = byFile.get(p.file);
      if (list) list.push(p);
      else byFile.set(p.file, [p]);
    }
  }

  for (const model of monaco.editor.getModels()) {
    const path = pathOf(model);
    // A problem's path is absolute; a model's may carry a scheme prefix, so
    // compare by suffix rather than demanding an exact match.
    const problems =
      byFile.get(path) ??
      [...byFile.entries()].find(([file]) => file.endsWith(path) || path.endsWith(file))?.[1];

    monaco.editor.setModelMarkers(
      model,
      OWNER,
      (problems ?? []).map((p) => ({
        ...rangeFor(model, p),
        message: p.code ? `${p.message} (${p.code})` : p.message,
        severity: severityOf(p),
        source: p.code ? undefined : "check",
      })),
    );
  }
}
