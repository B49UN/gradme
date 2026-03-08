import { describe, expect, it } from "vitest";
import { inferApiFormatFromBaseUrl, normalizeAiBaseUrl } from "@/lib/ai/profile-utils";

describe("AI profile utils", () => {
  it("normalizes endpoint URLs back to the API root", () => {
    expect(normalizeAiBaseUrl("https://api.openai.com/v1/responses")).toBe(
      "https://api.openai.com/v1",
    );
    expect(normalizeAiBaseUrl("https://example.com/openai/v1/chat/completions")).toBe(
      "https://example.com/openai/v1",
    );
  });

  it("infers the intended API format from the URL suffix", () => {
    expect(inferApiFormatFromBaseUrl("https://api.openai.com/v1/responses")).toBe("responses");
    expect(inferApiFormatFromBaseUrl("https://example.com/v1/chat/completions")).toBe(
      "chat-completions",
    );
    expect(inferApiFormatFromBaseUrl("https://api.openai.com/v1")).toBe("responses");
  });
});
