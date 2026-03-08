"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";
import { cn } from "@/lib/utils";

export function MarkdownRenderer({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  const normalizedContent = normalizeMathDelimiters(content);

  return (
    <div className={cn("prose-paper prose prose-sm max-w-none", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
