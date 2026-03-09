import { describe, expect, it } from "vitest";
import {
  buildFocusPrompt,
  buildQaPrompt,
  buildSummaryPrompt,
  buildTranslationSectionPrompt,
} from "@/lib/ai/prompts";
import type { PaperChunkRecord } from "@/lib/types";

const chunks: PaperChunkRecord[] = [
  {
    id: "chunk-1",
    paperId: "paper-1",
    heading: "1 Introduction",
    content: "This paper studies aerodynamic estimation performance.",
    pageStart: 1,
    pageEnd: 1,
    chunkIndex: 0,
    tokenEstimate: 12,
  },
];

describe("prompt catalog", () => {
  it("enforces summary markdown sections", () => {
    const prompt = buildSummaryPrompt(chunks);
    expect(prompt.version).toBe("summary_v3");
    expect(prompt.system).toContain("## 한줄 요약");
    expect(prompt.system).toContain("[p.X]");
    expect(prompt.system).toContain("인라인 수식은 $...$");
    expect(prompt.system).toContain("\\( ... \\)");
  });

  it("keeps qa prompts grounded in selection and chunks", () => {
    const prompt = buildQaPrompt("핵심 가정은?", chunks, {
      type: "text",
      page: 1,
      rects: [{ left: 0.1, top: 0.1, width: 0.3, height: 0.05 }],
      selectedText: "aerodynamic estimation performance",
    }, "# 이전 스레드");
    expect(prompt.user).toContain("<selection type=\"text\"");
    expect(prompt.user).toContain("<chunk");
    expect(prompt.user).toContain("<thread-context>");
  });

  it("labels focus prompts by perspective", () => {
    const prompt = buildFocusPrompt("results", chunks, "# 이전 스레드");
    expect(prompt.system).toContain("현재 분석 관점: 주요 결과");
    expect(prompt.user).toContain("<thread-context>");
  });

  it("builds translation prompts per section", () => {
    const prompt = buildTranslationSectionPrompt(chunks[0], {
      index: 1,
      total: 4,
    });
    expect(prompt.version).toBe("translation_v4");
    expect(prompt.user).toContain("<section page-start=\"1\"");
    expect(prompt.system).toContain("문서 전역 제목");
  });
});
