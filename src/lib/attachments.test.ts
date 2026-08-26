import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  api: { attachmentWrite: vi.fn(async () => {}), attachmentRead: vi.fn(async () => null) },
}));

const { api } = await import("./api");
const { fromMetadata, keepBytes, loadBytes, toMetadata } = await import("./attachments");
import type { Attachment } from "./types";

const image = (over: Partial<Attachment> = {}): Attachment => ({
  id: "a1",
  type: "image",
  mimeType: "image/png",
  name: "shot.png",
  data: "AAAA",
  ...over,
});

describe("what goes in the message row", () => {
  it("keeps the metadata and never the bytes", () => {
    // A message row is read on every launch and every render. Base64 in it
    // would be paid for continuously to show a picture only when scrolled to.
    const json = toMetadata([image()]);
    expect(json).not.toContain("AAAA");
    const back = fromMetadata(json)!;
    expect(back[0]).toMatchObject({ id: "a1", name: "shot.png", mimeType: "image/png" });
    expect(back[0].data).toBeUndefined();
  });

  it("stores nothing for a message with no attachments", () => {
    expect(toMetadata(undefined)).toBeNull();
    expect(toMetadata([])).toBeNull();
    expect(fromMetadata(null)).toBeUndefined();
  });

  it("treats a corrupt value as no attachments rather than taking the chat down", () => {
    expect(fromMetadata("not json")).toBeUndefined();
    expect(fromMetadata('{"nope":1}')).toBeUndefined();
    expect(fromMetadata("[{}]")).toBeUndefined();
    expect(fromMetadata('[{"id":"a1","name":"x"},{"junk":true}]')).toHaveLength(1);
  });
});

describe("the bytes themselves", () => {
  it("writes only what has data", () => {
    const write = vi.mocked(api.attachmentWrite);
    write.mockClear();
    keepBytes([image(), image({ id: "a2", data: undefined })]);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("a1", "AAAA");
  });

  it("uses what it already has instead of asking again", async () => {
    const read = vi.mocked(api.attachmentRead);
    read.mockClear();
    expect(await loadBytes(image())).toBe("AAAA");
    expect(read).not.toHaveBeenCalled();
  });

  it("reports a vanished file as missing, not as a failure", async () => {
    const read = vi.mocked(api.attachmentRead);
    read.mockClear().mockResolvedValue(null);
    expect(await loadBytes(image({ data: undefined }))).toBeNull();

    // Someone who cleared the folder should still be able to read the
    // conversation, so an error is answered the same way as an absence.
    read.mockRejectedValue(new Error("gone"));
    expect(await loadBytes(image({ data: undefined }))).toBeNull();
  });
});
