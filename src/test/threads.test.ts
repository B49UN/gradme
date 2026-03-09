import { describe, expect, it } from "vitest";
import {
  buildAskArtifactContent,
  buildThreadMarkdown,
  deriveThreadTitle,
} from "@/lib/ai/threads";

describe("thread markdown helpers", () => {
  it("derives a concise thread title from a question", () => {
    expect(deriveThreadTitle("이 논문의 핵심 기여를 세 문장으로 설명해줘")).toContain(
      "이 논문의 핵심 기여",
    );
  });

  it("stores user and assistant turns in markdown", () => {
    const markdown = buildThreadMarkdown("기여 분석", [
      {
        role: "user",
        contentMd: "핵심 기여가 뭐야?",
        createdAt: "2026-03-09T00:00:00.000Z",
      },
      {
        role: "assistant",
        contentMd: "## 답변\n기여는 두 가지다.",
        createdAt: "2026-03-09T00:00:01.000Z",
      },
    ]);

    expect(markdown).toContain("**사용자**");
    expect(markdown).toContain("**AI**");
    expect(markdown).toContain("## 답변");
  });

  it("prefixes saved ask artifacts with the original question", () => {
    const content = buildAskArtifactContent({
      question: "핵심 기여가 뭐야?",
      answerMd: "## 답변\n기여는 두 가지다.",
    });

    expect(content).toContain("## 질문");
    expect(content).toContain("핵심 기여가 뭐야?");
    expect(content).toContain("## 답변");
  });
});
