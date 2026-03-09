import { describe, expect, it } from "vitest";
import {
  getProviderDefaults,
  inferApiFormatFromBaseUrl,
  inferProviderFromBaseUrl,
  normalizeAiBaseUrl,
} from "@/lib/ai/profile-utils";

describe("AI profile utils", () => {
  it("normalizes endpoint URLs back to the API root", () => {
    expect(normalizeAiBaseUrl("https://api.openai.com/v1/responses")).toBe(
      "https://api.openai.com/v1",
    );
    expect(normalizeAiBaseUrl("https://example.com/openai/v1/chat/completions")).toBe(
      "https://example.com/openai/v1",
    );
    expect(normalizeAiBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai")).toBe(
      "https://generativelanguage.googleapis.com",
    );
  });

  it("infers the intended API format from the URL suffix", () => {
    expect(inferApiFormatFromBaseUrl("https://api.openai.com/v1/responses")).toBe("responses");
    expect(inferApiFormatFromBaseUrl("https://example.com/v1/chat/completions")).toBe(
      "chat-completions",
    );
    expect(inferApiFormatFromBaseUrl("https://api.openai.com/v1")).toBe("responses");
    expect(inferApiFormatFromBaseUrl("https://generativelanguage.googleapis.com")).toBe(
      "gemini-native",
    );
  });

  it("recognizes native gemini endpoints and presets", () => {
    expect(
      inferProviderFromBaseUrl("https://generativelanguage.googleapis.com"),
    ).toBe("google-gemini");
    expect(getProviderDefaults("google-gemini").apiFormat).toBe("gemini-native");
  });
});
