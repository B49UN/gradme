"use client";

import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownRenderer } from "@/components/gradme/markdown-renderer";

export function NoteEditor({
  title,
  content,
  onTitleChange,
  onContentChange,
  onSave,
  onCancel,
  saving,
}: {
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
      <div className="space-y-3 rounded-[24px] border border-[var(--line)] bg-white/60 p-4">
        <Input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="메모 제목"
        />
        <div className="overflow-hidden rounded-[22px] border border-[var(--line)]">
          <CodeMirror
            value={content}
            height="280px"
            theme="light"
            extensions={[markdown()]}
            onChange={onContentChange}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button variant="secondary" onClick={onSave} disabled={saving}>
            {saving ? "저장 중..." : "메모 저장"}
          </Button>
        </div>
      </div>
      <div className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="heading-display text-lg font-semibold">Preview</p>
            <p className="text-sm text-[var(--muted)]">Markdown + KaTeX 렌더링</p>
          </div>
        </div>
        <MarkdownRenderer content={content || "_내용이 없습니다._"} />
      </div>
    </div>
  );
}
