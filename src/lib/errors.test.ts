import { describe, expect, it, vi } from "vitest";
import { redactSecrets, reportError, toAppError } from "./errors";

describe("error reporting", () => {
  it("redacts credential-shaped values before logging", () => {
    const safe = redactSecrets("Authorization: Bearer sk-1234567890123456 api_key=secret-value");
    expect(safe).not.toContain("sk-1234567890123456");
    expect(safe).not.toContain("secret-value");
    expect(safe).toContain("[REDACTED]");
  });

  it("normalises unknown errors and classifies retryable failures", () => {
    expect(toAppError(new Error("request timed out"), "provider")).toMatchObject({
      context: "provider",
      message: "request timed out",
      retryable: true,
    });
    expect(toAppError({ nope: true }, "parse").message).toBe('{"nope":true}');
  });

  it("reports a safe message through the shared sink", () => {
    const sink = vi.fn();
    const error = reportError("token: secret-value", "test", sink);
    expect(error.message).toContain("[REDACTED]");
    expect(sink).toHaveBeenCalledWith(expect.stringContaining("[REDACTED]"), error);
  });
});
