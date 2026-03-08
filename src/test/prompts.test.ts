import { describe, expect, it } from "vitest";
import { buildFocusPrompt, buildQaPrompt, buildSummaryPrompt } from "@/lib/ai/prompts";
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
    });
    expect(prompt.user).toContain("<selection type=\"text\"");
    expect(prompt.user).toContain("<chunk");
  });

  it("labels focus prompts by perspective", () => {
    const prompt = buildFocusPrompt("results", chunks);
    expect(prompt.system).toContain("현재 분석 관점: 주요 결과");
  });
});
