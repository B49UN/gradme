import { z } from "zod";

export const normalizedRectSchema = z.object({
  left: z.number().min(0).max(1),
  top: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const selectionRefSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    page: z.number().int().min(1),
    rects: z.array(normalizedRectSchema).min(1),
    selectedText: z.string().min(1),
  }),
  z.object({
    type: z.literal("area"),
    page: z.number().int().min(1),
    rects: z.array(normalizedRectSchema).min(1),
    imagePath: z.string().nullable(),
    selectedText: z.string().optional(),
  }),
]);

export const annotationSchema = z.object({
  type: z.enum(["highlight", "underline", "area", "note-link"]),
  page: z.number().int().min(1),
  rects: z.array(normalizedRectSchema).min(1),
  color: z.string().min(1),
  selectedText: z.string().nullable().optional(),
  selectionRef: selectionRefSchema.nullable().optional(),
});

export const noteSchema = z.object({
  title: z.string().min(1).max(200),
  contentMd: z.string().min(1),
  annotationId: z.string().uuid().nullable().optional(),
});

export const modelProfileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  baseUrl: z.string().url(),
  apiFormat: z.enum(["responses", "chat-completions", "gemini-native"]).default("responses"),
  model: z.string().min(1),
  apiKey: z.string().trim().optional().default(""),
  supportsVision: z.boolean(),
  streamingEnabled: z.boolean().optional().default(true),
  maxOutputTokens: z.number().int().min(256).max(128_000),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high"]).nullable().optional(),
}).superRefine((value, context) => {
  if (!value.id && value.apiKey.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "새 프로필은 API 키가 필요합니다.",
      path: ["apiKey"],
    });
  }
});

export const questionSchema = z.object({
  profileId: z.string().uuid(),
  question: z.string().min(1),
  threadId: z.string().uuid().nullable().optional(),
  selectionRef: selectionRefSchema.nullable().optional(),
  selectionPreviewDataUrl: z.string().startsWith("data:image/").nullable().optional(),
  focusKind: z
    .enum([
      "methodology",
      "experimental-setup",
      "results",
      "contribution",
      "limitations",
    ])
    .optional(),
  force: z.boolean().optional(),
});

export const profileSelectionSchema = z.object({
  profileId: z.string().uuid(),
  force: z.boolean().optional(),
});

export const translationRequestSchema = profileSelectionSchema.extend({
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if ((value.pageStart ?? null) === null && (value.pageEnd ?? null) === null) {
    return;
  }

  if ((value.pageStart ?? null) === null || (value.pageEnd ?? null) === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "페이지 범위는 시작과 끝을 함께 보내야 합니다.",
      path: ["pageStart"],
    });
    return;
  }

  if (value.pageStart! > value.pageEnd!) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "페이지 시작은 끝보다 작거나 같아야 합니다.",
      path: ["pageStart"],
    });
  }
});

export const threadCreateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
});

export const urlImportSchema = z.object({
  url: z.string().url(),
});

export const identifierImportSchema = z.object({
  identifier: z.string().min(3),
});
