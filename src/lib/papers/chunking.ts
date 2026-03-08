import { estimateTokens } from "@/lib/utils";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ChunkInput = {
  heading: string | null;
  content: string;
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
  tokenEstimate: number;
};

const HEADING_PATTERN =
  /^(abstract|introduction|background|related work|method|methods|methodology|experiment|experimental setup|results|discussion|conclusion|limitations|references|appendix|[1-9](\.[0-9]+)*\s+.+)$/i;

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function isLikelyHeading(line: string) {
  const normalized = normalizeLine(line);

  if (!normalized || normalized.length > 120) {
    return false;
  }

  return HEADING_PATTERN.test(normalized);
}

export function detectDoi(text: string) {
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match?.[0] ?? null;
}

export function splitIntoChunks(pages: ExtractedPage[]) {
  const chunks: ChunkInput[] = [];
  let currentHeading: string | null = null;
  let currentContent: string[] = [];
  let currentPageStart = 1;
  let currentPageEnd = 1;
  let chunkIndex = 0;

  const flush = () => {
    const content = currentContent.join("\n\n").trim();
    if (!content) {
      return;
    }

    chunks.push({
      heading: currentHeading,
      content,
      pageStart: currentPageStart,
      pageEnd: currentPageEnd,
      chunkIndex,
      tokenEstimate: estimateTokens(content),
    });
    chunkIndex += 1;
    currentContent = [];
  };

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((paragraph) => normalizeLine(paragraph))
      .filter(Boolean);

    if (paragraphs.length === 0) {
      continue;
    }

    for (const paragraph of paragraphs) {
      if (isLikelyHeading(paragraph)) {
        flush();
        currentHeading = paragraph;
        currentPageStart = page.pageNumber;
        currentPageEnd = page.pageNumber;
        continue;
      }

      if (currentContent.length === 0) {
        currentPageStart = page.pageNumber;
      }

      currentPageEnd = page.pageNumber;
      currentContent.push(paragraph);

      const joined = currentContent.join("\n\n");
      if (joined.length > 1800) {
        flush();
        currentPageStart = page.pageNumber;
      }
    }
  }

  flush();

  if (chunks.length === 0) {
    return [
      {
        heading: "Full Text",
        content: pages.map((page) => page.text).join("\n\n").trim(),
        pageStart: 1,
        pageEnd: pages.at(-1)?.pageNumber ?? 1,
        chunkIndex: 0,
        tokenEstimate: estimateTokens(pages.map((page) => page.text).join(" ")),
      },
    ];
  }

  return chunks;
}
