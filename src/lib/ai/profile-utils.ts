import type { AiApiFormat, AiProvider, ReasoningEffort } from "@/lib/types";

const endpointSuffixes = ["/responses", "/chat/completions"] as const;
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GOOGLE_AI_STUDIO_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export function inferProviderFromBaseUrl(baseUrl: string): AiProvider {
  const normalized = baseUrl.trim();

  try {
    const parsed = new URL(normalized);

    if (parsed.hostname === "generativelanguage.googleapis.com") {
      return "google-ai-studio";
    }
  } catch {
    return "openai";
  }

  return "openai";
}

export function inferApiFormatFromBaseUrl(baseUrl: string): AiApiFormat {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const provider = inferProviderFromBaseUrl(normalized);

  if (normalized.endsWith("/chat/completions")) {
    return "chat-completions";
  }

  if (provider === "google-ai-studio") {
    return "chat-completions";
  }

  return "responses";
}

export function getProviderDefaults(provider: AiProvider) {
  if (provider === "google-ai-studio") {
    return {
      provider,
      baseUrl: GOOGLE_AI_STUDIO_BASE_URL,
      apiFormat: "chat-completions" as const,
      model: "gemini-2.5-flash",
      supportsVision: true,
      maxOutputTokens: 8192,
      reasoningEffort: "medium" as ReasoningEffort,
      apiKeyPlaceholder: "AIza...",
      providerDescription: "Google AI Studio API key + Gemini OpenAI-compatible Chat Completions",
    };
  }

  return {
    provider,
    baseUrl: OPENAI_BASE_URL,
    apiFormat: "responses" as const,
    model: "gpt-5.1",
    supportsVision: true,
    maxOutputTokens: 1600,
    reasoningEffort: "medium" as ReasoningEffort,
    apiKeyPlaceholder: "sk-...",
    providerDescription: "OpenAI API key + Responses API 기본값",
  };
}

export function normalizeAiBaseUrl(baseUrl: string) {
  const parsed = new URL(baseUrl.trim());
  let pathname = parsed.pathname.replace(/\/+$/, "");

  for (const suffix of endpointSuffixes) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length) || "/";
      break;
    }
  }

  parsed.pathname = pathname || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeReasoningEffort(
  value: ReasoningEffort | null | undefined,
): ReasoningEffort | null {
  return value ?? null;
}
