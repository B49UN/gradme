import { describe, expect, it } from "vitest";
import {
  buildTranslationDocument,
  findTranslationSectionForPage,
  parseTranslationDocument,
  sanitizeTranslationSectionContent,
} from "@/lib/ai/translation";

describe("translation document helpers", () => {
  it("removes wrapper headings from section content", () => {
    expect(
      sanitizeTranslationSectionContent("## 전문 번역\n\n```markdown\nTranslated text\n```"),
    ).toBe("Translated text");
  });

  it("builds and parses page-linked translation documents", () => {
    const document = buildTranslationDocument([
      {
        chunkIndex: 0,
        pageStart: 1,
        pageEnd: 1,
        heading: "1 Introduction",
        contentMd: "첫 번째 번역",
      },
      {
        chunkIndex: 1,
        pageStart: 2,
        pageEnd: 3,
        heading: "2 Method",
        contentMd: "두 번째 번역",
      },
    ]);

    const sections = parseTranslationDocument(document);
    expect(sections).toHaveLength(2);
    expect(sections[1]?.pageEnd).toBe(3);
    expect(findTranslationSectionForPage(sections, 2)?.heading).toBe("2 Method");
  });
});
