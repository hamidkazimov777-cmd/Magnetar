import { describe, expect, it, vi, beforeEach } from "vitest";

// The client talks through the api transport; capture what it sends and feed
// it responses by hand, so the sequence-number correlation is what is tested.
let onMsg: ((raw: string) => void) | null = null;
const sent: string[] = [];

vi.mock("../api", () => ({
  api: {
    dapSpawn: vi.fn(async (_id, _cmd, _args, _cwd, cb: (raw: string) => void) => {
      onMsg = cb;
    }),
    dapSend: vi.fn(async (_id: string, message: string) => {
      sent.push(message);
    }),
    dapKill: vi.fn(async () => {}),
  },
}));

const { DapClient } = await import("./dap");

beforeEach(() => {
  onMsg = null;
  sent.length = 0;
});

async function connected() {
  const client = new DapClient("test");
  await client.spawn("adapter", []);
  return client;
}

describe("matching responses to requests", () => {
  it("resolves a request with the response carrying its sequence number", async () => {
    const client = await connected();
    const p = client.request("stackTrace", { threadId: 1 });

    const req = JSON.parse(sent[0]);
    expect(req.command).toBe("stackTrace");

    onMsg!(
      JSON.stringify({
        seq: 10,
        type: "response",
        request_seq: req.seq,
        success: true,
        command: "stackTrace",
        body: { stackFrames: [{ id: 1, name: "main", line: 5 }] },
      }),
    );

    await expect(p).resolves.toMatchObject({ stackFrames: [{ name: "main" }] });
  });

  it("does not resolve a request from another request's response", async () => {
    // The bug this guards against shows the wrong variables under the right
    // frame, or a step's result attributed to a continue.
    const client = await connected();
    const first = client.request("scopes", { frameId: 1 });
    const second = client.request("variables", { variablesReference: 2 });

    const secondSeq = JSON.parse(sent[1]).seq;
    onMsg!(
      JSON.stringify({
        seq: 11,
        type: "response",
        request_seq: secondSeq,
        success: true,
        command: "variables",
        body: { variables: [{ name: "x", value: "1", variablesReference: 0 }] },
      }),
    );

    await expect(second).resolves.toMatchObject({ variables: [{ name: "x" }] });
    // The first is still outstanding — nothing resolved it.
    let firstSettled = false;
    void first.then(() => (firstSettled = true));
    await Promise.resolve();
    expect(firstSettled).toBe(false);
  });

  it("rejects a failed request with the adapter's own message", async () => {
    const client = await connected();
    const p = client.request("evaluate", { expression: "nope" });
    const seq = JSON.parse(sent[0]).seq;
    onMsg!(
      JSON.stringify({
        seq: 3,
        type: "response",
        request_seq: seq,
        success: false,
        command: "evaluate",
        message: "name 'nope' is not defined",
      }),
    );
    await expect(p).rejects.toThrow("name 'nope' is not defined");
  });
});

describe("events", () => {
  it("delivers an event body to its handler", () => {
    const client = new DapClient("test");
    const seen: unknown[] = [];
    client.on("stopped", (body) => seen.push(body));
    // Wire the transport by spawning.
    void client.spawn("a", []).then(() => {
      onMsg!(JSON.stringify({ seq: 1, type: "event", event: "stopped", body: { reason: "breakpoint", threadId: 1 } }));
      expect(seen).toEqual([{ reason: "breakpoint", threadId: 1 }]);
    });
  });
});

describe("ending a session", () => {
  it("rejects every outstanding request rather than leaving them hung", async () => {
    const client = await connected();
    const p = client.request("stackTrace");
    await client.stop();
    await expect(p).rejects.toThrow(/ended/);
    // And refuses new requests after.
    await expect(client.request("scopes")).rejects.toThrow(/ended/);
  });
});
