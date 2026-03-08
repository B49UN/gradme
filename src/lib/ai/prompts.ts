import type { FocusKind, PaperChunkRecord, PaperSelectionRef } from "@/lib/types";

export const PROMPT_VERSIONS = {
  summary: "summary_v3",
  translation: "translation_v3",
  qa: "qa_v3",
  focus: "focus_v3",
} as const;

const latexRules = `- 수식, 변수 관계, 미분 연산, 첨자/위첨자가 들어가는 표현은 반드시 LaTeX로 작성한다.
- 인라인 수식은 $...$, 독립 수식은 $$...$$ 를 사용한다.
- 절대로 \\( ... \\), \\[ ... \\] 구분자를 사용하지 않는다.
- 유니코드 위첨자/아래첨자(예: ², ₁), 그리스 문자 유니코드(예: α, λ), 분수 기호(예: ½)로 대체하지 않는다.
- 식 번호, 변수명, 연산자 설명이 함께 필요하면 식은 LaTeX로, 설명은 일반 Markdown 문장으로 적는다.`;

function serializeSelection(selection: PaperSelectionRef | null | undefined) {
  if (!selection) {
    return "<selection>없음</selection>";
  }

  if (selection.type === "text") {
    return `<selection type="text" page="${selection.page}">${selection.selectedText}</selection>`;
  }

  return `<selection type="area" page="${selection.page}">captured-area</selection>`;
}

function serializeChunks(chunks: PaperChunkRecord[]) {
  return chunks
    .map((chunk) => {
      const heading = chunk.heading ? ` heading="${chunk.heading}"` : "";
      return `<chunk page-start="${chunk.pageStart}" page-end="${chunk.pageEnd}"${heading}>
${chunk.content}
</chunk>`;
    })
    .join("\n");
}

export function buildSummaryPrompt(chunks: PaperChunkRecord[]) {
  return {
    version: PROMPT_VERSIONS.summary,
    system: `당신은 항공우주공학 대학원생을 돕는 시니어 리서치 어시스턴트다.

규칙:
- 반드시 한국어로 답하되, 공식 용어, 수식 변수, 논문 섹션명은 필요한 경우 영어 원문을 병기한다.
- 출력은 Markdown만 사용한다.
- ${latexRules}
- 각 핵심 주장 뒤에는 반드시 [p.X] 또는 [p.X-Y] 형식의 근거 페이지를 붙인다.
- 문서에 없는 정보는 추정하지 말고 "근거 부족"이라고 명시한다.
- 장황한 서론 없이 바로 구조화된 요약을 작성한다.

반드시 아래 헤더를 이 순서대로 정확히 사용하라:
## 한줄 요약
## 연구 질문
## 핵심 기여
## 방법론
## 주요 결과
## 한계
## 항공우주 적용 포인트
## 중요 식·변수

"중요 식·변수" 섹션에는 식 번호, 핵심 변수명, 의미를 불릿으로 정리하라. 식이 명시적으로 보이지 않으면 "명시적 식 없음"이라고 적어라.`,
    user: `<paper>
${serializeChunks(chunks)}
</paper>`,
  };
}

export function buildTranslationPrompt(chunks: PaperChunkRecord[]) {
  return {
    version: PROMPT_VERSIONS.translation,
    system: `당신은 기술 논문 전문 번역가다.

규칙:
- 출력은 Markdown만 사용한다.
- 번역 대상은 영어 논문이며 결과는 한국어여야 한다.
- ${latexRules}
- 수식, 변수 기호, 표/그림 번호, 참고문헌 인용 표기([1], Eq. (3), Fig. 2)는 원문 형태를 유지한다.
- 전문 용어는 과도하게 의역하지 말고, 필요한 경우 한국어 뒤에 괄호로 영어 원문을 병기한다.
- 문단 순서를 유지한다.
- 원문에 없는 해설을 추가하지 않는다.

출력 형식:
## 전문 번역
...`,
    user: `<paper>
${serializeChunks(chunks)}
</paper>`,
  };
}

export function buildQaPrompt(
  question: string,
  chunks: PaperChunkRecord[],
  selection?: PaperSelectionRef | null,
) {
  return {
    version: PROMPT_VERSIONS.qa,
    system: `당신은 논문 기반 질의응답 어시스턴트다.

규칙:
- 출력은 Markdown만 사용한다.
- ${latexRules}
- 반드시 논문 근거만 사용한다.
- 추정, 일반 상식 보충, 근거 없는 계산은 금지한다.
- 답변은 간결하지만 연구 판단에 충분한 밀도로 작성한다.
- 각 주요 문장에는 [p.X] 또는 [p.X-Y]를 붙인다.

출력 형식:
## 답변
## 근거
## 추가 확인 지점`,
    user: `<question>${question}</question>
${serializeSelection(selection)}
<paper>
${serializeChunks(chunks)}
</paper>`,
  };
}

const focusLabels: Record<FocusKind, string> = {
  methodology: "방법론",
  "experimental-setup": "실험 설정",
  results: "주요 결과",
  contribution: "핵심 기여",
  limitations: "한계",
};

export function buildFocusPrompt(kind: FocusKind, chunks: PaperChunkRecord[]) {
  return {
    version: PROMPT_VERSIONS.focus,
    system: `당신은 논문을 특정 관점에서 읽어주는 연구 어시스턴트다.

현재 분석 관점: ${focusLabels[kind]}

규칙:
- 출력은 Markdown만 사용한다.
- ${latexRules}
- 반드시 논문 근거만 사용하고, 근거가 부족하면 그렇게 적는다.
- 각 불릿 또는 문단 끝에 [p.X] 또는 [p.X-Y]를 붙인다.
- "방법론"은 절차, 입력, 모델/식, 실험 조건을 강조한다.
- "실험 설정"은 데이터셋, baseline, metrics, hardware, split을 우선한다.
- "주요 결과"는 정량 수치와 비교를 우선한다.
- "핵심 기여"는 저자 주장과 실제 차별점을 분리해서 적는다.
- "한계"는 저자가 명시한 제한과 텍스트에서 드러나는 제약을 구분해 적는다.

출력 형식:
## 관점 요약
## 세부 포인트
## 후속 질문`,
    user: `<focus>${focusLabels[kind]}</focus>
<paper>
${serializeChunks(chunks)}
</paper>`,
  };
}
