import type { AiApiFormat, ReasoningEffort } from "@/lib/types";

const endpointSuffixes = ["/responses", "/chat/completions"] as const;

export function inferApiFormatFromBaseUrl(baseUrl: string): AiApiFormat {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  if (normalized.endsWith("/chat/completions")) {
    return "chat-completions";
  }

  return "responses";
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
