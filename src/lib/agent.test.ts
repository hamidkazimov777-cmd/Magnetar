import { beforeEach, describe, expect, it } from "vitest";
import { needsConfirm, parseTextToolCall, summarizeArgs } from "./agent";
import { useStore } from "./store";

describe("recovering a tool call a model wrote as text", () => {
  it("reads an XML invoke block and recovers parameter types", () => {
    const call = parseTextToolCall(
      `I will look at the file.
<invoke name="read_file">
<parameter name="path">src/main.ts</parameter>
<parameter name="offset">120</parameter>
<parameter name="raw">true</parameter>
</invoke>`,
    );
    expect(call).toEqual({
      action: "read_file",
      input: { path: "src/main.ts", offset: 120, raw: true },
    });
  });

  it("parses a JSON parameter and keeps a malformed one as text", () => {
    const call = parseTextToolCall(
      `<invoke name="delegate">
<parameter name="tasks">[{"title":"a"}]</parameter>
<parameter name="note">{not json</parameter>
</invoke>`,
    );
    expect(call!.input.tasks).toEqual([{ title: "a" }]);
    expect(call!.input.note).toBe("{not json");
  });

  it("reads the ReAct scaffolding we asked for", () => {
    expect(parseTextToolCall('Thought: check it\nAction: grep\nAction Input: {"pattern":"todo"}'))
      .toEqual({ action: "grep", input: { pattern: "todo" } });
  });

  it("stops Action Input at the observation that follows it", () => {
    const call = parseTextToolCall(
      'Action: grep\nAction Input: {"pattern":"todo"}\nObservation: {"pattern":"stale"}',
    );
    expect(call!.input).toEqual({ pattern: "todo" });
  });

  it("accepts a fenced or bare call from a model that dropped the format", () => {
    expect(parseTextToolCall('list_dir {"path": "."}')).toEqual({
      action: "list_dir",
      input: { path: "." },
    });
    expect(parseTextToolCall('```\nsearch_code {"query": "lease"}\n```')).toEqual({
      action: "search_code",
      input: { query: "lease" },
    });
  });

  it("refuses anything that is not a real tool, and plain prose", () => {
    expect(parseTextToolCall('<invoke name="rm_rf"><parameter name="path">/</parameter></invoke>'))
      .toBeNull();
    expect(parseTextToolCall('Action: delete_everything\nAction Input: {}')).toBeNull();
    expect(parseTextToolCall("Here is what I would do next.")).toBeNull();
    expect(parseTextToolCall("")).toBeNull();
  });

  it("treats a final answer as an answer, not a call", () => {
    expect(parseTextToolCall("Final Answer: the file is empty.")).toBeNull();
  });

  it("returns empty arguments when the input is unparseable rather than throwing", () => {
    expect(parseTextToolCall("Action: list_dir\nAction Input: nonsense")).toEqual({
      action: "list_dir",
      input: {},
    });
  });
});

describe("summarising a call for the run trace", () => {
  it("shows the part of the call a reader needs", () => {
    expect(summarizeArgs("read_file", { path: "src/a.ts" })).toBe("→ src/a.ts");
    expect(summarizeArgs("grep", { pattern: "todo" })).toBe('→ "todo"');
    expect(summarizeArgs("delegate", { tasks: [1, 2, 3] })).toBe("→ 3");
    expect(summarizeArgs("read_file", {})).toBe("→ ");
    expect(summarizeArgs("unknown_tool", { path: "x" })).toBe("");
  });

  it("truncates a long command instead of flooding the trace", () => {
    expect(summarizeArgs("run_bash", { command: "x".repeat(200) })).toHaveLength(82);
  });

  it("counts nothing when delegate was handed a non-list", () => {
    expect(summarizeArgs("delegate", { tasks: "oops" })).toBe("→ 0");
  });
});

describe("deciding what must stop and ask", () => {
  beforeEach(() => {
    useStore.setState({
      prefs: { ...useStore.getState().prefs, autoApplyEdits: true, confirmBash: true },
      trustCommands: false,
    });
  });

  it("never waves through a credential file or a destructive command", () => {
    expect(needsConfirm("write_file", { path: ".env" })).toBe(true);
    expect(needsConfirm("run_bash", { command: "rm -rf build" })).toBe(true);
  });

  it("leaves read-only tools alone", () => {
    expect(needsConfirm("read_file", { path: "src/a.ts" })).toBe(false);
    expect(needsConfirm("list_dir", { path: "." })).toBe(false);
  });

  it("honours auto-apply for routine edits and stops when it is off", () => {
    expect(needsConfirm("edit_file", { path: "src/a.ts" })).toBe(false);
    useStore.setState({ prefs: { ...useStore.getState().prefs, autoApplyEdits: false } });
    expect(needsConfirm("edit_file", { path: "src/a.ts" })).toBe(true);
  });

  it("stops asking about shell once the user trusted commands for this run", () => {
    expect(needsConfirm("run_bash", { command: "npm test" })).toBe(true);
    useStore.setState({ trustCommands: true });
    expect(needsConfirm("run_bash", { command: "npm test" })).toBe(false);
    expect(needsConfirm("run_bash", { command: "rm -rf build" })).toBe(true);
  });
});
