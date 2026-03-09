import type { PaperSelectionRef } from "@/lib/types";

export type ThreadMarkdownMessage = {
  role: "user" | "assistant";
  contentMd: string;
  createdAt: string;
  selectionRef?: PaperSelectionRef | null;
};

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripMarkdownHeading(value: string) {
  return normalizeInlineText(value.replace(/^#+\s+/gm, ""));
}

export function describeThreadSelection(selection: PaperSelectionRef | null | undefined) {
  if (!selection) {
    return null;
  }

  if (selection.type === "text") {
    const snippet = normalizeInlineText(selection.selectedText).slice(0, 180);
    return `선택 범위: p.${selection.page} · ${snippet}`;
  }

  return `선택 범위: p.${selection.page} · 영역 캡처`;
}

export function deriveThreadTitle(question: string) {
  const normalized = stripMarkdownHeading(question).slice(0, 56);
  return normalized || "새 스레드";
}

export function buildThreadMarkdown(title: string, messages: ThreadMarkdownMessage[]) {
  if (messages.length === 0) {
    return `# ${title}\n\n새 질문을 시작하면 이 스레드의 문맥이 Markdown 페이지로 누적됩니다.`;
  }

  const blocks = [`# ${title}`, ""];

  for (const message of messages) {
    blocks.push(message.role === "user" ? "**사용자**" : "**AI**");
    const selectionSummary = describeThreadSelection(message.selectionRef);

    if (selectionSummary) {
      blocks.push(`> ${selectionSummary}`);
    }

    blocks.push(message.contentMd.trim());
    blocks.push("");
    blocks.push("---");
    blocks.push("");
  }

  while (blocks.at(-1) === "") {
    blocks.pop();
  }

  if (blocks.at(-1) === "---") {
    blocks.pop();
  }

  return blocks.join("\n").trim();
}

export function buildAskArtifactContent(args: {
  question: string;
  answerMd: string;
  selection?: PaperSelectionRef | null;
}) {
  const lines = ["## 질문", args.question.trim()];
  const selectionSummary = describeThreadSelection(args.selection);

  if (selectionSummary) {
    lines.push("", `> ${selectionSummary}`);
  }

  lines.push("", args.answerMd.trim());
  return lines.join("\n").trim();
}
