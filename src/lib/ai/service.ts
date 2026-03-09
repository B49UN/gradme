import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  GoogleGenAI,
  ThinkingLevel,
  createPartFromBase64,
  createPartFromText,
  createPartFromUri,
  createUserContent,
} from "@google/genai";
import OpenAI from "openai";
import PQueue from "p-queue";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import "server-only";
import { db, nowIso, rawDb, parseJsonColumn, stringifyJsonColumn } from "@/lib/db/client";
import {
  aiArtifacts,
  aiProfiles,
  aiThreadMessages,
  aiThreads,
  paperChunks,
  papers,
} from "@/lib/db/schema";
import {
  PROMPT_VERSIONS,
  buildFocusPrompt,
  buildQaPrompt,
  buildSummaryPrompt,
  buildTranslationSectionPrompt,
} from "@/lib/ai/prompts";
import {
  inferApiFormatFromBaseUrl,
  inferProviderFromBaseUrl,
  getProviderDefaults,
  normalizeAiBaseUrl,
  normalizeReasoningEffort,
} from "@/lib/ai/profile-utils";
import { readApiKey, storeApiKey, isKeytarAvailable } from "@/lib/ai/keytar";
import { appPaths } from "@/lib/server/app-paths";
import {
  buildAskArtifactContent,
  buildThreadMarkdown,
  deriveThreadTitle,
} from "@/lib/ai/threads";
import {
  buildTranslationDocumentWithOptions,
  createTranslationSection,
  formatTranslationPageRange,
  getTranslationSectionsRange,
  parseTranslationDocument,
} from "@/lib/ai/translation";
import type {
  AiApiFormat,
  AiArtifactKind,
  AiArtifactRecord,
  AiProfileRecord,
  AskThreadMessageRecord,
  AskThreadRecord,
  FocusKind,
  PaperMarkdownFileRecord,
  PaperChunkRecord,
  PaperSelectionRef,
  ReasoningEffort,
} from "@/lib/types";
import { stableStringify } from "@/lib/utils";

const interactiveQueue = new PQueue({ concurrency: 3 });
const translationQueue = new PQueue({ concurrency: 1 });

type AskRunResult = {
  artifact: AiArtifactRecord;
  thread: AskThreadRecord;
};

type ModelStreamCallbacks = {
  onDelta?: (delta: string) => Promise<void> | void;
};

type SummaryStreamCallbacks = {
  onDelta?: (delta: string, snapshot: string) => Promise<void> | void;
  onComplete?: (artifact: AiArtifactRecord) => Promise<void> | void;
  onError?: (message: string, artifact: AiArtifactRecord) => Promise<void> | void;
};

type AskStreamCallbacks = {
  onStart?: (payload: { artifact: AiArtifactRecord; thread: AskThreadRecord }) => Promise<void> | void;
  onDelta?: (delta: string, snapshot: string) => Promise<void> | void;
  onComplete?: (result: AskRunResult) => Promise<void> | void;
  onError?: (payload: { message: string; result: AskRunResult }) => Promise<void> | void;
};

function mapProfile(row: typeof aiProfiles.$inferSelect): AiProfileRecord {
  const provider = inferProviderFromBaseUrl(row.baseUrl);
  return {
    id: row.id,
    name: row.name,
    provider,
    baseUrl: normalizeAiBaseUrl(row.baseUrl),
    apiFormat:
      provider === "google-gemini"
        ? "gemini-native"
        : (row.apiFormat as AiApiFormat | null) ?? inferApiFormatFromBaseUrl(row.baseUrl),
    model: row.model,
    supportsVision: row.supportsVision,
    streamingEnabled: row.streamingEnabled ?? true,
    maxOutputTokens: row.maxTokens,
    reasoningEffort: normalizeReasoningEffort(row.reasoningEffort as ReasoningEffort | null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapArtifact(row: typeof aiArtifacts.$inferSelect): AiArtifactRecord {
  return {
    id: row.id,
    paperId: row.paperId,
    kind: row.kind as AiArtifactKind,
    promptVersion: row.promptVersion,
    profileId: row.profileId,
    model: row.model,
    selectionHash: row.selectionHash,
    selectionRef: parseJsonColumn(row.selectionRefJson, null),
    contentMd: row.contentMd,
    status: row.status as AiArtifactRecord["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAskThread(row: typeof aiThreads.$inferSelect): AskThreadRecord {
  return {
    id: row.id,
    paperId: row.paperId,
    title: row.title,
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: [],
  };
}

function mapAskThreadMessage(
  row: typeof aiThreadMessages.$inferSelect,
): AskThreadMessageRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as AskThreadMessageRecord["role"],
    contentMd: row.contentMd,
    selectionRef: parseJsonColumn(row.selectionRefJson, null),
    artifactId: row.artifactId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapChunk(row: typeof paperChunks.$inferSelect): PaperChunkRecord {
  return {
    id: row.id,
    paperId: row.paperId,
    heading: row.heading,
    content: row.content,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    chunkIndex: row.chunkIndex,
    tokenEstimate: row.tokenEstimate,
  };
}

async function getClient(profileId: string) {
  const row = await db.query.aiProfiles.findFirst({
    where: eq(aiProfiles.id, profileId),
  });

  if (!row) {
    throw new Error("선택한 모델 프로필을 찾을 수 없습니다.");
  }

  const apiKey = await readApiKey(profileId);

  if (!apiKey) {
    throw new Error("저장된 API 키가 없습니다. 모델 설정을 다시 저장하세요.");
  }

  return {
    client: new OpenAI({
      apiKey,
      baseURL: normalizeAiBaseUrl(row.baseUrl),
    }),
    profile: mapProfile(row),
  };
}

async function getProfileAccess(profileId: string) {
  const row = await db.query.aiProfiles.findFirst({
    where: eq(aiProfiles.id, profileId),
  });

  if (!row) {
    throw new Error("선택한 모델 프로필을 찾을 수 없습니다.");
  }

  const apiKey = await readApiKey(profileId);

  if (!apiKey) {
    throw new Error("저장된 API 키가 없습니다. 모델 설정을 다시 저장하세요.");
  }

  return {
    row,
    apiKey,
    profile: mapProfile(row),
  };
}

async function createArtifact(args: {
  paperId: string;
  kind: AiArtifactKind;
  promptVersion: string;
  profileId: string;
  model: string;
  selectionRef?: PaperSelectionRef | null;
  cacheKey?: unknown;
}) {
  const hashSource = args.selectionRef ?? args.cacheKey ?? null;
  const selectionHash = hashSource
    ? crypto.createHash("sha256").update(stableStringify(hashSource)).digest("hex")
    : null;
  const now = nowIso();
  const id = crypto.randomUUID();

  await db.insert(aiArtifacts).values({
    id,
    paperId: args.paperId,
    kind: args.kind,
    promptVersion: args.promptVersion,
    profileId: args.profileId,
    model: args.model,
    selectionHash,
    selectionRefJson: args.selectionRef ? stringifyJsonColumn(args.selectionRef) : null,
    contentMd: "",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });

  return mapArtifact(
    (
      await db.query.aiArtifacts.findFirst({
        where: eq(aiArtifacts.id, id),
      })
    )!,
  );
}

async function createOrReuseArtifact(args: {
  paperId: string;
  kind: AiArtifactKind;
  promptVersion: string;
  profileId: string;
  model: string;
  selectionRef?: PaperSelectionRef | null;
  cacheKey?: unknown;
  force?: boolean;
}) {
  const hashSource = args.selectionRef ?? args.cacheKey ?? null;
  const selectionHash = hashSource
    ? crypto.createHash("sha256").update(stableStringify(hashSource)).digest("hex")
    : null;

  const existing = await db.query.aiArtifacts.findFirst({
    where: and(
      eq(aiArtifacts.paperId, args.paperId),
      eq(aiArtifacts.kind, args.kind),
      eq(aiArtifacts.promptVersion, args.promptVersion),
      eq(aiArtifacts.profileId, args.profileId),
      eq(aiArtifacts.model, args.model),
      selectionHash === null
        ? sql`${aiArtifacts.selectionHash} IS NULL`
        : eq(aiArtifacts.selectionHash, selectionHash),
    ),
    orderBy: desc(aiArtifacts.createdAt),
  });

  if (existing && !args.force) {
    return mapArtifact(existing);
  }

  return createArtifact(args);
}

async function updateArtifact(
  artifactId: string,
  contentMd: string,
  status: AiArtifactRecord["status"],
) {
  await db
    .update(aiArtifacts)
    .set({
      contentMd,
      status,
      updatedAt: nowIso(),
    })
    .where(eq(aiArtifacts.id, artifactId));

  const row = await db.query.aiArtifacts.findFirst({
    where: eq(aiArtifacts.id, artifactId),
  });

  if (!row) {
    throw new Error("AI 결과 저장에 실패했습니다.");
  }

  const artifact = mapArtifact(row);

  if (isTranslationArtifactKind(artifact.kind)) {
    await syncArtifactMarkdownFile(artifact);
  }

  return artifact;
}

function buildFtsQuery(question: string) {
  const terms = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 8);

  if (terms.length === 0) {
    return null;
  }

  return terms.map((term) => `${term}*`).join(" OR ");
}

export async function searchRelevantChunks(paperId: string, query: string, limit = 6) {
  const ftsQuery = buildFtsQuery(query);

  if (!ftsQuery) {
    const rows = await db.query.paperChunks.findMany({
      where: eq(paperChunks.paperId, paperId),
      limit,
      orderBy: (fields, { asc }) => [asc(fields.chunkIndex)],
    });

    return rows.map(mapChunk);
  }

  const rows = rawDb
    .prepare(
      `SELECT c.*
       FROM paper_chunks_fts f
       JOIN paper_chunks c ON c.id = f.chunk_id
       WHERE f.paper_id = ? AND paper_chunks_fts MATCH ?
       ORDER BY bm25(paper_chunks_fts)
       LIMIT ?`,
    )
    .all(paperId, ftsQuery, limit) as Array<typeof paperChunks.$inferSelect>;

  if (rows.length > 0) {
    return rows.map(mapChunk);
  }

  const fallback = await db.query.paperChunks.findMany({
    where: eq(paperChunks.paperId, paperId),
    limit,
    orderBy: (fields, { asc }) => [asc(fields.chunkIndex)],
  });

  return fallback.map(mapChunk);
}

async function readSelectionImage(selection: PaperSelectionRef | null | undefined) {
  if (!selection || selection.type !== "area" || !selection.imagePath) {
    return null;
  }

  const buffer = await fs.readFile(selection.imagePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function dataUrlToInlineData(dataUrl: string) {
  const [metadata, data] = dataUrl.split(",", 2);
  const mimeType = metadata.match(/^data:(.*?);base64$/)?.[1] ?? "image/png";

  if (!data) {
    return null;
  }

  return createPartFromBase64(data, mimeType);
}

async function getPaperStoragePath(paperId: string) {
  const row = await db.query.papers.findFirst({
    where: eq(papers.id, paperId),
    columns: {
      storagePath: true,
    },
  });

  if (!row) {
    throw new Error("논문 파일을 찾을 수 없습니다.");
  }

  return row.storagePath;
}

function toGeminiThinkingConfig(reasoningEffort: ReasoningEffort | null | undefined) {
  if (!reasoningEffort) {
    return undefined;
  }

  if (reasoningEffort === "none") {
    return {
      thinkingBudget: 0,
    };
  }

  const thinkingLevelMap = {
    minimal: ThinkingLevel.MINIMAL,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
  } as const;

  return {
    thinkingLevel: thinkingLevelMap[reasoningEffort],
  };
}

function extractResponseOutputText(response: OpenAI.Responses.Response) {
  if (response.output_text?.trim()) {
    return response.output_text.trim();
  }

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    const text = item.content
      .filter((contentItem) => contentItem.type === "output_text")
      .map((contentItem) => contentItem.text)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

function extractChatCompletionDelta(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
) {
  const content = chunk.choices[0]?.delta?.content as unknown;

  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part: unknown) => {
      if (typeof part === "string") {
        return part;
      }

      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }

      return "";
    })
    .join("");
}

async function runModelRequest(args: {
  paperId: string;
  profileId: string;
  system: string;
  user: string;
  selection?: PaperSelectionRef | null;
  attachPaperPdf?: boolean;
  stream?: ModelStreamCallbacks;
}) {
  const access = await getProfileAccess(args.profileId);
  const { profile } = access;
  const imageDataUrl = await readSelectionImage(args.selection);

  if (args.selection?.type === "area" && !profile.supportsVision) {
    throw new Error("선택한 모델 프로필은 비전 입력을 지원하지 않습니다. Vision 지원 프로필을 선택하세요.");
  }

  let content = "";

  if (profile.provider === "google-gemini") {
    const ai = new GoogleGenAI({
      apiKey: access.apiKey,
    });
    const uploaded =
      args.attachPaperPdf === false
        ? null
        : await (async () => {
            const paperPath = await getPaperStoragePath(args.paperId);
            return ai.files.upload({
              file: paperPath,
              config: {
                mimeType: "application/pdf",
              },
            });
          })();

    try {
      const parts = [createPartFromText(args.user)];

      if (uploaded?.uri) {
        parts.push(createPartFromUri(uploaded.uri, uploaded.mimeType ?? "application/pdf"));
      }

      const imagePart = imageDataUrl ? dataUrlToInlineData(imageDataUrl) : null;
      if (imagePart) {
        parts.push(imagePart);
      }

      if (args.stream?.onDelta) {
        const response = await ai.models.generateContentStream({
          model: profile.model,
          contents: createUserContent(parts),
          config: {
            systemInstruction: args.system,
            maxOutputTokens: profile.maxOutputTokens,
            thinkingConfig: toGeminiThinkingConfig(profile.reasoningEffort),
          },
        });

        for await (const chunk of response) {
          const delta = chunk.text ?? "";

          if (!delta) {
            continue;
          }

          content += delta;
          await args.stream.onDelta(delta);
        }
      } else {
        const response = await ai.models.generateContent({
          model: profile.model,
          contents: createUserContent(parts),
          config: {
            systemInstruction: args.system,
            maxOutputTokens: profile.maxOutputTokens,
            thinkingConfig: toGeminiThinkingConfig(profile.reasoningEffort),
          },
        });

        content = response.text?.trim() ?? "";
      }
    } finally {
      if (uploaded?.name) {
        await ai.files.delete({ name: uploaded.name }).catch(() => undefined);
      }
    }
  } else if (profile.apiFormat === "chat-completions") {
    const { client } = await getClient(args.profileId);
    if (args.stream?.onDelta) {
      const stream = await client.chat.completions.create({
        model: profile.model,
        max_tokens: profile.maxOutputTokens,
        reasoning_effort: profile.reasoningEffort ?? undefined,
        stream: true,
        messages: [
          {
            role: "system",
            content: args.system,
          },
          imageDataUrl
            ? {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: args.user,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: imageDataUrl,
                    },
                  },
                ],
              }
            : {
                role: "user",
                content: args.user,
              },
        ],
      });

      for await (const chunk of stream) {
        const delta = extractChatCompletionDelta(chunk);

        if (!delta) {
          continue;
        }

        content += delta;
        await args.stream.onDelta(delta);
      }
    } else {
      const response = await client.chat.completions.create({
        model: profile.model,
        max_tokens: profile.maxOutputTokens,
        reasoning_effort: profile.reasoningEffort ?? undefined,
        messages: [
          {
            role: "system",
            content: args.system,
          },
          imageDataUrl
            ? {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: args.user,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: imageDataUrl,
                    },
                  },
                ],
              }
            : {
                role: "user",
                content: args.user,
              },
        ],
      });

      content = response.choices[0]?.message?.content?.trim() ?? "";
    }
  } else {
    const { client } = await getClient(args.profileId);
    const input: string | OpenAI.Responses.ResponseInput = imageDataUrl
      ? [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: args.user,
              },
              {
                type: "input_image",
                image_url: imageDataUrl,
                detail: "auto",
              },
            ] satisfies OpenAI.Responses.ResponseInputMessageContentList,
          },
        ]
      : args.user;

    if (args.stream?.onDelta) {
      const stream = await client.responses.create({
        model: profile.model,
        instructions: args.system,
        input,
        stream: true,
        max_output_tokens: profile.maxOutputTokens,
        reasoning: profile.reasoningEffort
          ? {
              effort: profile.reasoningEffort,
            }
          : undefined,
      });

      for await (const event of stream) {
        if (event.type !== "response.output_text.delta" || !event.delta) {
          continue;
        }

        content += event.delta;
        await args.stream.onDelta(event.delta);
      }
    } else {
      const response = await client.responses.create({
        model: profile.model,
        instructions: args.system,
        input,
        max_output_tokens: profile.maxOutputTokens,
        reasoning: profile.reasoningEffort
          ? {
              effort: profile.reasoningEffort,
            }
          : undefined,
      });

      content = extractResponseOutputText(response);
    }
  }

  return {
    profile,
    content:
      content ||
      "## 답변\n모델 응답이 비어 있습니다.\n\n## 근거\n근거 부족\n\n## 추가 확인 지점\n응답 형식을 다시 시도하세요.",
  };
}

export async function listProfiles() {
  const rows = await db.query.aiProfiles.findMany({
    orderBy: (fields, { asc }) => [asc(fields.name)],
  });
  return Promise.all(
    rows.map(async (row) => ({
      ...mapProfile(row),
      hasApiKey: Boolean(await readApiKey(row.id)),
    })),
  );
}

export async function saveProfile(input: {
  id?: string;
  name: string;
  baseUrl: string;
  apiFormat: AiApiFormat;
  model: string;
  supportsVision: boolean;
  streamingEnabled?: boolean;
  maxOutputTokens: number;
  reasoningEffort?: ReasoningEffort | null;
  apiKey: string;
}) {
  const now = nowIso();
  const id = input.id ?? crypto.randomUUID();
  const inferredProvider = inferProviderFromBaseUrl(input.baseUrl);
  const providerDefaults = getProviderDefaults(inferredProvider);
  const baseUrl =
    inferredProvider === "google-gemini"
      ? providerDefaults.baseUrl
      : normalizeAiBaseUrl(input.baseUrl);
  const existing = await db.query.aiProfiles.findFirst({
    where: eq(aiProfiles.id, id),
  });

  if (existing) {
    await db
      .update(aiProfiles)
      .set({
        name: input.name,
        baseUrl,
        apiFormat:
          providerDefaults.provider === "google-gemini" ? "gemini-native" : input.apiFormat,
        model: input.model,
        supportsVision: input.supportsVision,
        streamingEnabled: input.streamingEnabled ?? true,
        maxTokens: input.maxOutputTokens,
        reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
        updatedAt: now,
      })
      .where(eq(aiProfiles.id, id));
  } else {
    await db.insert(aiProfiles).values({
      id,
      name: input.name,
      baseUrl,
      apiFormat:
        providerDefaults.provider === "google-gemini" ? "gemini-native" : input.apiFormat,
      model: input.model,
      supportsVision: input.supportsVision,
      streamingEnabled: input.streamingEnabled ?? true,
      temperature: 0.2,
      maxTokens: input.maxOutputTokens,
      reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
      createdAt: now,
      updatedAt: now,
    });
  }

  const trimmedApiKey = input.apiKey.trim();
  let secretStored = false;

  if (trimmedApiKey) {
    secretStored = await storeApiKey(id, trimmedApiKey);
  } else if (!existing) {
    throw new Error("새 프로필은 API 키가 필요합니다.");
  } else {
    secretStored = Boolean(await readApiKey(id));
  }

  const row = await db.query.aiProfiles.findFirst({
    where: eq(aiProfiles.id, id),
  });

  if (!row) {
    throw new Error("모델 프로필 저장에 실패했습니다.");
  }

  return {
    profile: mapProfile(row),
    secretStored,
    keytarAvailable: await isKeytarAvailable(),
  };
}

async function ensureAreaSelectionPath(selection: PaperSelectionRef | null | undefined) {
  if (!selection || selection.type !== "area") {
    return selection ?? null;
  }

  if (selection.imagePath) {
    return selection;
  }

  return {
    ...selection,
    imagePath: null,
  };
}

function focusLabel(kind: FocusKind) {
  return {
    methodology: "방법론",
    "experimental-setup": "실험 설정",
    results: "주요 결과",
    contribution: "핵심 기여",
    limitations: "한계",
  }[kind];
}

function safeFsName(value: string, fallback: string) {
  const normalized = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 72).replace(/\s+/g, "-");
}

function isTranslationArtifactKind(
  kind: AiArtifactKind,
): kind is Extract<AiArtifactKind, "translation" | "translation-range"> {
  return kind === "translation" || kind === "translation-range";
}

function getTranslationArtifactRange(artifact: AiArtifactRecord) {
  return getTranslationSectionsRange(parseTranslationDocument(artifact.contentMd));
}

function getThreadMarkdownFileName(thread: AskThreadRecord) {
  return `${safeFsName(thread.title, "thread")}-${thread.id}.md`;
}

function getArtifactMarkdownFileName(artifact: AiArtifactRecord) {
  if (!isTranslationArtifactKind(artifact.kind)) {
    return null;
  }

  const range = getTranslationArtifactRange(artifact);
  const baseName =
    artifact.kind === "translation"
      ? "translation-full"
      : range
        ? `translation-${formatTranslationPageRange(range.pageStart, range.pageEnd)}`
        : "translation-range";

  return `${safeFsName(baseName, "translation")}-${artifact.id}.md`;
}

function getArtifactMarkdownTitle(artifact: AiArtifactRecord) {
  if (artifact.kind === "translation") {
    return "전문 번역";
  }

  const range = getTranslationArtifactRange(artifact);

  return range
    ? `범위 번역 ${formatTranslationPageRange(range.pageStart, range.pageEnd)}`
    : "범위 번역";
}

async function getPaperMarkdownDirectory(
  paperId: string,
  paperTitle?: string,
) {
  const title =
    paperTitle ??
    (
      await db.query.papers.findFirst({
        where: eq(papers.id, paperId),
        columns: {
          title: true,
        },
      })
    )?.title;

  if (!title) {
    throw new Error("논문을 찾지 못했습니다.");
  }

  const directory = path.join(
    appPaths.markdownDir,
    `${safeFsName(title, "paper")}-${paperId}`,
  );
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function removeLegacyMarkdownFiles(
  directory: string,
  fileName: string,
  suffix: string,
) {
  const existingFiles = await fs.readdir(directory).catch(() => []);
  await Promise.all(
    existingFiles
      .filter((entry) => entry.endsWith(suffix) && entry !== fileName)
      .map((entry) => fs.unlink(path.join(directory, entry)).catch(() => undefined)),
  );
}

async function ensureMarkdownFile(args: {
  filePath: string;
  contentMd: string;
  updatedAt: string;
}) {
  const stat = await fs.stat(args.filePath).catch(() => null);
  const nextUpdatedAt = Date.parse(args.updatedAt);

  if (stat && Number.isFinite(nextUpdatedAt) && stat.mtimeMs >= nextUpdatedAt) {
    return;
  }

  await fs.writeFile(args.filePath, args.contentMd, "utf8");
}

async function syncThreadMarkdownFile(
  thread: AskThreadRecord,
  paperTitle?: string,
): Promise<PaperMarkdownFileRecord> {
  const directory = await getPaperMarkdownDirectory(thread.paperId, paperTitle);
  const fileName = getThreadMarkdownFileName(thread);
  const filePath = path.join(directory, fileName);

  await removeLegacyMarkdownFiles(directory, fileName, `-${thread.id}.md`);
  await ensureMarkdownFile({
    filePath,
    contentMd: thread.contentMd,
    updatedAt: thread.updatedAt,
  });

  return {
    id: `thread:${thread.id}`,
    kind: "thread",
    title: thread.title,
    fileName,
    path: filePath,
    targetId: thread.id,
    updatedAt: thread.updatedAt,
  };
}

async function syncArtifactMarkdownFile(
  artifact: AiArtifactRecord,
  paperTitle?: string,
): Promise<PaperMarkdownFileRecord | null> {
  const fileName = getArtifactMarkdownFileName(artifact);

  if (!fileName) {
    return null;
  }

  const directory = await getPaperMarkdownDirectory(artifact.paperId, paperTitle);
  const filePath = path.join(directory, fileName);

  await removeLegacyMarkdownFiles(directory, fileName, `-${artifact.id}.md`);
  await ensureMarkdownFile({
    filePath,
    contentMd: artifact.contentMd,
    updatedAt: artifact.updatedAt,
  });

  return {
    id: `artifact:${artifact.id}`,
    kind: artifact.kind === "translation" ? "translation" : "translation-range",
    title: getArtifactMarkdownTitle(artifact),
    fileName,
    path: filePath,
    targetId: artifact.id,
    updatedAt: artifact.updatedAt,
  };
}

async function syncPaperMarkdownFiles(paperId: string) {
  const paper = await db.query.papers.findFirst({
    where: eq(papers.id, paperId),
    columns: {
      title: true,
    },
  });

  if (!paper) {
    throw new Error("논문을 찾지 못했습니다.");
  }

  const rows = await db.query.aiThreads.findMany({
    where: eq(aiThreads.paperId, paperId),
    orderBy: (fields, { asc }) => [asc(fields.createdAt)],
  });
  const artifactRows = await db.query.aiArtifacts.findMany({
    where: and(
      eq(aiArtifacts.paperId, paperId),
      inArray(aiArtifacts.kind, ["translation", "translation-range"]),
    ),
    orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.updatedAt)],
  });

  const threads = await Promise.all(
    rows.map(async (row) => ({
      ...mapAskThread(row),
      messages: await listThreadMessages(row.id),
    })),
  );
  const artifacts = artifactRows.map(mapArtifact);

  await Promise.all([
    ...threads.map((thread) => syncThreadMarkdownFile(thread, paper.title)),
    ...artifacts.map((artifact) => syncArtifactMarkdownFile(artifact, paper.title)),
  ]);
  return getPaperMarkdownDirectory(paperId, paper.title);
}

function openDirectoryInFileManager(directory: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";

  const child = spawn(command, [directory], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function listPaperMarkdownFiles(paperId: string) {
  const paper = await db.query.papers.findFirst({
    where: eq(papers.id, paperId),
    columns: {
      title: true,
    },
  });

  if (!paper) {
    throw new Error("논문을 찾지 못했습니다.");
  }

  const [threadRows, artifactRows] = await Promise.all([
    db.query.aiThreads.findMany({
      where: eq(aiThreads.paperId, paperId),
      orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.updatedAt)],
    }),
    db.query.aiArtifacts.findMany({
      where: and(
        eq(aiArtifacts.paperId, paperId),
        inArray(aiArtifacts.kind, ["translation", "translation-range"]),
      ),
      orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.updatedAt)],
    }),
  ]);

  const files = (
    await Promise.all([
      ...threadRows.map((row) =>
        syncThreadMarkdownFile(
          {
            ...mapAskThread(row),
            messages: [],
          },
          paper.title,
        ),
      ),
      ...artifactRows.map((row) => syncArtifactMarkdownFile(mapArtifact(row), paper.title)),
    ])
  ).filter((entry): entry is PaperMarkdownFileRecord => Boolean(entry));

  return files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

async function listThreadMessages(threadId: string) {
  const rows = await db.query.aiThreadMessages.findMany({
    where: eq(aiThreadMessages.threadId, threadId),
    orderBy: (fields, { asc }) => [asc(fields.createdAt)],
  });

  return rows.map(mapAskThreadMessage);
}

async function getAskThread(threadId: string) {
  const row = await db.query.aiThreads.findFirst({
    where: eq(aiThreads.id, threadId),
  });

  if (!row) {
    return null;
  }

  return {
    ...mapAskThread(row),
    messages: await listThreadMessages(threadId),
  };
}

async function syncAskThread(threadId: string, title?: string) {
  const row = await db.query.aiThreads.findFirst({
    where: eq(aiThreads.id, threadId),
  });

  if (!row) {
    throw new Error("스레드를 찾지 못했습니다.");
  }

  const messages = await listThreadMessages(threadId);
  const nextTitle = title ?? row.title;
  const contentMd = buildThreadMarkdown(
    nextTitle,
    messages.map((message) => ({
      role: message.role,
      contentMd: message.contentMd,
      createdAt: message.createdAt,
      selectionRef: message.selectionRef,
    })),
  );

  await db
    .update(aiThreads)
    .set({
      title: nextTitle,
      contentMd,
      updatedAt: nowIso(),
    })
    .where(eq(aiThreads.id, threadId));

  const thread = {
    ...mapAskThread(
      (
        await db.query.aiThreads.findFirst({
          where: eq(aiThreads.id, threadId),
        })
      )!,
    ),
    messages,
  };

  await syncThreadMarkdownFile(thread);
  return thread;
}

async function appendAskTurn(args: {
  threadId: string;
  question: string;
  answerMd: string;
  selection?: PaperSelectionRef | null;
  artifactId: string;
}) {
  const thread = await db.query.aiThreads.findFirst({
    where: eq(aiThreads.id, args.threadId),
  });

  if (!thread) {
    throw new Error("스레드를 찾지 못했습니다.");
  }

  const now = nowIso();

  await db.insert(aiThreadMessages).values([
    {
      id: crypto.randomUUID(),
      threadId: args.threadId,
      role: "user",
      contentMd: args.question.trim(),
      selectionRefJson: args.selection ? stringifyJsonColumn(args.selection) : null,
      artifactId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: crypto.randomUUID(),
      threadId: args.threadId,
      role: "assistant",
      contentMd: args.answerMd.trim(),
      selectionRefJson: null,
      artifactId: args.artifactId,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const title =
    thread.title === "새 스레드" ? deriveThreadTitle(args.question) : thread.title;

  return syncAskThread(args.threadId, title);
}

function buildThreadAwareQuery(question: string, thread: AskThreadRecord | null) {
  const previousQuestions = (thread?.messages ?? [])
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.contentMd.trim());

  return [...previousQuestions, question.trim()].filter(Boolean).join(" ").trim();
}

async function ensureAskThread(paperId: string, threadId?: string | null) {
  if (!threadId) {
    return createAskThread(paperId);
  }

  const thread = await getAskThread(threadId);

  if (!thread || thread.paperId !== paperId) {
    throw new Error("선택한 스레드를 찾지 못했습니다.");
  }

  return thread;
}

export async function createAskThread(paperId: string, title = "새 스레드") {
  const now = nowIso();
  const normalizedTitle = title.trim() || "새 스레드";
  const id = crypto.randomUUID();

  await db.insert(aiThreads).values({
    id,
    paperId,
    title: normalizedTitle,
    contentMd: buildThreadMarkdown(normalizedTitle, []),
    createdAt: now,
    updatedAt: now,
  });

  const thread = await getAskThread(id);

  if (!thread) {
    throw new Error("스레드 생성에 실패했습니다.");
  }

  await syncThreadMarkdownFile(thread);
  return thread;
}

export async function openPaperMarkdownFolder(paperId: string) {
  const directory = await syncPaperMarkdownFiles(paperId);
  openDirectoryInFileManager(directory);
  return {
    path: directory,
  };
}

export const openAskThreadFolder = openPaperMarkdownFolder;

export async function persistSelectionPreview(dataUrl: string) {
  const base64 = dataUrl.split(",")[1];

  if (!base64) {
    return null;
  }

  const filePath = `${appPaths.artifactDir}/selection-${crypto.randomUUID()}.png`;
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

function normalizeTranslationPageRange(
  pageStart?: number,
  pageEnd?: number,
): { pageStart: number; pageEnd: number } | null {
  const normalizedStart = pageStart ?? null;
  const normalizedEnd = pageEnd ?? null;

  if (normalizedStart === null && normalizedEnd === null) {
    return null;
  }

  if (normalizedStart === null || normalizedEnd === null) {
    throw new Error("페이지 범위는 시작과 끝을 함께 지정해야 합니다.");
  }

  return {
    pageStart: normalizedStart,
    pageEnd: normalizedEnd,
  };
}

function buildTranslationDocumentContent(
  sections: ReturnType<typeof createTranslationSection>[],
  pageRange?: { pageStart: number; pageEnd: number } | null,
) {
  if (!pageRange) {
    return buildTranslationDocumentWithOptions(sections, {
      title: "## 전문 번역",
    });
  }

  return buildTranslationDocumentWithOptions(sections, {
    title: `## 범위 번역 ${formatTranslationPageRange(pageRange.pageStart, pageRange.pageEnd)}`,
    description: `선택한 페이지 범위 ${formatTranslationPageRange(pageRange.pageStart, pageRange.pageEnd)}만 번역했습니다.`,
  });
}

export async function generateSummary(paperId: string, profileId: string, force = false) {
  return interactiveQueue.add(async () => {
    const chunks = await searchRelevantChunks(paperId, "summary abstract methodology results", 10);
    const prompt = buildSummaryPrompt(chunks);
    const { profile } = await getProfileAccess(profileId);
    const artifact = await createOrReuseArtifact({
      paperId,
      kind: "summary",
      promptVersion: prompt.version,
      profileId,
      model: profile.model,
      force,
    });

    if (artifact.status === "completed" && artifact.contentMd && !force) {
      return artifact;
    }

    try {
      const completion = await runModelRequest({
        paperId,
        profileId,
        system: prompt.system,
        user: prompt.user,
      });
      return updateArtifact(artifact.id, completion.content, "completed");
    } catch (error) {
      return updateArtifact(
        artifact.id,
        `## 오류\n${error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다."}`,
        "failed",
      );
    }
  });
}

export async function streamSummary(args: {
  paperId: string;
  profileId: string;
  force?: boolean;
  callbacks?: SummaryStreamCallbacks;
}) {
  return interactiveQueue.add(async () => {
    const chunks = await searchRelevantChunks(
      args.paperId,
      "summary abstract methodology results",
      10,
    );
    const prompt = buildSummaryPrompt(chunks);
    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createOrReuseArtifact({
      paperId: args.paperId,
      kind: "summary",
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
      force: args.force,
    });

    if (artifact.status === "completed" && artifact.contentMd && !args.force) {
      await args.callbacks?.onComplete?.(artifact);
      return artifact;
    }

    let streamedContent = "";

    try {
      const completion = await runModelRequest({
        paperId: args.paperId,
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
        stream: {
          onDelta: async (delta) => {
            streamedContent += delta;
            await args.callbacks?.onDelta?.(delta, streamedContent);
          },
        },
      });
      const savedArtifact = await updateArtifact(artifact.id, completion.content, "completed");
      await args.callbacks?.onComplete?.(savedArtifact);
      return savedArtifact;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다.";
      const contentMd = streamedContent
        ? `${streamedContent}\n\n## 오류\n${message}`.trim()
        : `## 오류\n${message}`;
      const failedArtifact = await updateArtifact(artifact.id, contentMd, "failed");
      await args.callbacks?.onError?.(message, failedArtifact);
      return failedArtifact;
    }
  });
}

export async function generateTranslation(args: {
  paperId: string;
  profileId: string;
  force?: boolean;
  pageStart?: number;
  pageEnd?: number;
}) {
  return translationQueue.add(async () => {
    const pageRange = normalizeTranslationPageRange(args.pageStart, args.pageEnd);
    const chunks = await db.query.paperChunks.findMany({
      where: eq(paperChunks.paperId, args.paperId),
      orderBy: (fields, { asc }) => [asc(fields.chunkIndex)],
    });
    const allChunks = chunks.map(mapChunk);
    const mappedChunks = pageRange
      ? allChunks.filter(
          (chunk) =>
            chunk.pageStart <= pageRange.pageEnd && chunk.pageEnd >= pageRange.pageStart,
        )
      : allChunks;

    if (mappedChunks.length === 0) {
      throw new Error("선택한 페이지 범위에 해당하는 본문 청크를 찾지 못했습니다.");
    }

    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createOrReuseArtifact({
      paperId: args.paperId,
      kind: pageRange ? "translation-range" : "translation",
      promptVersion: PROMPT_VERSIONS.translation,
      profileId: args.profileId,
      model: profile.model,
      cacheKey: pageRange ?? undefined,
      force: args.force,
    });

    if (artifact.status === "completed" && artifact.contentMd && !args.force) {
      return artifact;
    }

    const resumedSections = !args.force
      ? parseTranslationDocument(artifact.contentMd).slice(0, mappedChunks.length)
      : [];
    const translatedSections = resumedSections.map((section, index) => ({
      ...section,
      chunkIndex: mappedChunks[index]?.chunkIndex ?? index,
      heading: mappedChunks[index]?.heading ?? section.heading,
      pageStart: mappedChunks[index]?.pageStart ?? section.pageStart,
      pageEnd: mappedChunks[index]?.pageEnd ?? section.pageEnd,
    }));

    try {
      for (let index = translatedSections.length; index < mappedChunks.length; index += 1) {
        const chunk = mappedChunks[index];
        const prompt = buildTranslationSectionPrompt(chunk, {
          index: index + 1,
          total: mappedChunks.length,
        });
        const completion = await runModelRequest({
          paperId: args.paperId,
          profileId: args.profileId,
          system: prompt.system,
          user: prompt.user,
          attachPaperPdf: false,
        });

        translatedSections.push(createTranslationSection(chunk, completion.content));
        await updateArtifact(
          artifact.id,
          buildTranslationDocumentContent(translatedSections, pageRange),
          "pending",
        );
      }

      return updateArtifact(
        artifact.id,
        buildTranslationDocumentContent(translatedSections, pageRange),
        "completed",
      );
    } catch (error) {
      const partialContent = buildTranslationDocumentContent(translatedSections, pageRange);
      return updateArtifact(
        artifact.id,
        `${partialContent}\n\n## 오류\n${
          error instanceof Error
            ? error.message
            : pageRange
              ? "범위 번역 생성에 실패했습니다."
              : "전문 번역 생성에 실패했습니다."
        }`.trim(),
        "failed",
      );
    }
  });
}

const focusKindToArtifactKind: Record<FocusKind, AiArtifactKind> = {
  methodology: "focus-methodology",
  "experimental-setup": "focus-experimental-setup",
  results: "focus-results",
  contribution: "focus-contribution",
  limitations: "focus-limitations",
};

export async function generateQa(args: {
  paperId: string;
  profileId: string;
  question: string;
  selection?: PaperSelectionRef | null;
  threadId?: string | null;
}) {
  return interactiveQueue.add<AskRunResult>(async () => {
    const selection = await ensureAreaSelectionPath(args.selection);
    const thread = await ensureAskThread(args.paperId, args.threadId);
    const retrievalQuery = buildThreadAwareQuery(args.question, thread);
    const chunks = await searchRelevantChunks(args.paperId, retrievalQuery, 8);
    const prompt = buildQaPrompt(args.question, chunks, selection, thread.contentMd);
    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createArtifact({
      paperId: args.paperId,
      kind: "qa",
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
      selectionRef: selection,
    });

    try {
      const completion = await runModelRequest({
        paperId: args.paperId,
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
        selection,
      });
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question: args.question,
          answerMd: completion.content,
          selection,
        }),
        "completed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question: args.question,
        answerMd: completion.content,
        selection,
        artifactId: savedArtifact.id,
      });
      return {
        artifact: savedArtifact,
        thread: updatedThread,
      };
    } catch (error) {
      const answerMd = `## 오류\n${
        error instanceof Error ? error.message : "질의응답 생성에 실패했습니다."
      }`;
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question: args.question,
          answerMd,
          selection,
        }),
        "failed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question: args.question,
        answerMd,
        selection,
        artifactId: savedArtifact.id,
      });
      return {
        artifact: savedArtifact,
        thread: updatedThread,
      };
    }
  });
}

export async function streamQa(args: {
  paperId: string;
  profileId: string;
  question: string;
  selection?: PaperSelectionRef | null;
  threadId?: string | null;
  callbacks?: AskStreamCallbacks;
}) {
  return interactiveQueue.add<AskRunResult>(async () => {
    const selection = await ensureAreaSelectionPath(args.selection);
    const thread = await ensureAskThread(args.paperId, args.threadId);
    const retrievalQuery = buildThreadAwareQuery(args.question, thread);
    const chunks = await searchRelevantChunks(args.paperId, retrievalQuery, 8);
    const prompt = buildQaPrompt(args.question, chunks, selection, thread.contentMd);
    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createArtifact({
      paperId: args.paperId,
      kind: "qa",
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
      selectionRef: selection,
    });

    await args.callbacks?.onStart?.({
      artifact,
      thread,
    });

    let streamedAnswer = "";

    try {
      const completion = await runModelRequest({
        paperId: args.paperId,
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
        selection,
        stream: {
          onDelta: async (delta) => {
            streamedAnswer += delta;
            await args.callbacks?.onDelta?.(delta, streamedAnswer);
          },
        },
      });
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question: args.question,
          answerMd: completion.content,
          selection,
        }),
        "completed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question: args.question,
        answerMd: completion.content,
        selection,
        artifactId: savedArtifact.id,
      });
      const result = {
        artifact: savedArtifact,
        thread: updatedThread,
      };
      await args.callbacks?.onComplete?.(result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "질의응답 생성에 실패했습니다.";
      const answerMd = streamedAnswer
        ? `${streamedAnswer}\n\n## 오류\n${message}`.trim()
        : `## 오류\n${message}`;
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question: args.question,
          answerMd,
          selection,
        }),
        "failed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question: args.question,
        answerMd,
        selection,
        artifactId: savedArtifact.id,
      });
      const result = {
        artifact: savedArtifact,
        thread: updatedThread,
      };
      await args.callbacks?.onError?.({
        message,
        result,
      });
      return result;
    }
  });
}

export async function generateFocusAnalysis(args: {
  paperId: string;
  profileId: string;
  kind: FocusKind;
  threadId?: string | null;
}) {
  return interactiveQueue.add<AskRunResult>(async () => {
    const query = {
      methodology: "method methodology algorithm equation model pipeline",
      "experimental-setup": "experiment setup dataset baseline metric hardware",
      results: "results performance comparison table figure improvement",
      contribution: "contribution novelty main claim",
      limitations: "limitation future work weakness",
    }[args.kind];
    const thread = await ensureAskThread(args.paperId, args.threadId);
    const chunks = await searchRelevantChunks(args.paperId, query, 8);
    const prompt = buildFocusPrompt(args.kind, chunks, thread.contentMd);
    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createArtifact({
      paperId: args.paperId,
      kind: focusKindToArtifactKind[args.kind],
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
    });

    try {
      const completion = await runModelRequest({
        paperId: args.paperId,
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
      });
      const question = focusLabel(args.kind);
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question,
          answerMd: completion.content,
        }),
        "completed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question,
        answerMd: completion.content,
        artifactId: savedArtifact.id,
      });
      return {
        artifact: savedArtifact,
        thread: updatedThread,
      };
    } catch (error) {
      const question = focusLabel(args.kind);
      const answerMd = `## 오류\n${
        error instanceof Error ? error.message : "분석 생성에 실패했습니다."
      }`;
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question,
          answerMd,
        }),
        "failed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question,
        answerMd,
        artifactId: savedArtifact.id,
      });
      return {
        artifact: savedArtifact,
        thread: updatedThread,
      };
    }
  });
}

export async function streamFocusAnalysis(args: {
  paperId: string;
  profileId: string;
  kind: FocusKind;
  threadId?: string | null;
  callbacks?: AskStreamCallbacks;
}) {
  return interactiveQueue.add<AskRunResult>(async () => {
    const query = {
      methodology: "method methodology algorithm equation model pipeline",
      "experimental-setup": "experiment setup dataset baseline metric hardware",
      results: "results performance comparison table figure improvement",
      contribution: "contribution novelty main claim",
      limitations: "limitation future work weakness",
    }[args.kind];
    const thread = await ensureAskThread(args.paperId, args.threadId);
    const chunks = await searchRelevantChunks(args.paperId, query, 8);
    const prompt = buildFocusPrompt(args.kind, chunks, thread.contentMd);
    const { profile } = await getProfileAccess(args.profileId);
    const artifact = await createArtifact({
      paperId: args.paperId,
      kind: focusKindToArtifactKind[args.kind],
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
    });

    await args.callbacks?.onStart?.({
      artifact,
      thread,
    });

    let streamedAnswer = "";
    const question = focusLabel(args.kind);

    try {
      const completion = await runModelRequest({
        paperId: args.paperId,
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
        stream: {
          onDelta: async (delta) => {
            streamedAnswer += delta;
            await args.callbacks?.onDelta?.(delta, streamedAnswer);
          },
        },
      });
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question,
          answerMd: completion.content,
        }),
        "completed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question,
        answerMd: completion.content,
        artifactId: savedArtifact.id,
      });
      const result = {
        artifact: savedArtifact,
        thread: updatedThread,
      };
      await args.callbacks?.onComplete?.(result);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "분석 생성에 실패했습니다.";
      const answerMd = streamedAnswer
        ? `${streamedAnswer}\n\n## 오류\n${message}`.trim()
        : `## 오류\n${message}`;
      const savedArtifact = await updateArtifact(
        artifact.id,
        buildAskArtifactContent({
          question,
          answerMd,
        }),
        "failed",
      );
      const updatedThread = await appendAskTurn({
        threadId: thread.id,
        question,
        answerMd,
        artifactId: savedArtifact.id,
      });
      const result = {
        artifact: savedArtifact,
        thread: updatedThread,
      };
      await args.callbacks?.onError?.({
        message,
        result,
      });
      return result;
    }
  });
}
