import { describe, expect, it } from "vitest";
import { buildCatalog, classifyPrompt, modelTier, recommend } from "./adaptive";
import type { Connection, ModelInfo } from "./types";

const connections: Connection[] = [
  { id: "local", name: "Local", kind: "openai_compat", baseUrl: "http://localhost:11434/v1" },
  { id: "cloud", name: "Cloud", kind: "openai_compat", baseUrl: "https://example.test/v1" },
];

const models: Record<string, ModelInfo[]> = {
  local: [{ id: "qwen-mini" }],
  cloud: [{ id: "gpt-5" }],
};

describe("adaptive routing", () => {
  it("classifies short and implementation prompts", () => {
    expect(classifyPrompt("привет").tier).toBe("light");
    expect(classifyPrompt("implement a parser for the workspace").tier).toBe("heavy");
  });

  it("builds a provider-neutral catalog and offers a stronger opt-in model", () => {
    expect(modelTier("qwen-mini")).toBe("light");
    const catalog = buildCatalog(connections, models);
    const result = recommend("build a parser", catalog, {
      connectionId: "local",
      model: "qwen-mini",
    });
    expect(result.pick?.model).toBe("gpt-5");
    expect(result.upgrade?.connectionId).toBe("cloud");
  });
});
