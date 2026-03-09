import crypto from "node:crypto";
import fs from "node:fs/promises";
import OpenAI from "openai";
import PQueue from "p-queue";
import { and, desc, eq, sql } from "drizzle-orm";
import "server-only";
import { db, nowIso, rawDb, parseJsonColumn, stringifyJsonColumn } from "@/lib/db/client";
import {
  aiArtifacts,
  aiProfiles,
  paperChunks,
} from "@/lib/db/schema";
import {
  buildFocusPrompt,
  buildQaPrompt,
  buildSummaryPrompt,
  buildTranslationPrompt,
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
import type {
  AiApiFormat,
  AiArtifactKind,
  AiArtifactRecord,
  AiProfileRecord,
  FocusKind,
  PaperChunkRecord,
  PaperSelectionRef,
  ReasoningEffort,
} from "@/lib/types";
import { stableStringify } from "@/lib/utils";

const aiQueue = new PQueue({ concurrency: 1 });

function mapProfile(row: typeof aiProfiles.$inferSelect): AiProfileRecord {
  return {
    id: row.id,
    name: row.name,
    provider: inferProviderFromBaseUrl(row.baseUrl),
    baseUrl: normalizeAiBaseUrl(row.baseUrl),
    apiFormat: (row.apiFormat as AiApiFormat | null) ?? inferApiFormatFromBaseUrl(row.baseUrl),
    model: row.model,
    supportsVision: row.supportsVision,
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

async function createOrReuseArtifact(args: {
  paperId: string;
  kind: AiArtifactKind;
  promptVersion: string;
  profileId: string;
  model: string;
  selectionRef?: PaperSelectionRef | null;
  force?: boolean;
}) {
  const selectionHash = args.selectionRef
    ? crypto.createHash("sha256").update(stableStringify(args.selectionRef)).digest("hex")
    : null;

  const existing = await db.query.aiArtifacts.findFirst({
    where: and(
      eq(aiArtifacts.paperId, args.paperId),
      eq(aiArtifacts.kind, args.kind),
      eq(aiArtifacts.promptVersion, args.promptVersion),
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

  return mapArtifact(row);
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

async function runModelRequest(args: {
  profileId: string;
  system: string;
  user: string;
  selection?: PaperSelectionRef | null;
}) {
  const { client, profile } = await getClient(args.profileId);
  const imageDataUrl = await readSelectionImage(args.selection);

  if (args.selection?.type === "area" && !profile.supportsVision) {
    throw new Error("선택한 모델 프로필은 비전 입력을 지원하지 않습니다. Vision 지원 프로필을 선택하세요.");
  }

  let content = "";

  if (profile.apiFormat === "chat-completions") {
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
  } else {
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
  maxOutputTokens: number;
  reasoningEffort?: ReasoningEffort | null;
  apiKey: string;
}) {
  const now = nowIso();
  const id = input.id ?? crypto.randomUUID();
  const baseUrl = normalizeAiBaseUrl(input.baseUrl);
  const providerDefaults = getProviderDefaults(inferProviderFromBaseUrl(baseUrl));
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
          providerDefaults.provider === "google-ai-studio" ? "chat-completions" : input.apiFormat,
        model: input.model,
        supportsVision: input.supportsVision,
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
        providerDefaults.provider === "google-ai-studio" ? "chat-completions" : input.apiFormat,
      model: input.model,
      supportsVision: input.supportsVision,
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

export async function persistSelectionPreview(dataUrl: string) {
  const base64 = dataUrl.split(",")[1];

  if (!base64) {
    return null;
  }

  const filePath = `${appPaths.artifactDir}/selection-${crypto.randomUUID()}.png`;
  await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

export async function generateSummary(paperId: string, profileId: string, force = false) {
  return aiQueue.add(async () => {
    const chunks = await searchRelevantChunks(paperId, "summary abstract methodology results", 10);
    const prompt = buildSummaryPrompt(chunks);
    const { profile } = await getClient(profileId);
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

export async function generateTranslation(paperId: string, profileId: string, force = false) {
  return aiQueue.add(async () => {
    const chunks = await db.query.paperChunks.findMany({
      where: eq(paperChunks.paperId, paperId),
      orderBy: (fields, { asc }) => [asc(fields.chunkIndex)],
    });
    const mappedChunks = chunks.map(mapChunk);
    const prompt = buildTranslationPrompt(mappedChunks);
    const { profile } = await getClient(profileId);
    const artifact = await createOrReuseArtifact({
      paperId,
      kind: "translation",
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
        profileId,
        system: prompt.system,
        user: prompt.user,
      });
      return updateArtifact(artifact.id, completion.content, "completed");
    } catch (error) {
      return updateArtifact(
        artifact.id,
        `## 오류\n${error instanceof Error ? error.message : "전문 번역 생성에 실패했습니다."}`,
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
  force?: boolean;
}) {
  return aiQueue.add(async () => {
    const selection = await ensureAreaSelectionPath(args.selection);
    const chunks = await searchRelevantChunks(args.paperId, args.question, 8);
    const prompt = buildQaPrompt(args.question, chunks, selection);
    const { profile } = await getClient(args.profileId);
    const artifact = await createOrReuseArtifact({
      paperId: args.paperId,
      kind: "qa",
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
      selectionRef: selection,
      force: args.force,
    });

    if (artifact.status === "completed" && artifact.contentMd && !args.force) {
      return artifact;
    }

    try {
      const completion = await runModelRequest({
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
        selection,
      });
      return updateArtifact(artifact.id, completion.content, "completed");
    } catch (error) {
      return updateArtifact(
        artifact.id,
        `## 오류\n${error instanceof Error ? error.message : "질의응답 생성에 실패했습니다."}`,
        "failed",
      );
    }
  });
}

export async function generateFocusAnalysis(args: {
  paperId: string;
  profileId: string;
  kind: FocusKind;
  force?: boolean;
}) {
  return aiQueue.add(async () => {
    const query = {
      methodology: "method methodology algorithm equation model pipeline",
      "experimental-setup": "experiment setup dataset baseline metric hardware",
      results: "results performance comparison table figure improvement",
      contribution: "contribution novelty main claim",
      limitations: "limitation future work weakness",
    }[args.kind];
    const chunks = await searchRelevantChunks(args.paperId, query, 8);
    const prompt = buildFocusPrompt(args.kind, chunks);
    const { profile } = await getClient(args.profileId);
    const artifact = await createOrReuseArtifact({
      paperId: args.paperId,
      kind: focusKindToArtifactKind[args.kind],
      promptVersion: prompt.version,
      profileId: args.profileId,
      model: profile.model,
      force: args.force,
    });

    if (artifact.status === "completed" && artifact.contentMd && !args.force) {
      return artifact;
    }

    try {
      const completion = await runModelRequest({
        profileId: args.profileId,
        system: prompt.system,
        user: prompt.user,
      });
      return updateArtifact(artifact.id, completion.content, "completed");
    } catch (error) {
      return updateArtifact(
        artifact.id,
        `## 오류\n${error instanceof Error ? error.message : "분석 생성에 실패했습니다."}`,
        "failed",
      );
    }
  });
}
