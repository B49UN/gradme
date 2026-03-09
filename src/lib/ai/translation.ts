import type { PaperChunkRecord } from "@/lib/types";

export type TranslationSection = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  contentMd: string;
};

const SECTION_HEADING_PATTERN =
  /^###\s+p\.(\d+)(?:-(\d+))?(?:\s+[·|-]\s*(.+))?$/;

function unwrapMarkdownFence(content: string) {
  const fencedMatch = content.trim().match(/^```(?:markdown)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch?.[1]?.trim() ?? content.trim();
}

export function formatTranslationPageRange(pageStart: number, pageEnd: number) {
  return pageStart === pageEnd ? `p.${pageStart}` : `p.${pageStart}-${pageEnd}`;
}

export function sanitizeTranslationSectionContent(content: string) {
  let sanitized = content.trim();
  sanitized = sanitized.replace(/^##\s+전문 번역\s*/i, "").trim();
  sanitized = unwrapMarkdownFence(sanitized);
  sanitized = sanitized.replace(/^###\s+p\.\d+(?:-\d+)?(?:\s+[·|-]\s*.+)?\s*/i, "").trim();
  return sanitized;
}

export function createTranslationSection(
  chunk: PaperChunkRecord,
  contentMd: string,
): TranslationSection {
  return {
    chunkIndex: chunk.chunkIndex,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    heading: chunk.heading,
    contentMd: sanitizeTranslationSectionContent(contentMd),
  };
}

export function buildTranslationDocument(sections: TranslationSection[]) {
  return buildTranslationDocumentWithOptions(sections);
}

export function buildTranslationDocumentWithOptions(
  sections: TranslationSection[],
  options?: {
    title?: string;
    description?: string | null;
  },
) {
  if (sections.length === 0) {
    return `${options?.title ?? "## 전문 번역"}\n\n번역 결과가 없습니다.`;
  }

  const lines = [options?.title ?? "## 전문 번역", ""];

  if (options?.description?.trim()) {
    lines.push(options.description.trim(), "");
  }

  for (const section of sections) {
    const headingSuffix = section.heading ? ` · ${section.heading}` : "";
    lines.push(`### ${formatTranslationPageRange(section.pageStart, section.pageEnd)}${headingSuffix}`);
    lines.push("");
    lines.push(sanitizeTranslationSectionContent(section.contentMd) || "_빈 번역 결과_");
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function getTranslationSectionsRange(sections: TranslationSection[]) {
  if (sections.length === 0) {
    return null;
  }

  return {
    pageStart: sections[0].pageStart,
    pageEnd: sections.at(-1)?.pageEnd ?? sections[0].pageEnd,
  };
}

export function parseTranslationDocument(contentMd: string) {
  const lines = contentMd.split(/\r?\n/);
  const sections: TranslationSection[] = [];
  let current: TranslationSection | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (!current) {
      return;
    }

    sections.push({
      ...current,
      contentMd: bodyLines.join("\n").trim(),
    });
    current = null;
    bodyLines = [];
  };

  for (const line of lines) {
    const match = line.match(SECTION_HEADING_PATTERN);

    if (match) {
      flush();
      const pageStart = Number(match[1]);
      const pageEnd = Number(match[2] ?? match[1]);
      current = {
        chunkIndex: sections.length,
        pageStart,
        pageEnd,
        heading: match[3]?.trim() ?? null,
        contentMd: "",
      };
      continue;
    }

    if (current) {
      bodyLines.push(line);
    }
  }

  flush();
  return sections;
}

export function findTranslationSectionForPage(
  sections: TranslationSection[],
  page: number,
) {
  return sections.find(
    (section) => page >= section.pageStart && page <= section.pageEnd,
  ) ?? null;
}
