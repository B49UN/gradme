import { XMLParser } from "fast-xml-parser";
import "server-only";

export type ResolvedPaperMetadata = {
  title: string | null;
  authors: string[];
  venue: string | null;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  pdfUrl: string | null;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
});

function normalizeCrossrefAuthors(items: Array<Record<string, string>> | undefined) {
  if (!items) {
    return [];
  }

  return items
    .map((item) => [item.given, item.family].filter(Boolean).join(" ").trim())
    .filter(Boolean);
}

export async function fetchCrossrefMetadata(doi: string): Promise<ResolvedPaperMetadata | null> {
  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    {
      headers: {
        "User-Agent": "GradMe/0.1 (Local research assistant)",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    message?: {
      title?: string[];
      author?: Array<Record<string, string>>;
      "container-title"?: string[];
      published?: { "date-parts"?: number[][] };
      abstract?: string;
      DOI?: string;
      link?: Array<{ URL?: string; "content-type"?: string }>;
    };
  };
  const message = payload.message;

  if (!message) {
    return null;
  }

  const dateParts = message.published?.["date-parts"]?.[0];
  const pdfLink =
    message.link?.find((item) => item["content-type"] === "application/pdf")?.URL ?? null;

  return {
    title: message.title?.[0] ?? null,
    authors: normalizeCrossrefAuthors(message.author),
    venue: message["container-title"]?.[0] ?? null,
    year: dateParts?.[0] ?? null,
    abstract: message.abstract?.replace(/<\/?jats:[^>]+>/g, "").replace(/<[^>]+>/g, " ") ?? null,
    doi: message.DOI ?? doi,
    arxivId: null,
    pdfUrl: pdfLink,
  };
}

export async function fetchArxivMetadata(identifier: string): Promise<ResolvedPaperMetadata | null> {
  const response = await fetch(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(identifier)}`,
    {
      headers: {
        "User-Agent": "GradMe/0.1 (Local research assistant)",
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  const payload = xmlParser.parse(xml) as {
    feed?: {
      entry?: {
        id?: string;
        title?: string;
        summary?: string;
        author?: Array<{ name?: string }> | { name?: string };
        published?: string;
      };
    };
  };
  const entry = payload.feed?.entry;

  if (!entry) {
    return null;
  }

  const authors = Array.isArray(entry.author)
    ? entry.author.map((item) => item.name).filter(Boolean)
    : entry.author?.name
      ? [entry.author.name]
      : [];

  return {
    title: entry.title?.replace(/\s+/g, " ").trim() ?? null,
    authors: authors as string[],
    venue: "arXiv",
    year: entry.published ? new Date(entry.published).getFullYear() : null,
    abstract: entry.summary?.replace(/\s+/g, " ").trim() ?? null,
    doi: null,
    arxivId: identifier,
    pdfUrl: `https://arxiv.org/pdf/${identifier}.pdf`,
  };
}

export async function resolveIdentifier(identifier: string) {
  const normalized = identifier.trim();
  const arxivMatch = normalized.match(/(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)$/i);

  if (arxivMatch) {
    const metadata = await fetchArxivMetadata(arxivMatch[1]);
    return metadata;
  }

  return fetchCrossrefMetadata(normalized);
}
