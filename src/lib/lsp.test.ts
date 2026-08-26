import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { LspClient } from "./lsp";

describe("LSP request lifecycle", () => {
  it("cancels an in-flight request and sends JSON-RPC cancellation", async () => {
    vi.spyOn(api, "lspSend").mockResolvedValue(undefined);
    let cancel: (() => void) | undefined;
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (cb: () => void) => {
        cancel = cb;
      },
    };
    const client = new LspClient("test", "fake-lsp", [], undefined);
    const pending = client.request("textDocument/hover", {}, { token, timeoutMs: 1000 });

    cancel?.();

    await expect(pending).rejects.toThrow("cancelled");
    const sends = vi.mocked(api.lspSend).mock.calls;
    expect(sends).toHaveLength(2);
    expect(JSON.parse(sends[1][1])).toMatchObject({
      method: "$/cancelRequest",
      params: { id: 1 },
    });
    vi.restoreAllMocks();
  });
});
