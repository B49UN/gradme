import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import "server-only";
import { db, nowIso, parseJsonColumn, rawDb, stringifyJsonColumn } from "@/lib/db/client";
import {
  aiArtifacts,
  aiThreadMessages,
  aiThreads,
  annotations,
  notes,
  paperChunks,
  papers,
  paperSources,
  readingStates,
} from "@/lib/db/schema";
import { appPaths } from "@/lib/server/app-paths";
import { listPaperMarkdownFiles } from "@/lib/ai/service";
import {
  inferApiFormatFromBaseUrl,
  inferProviderFromBaseUrl,
  normalizeAiBaseUrl,
  normalizeReasoningEffort,
} from "@/lib/ai/profile-utils";
import { splitIntoChunks, detectDoi } from "@/lib/papers/chunking";
import { exportBibtex } from "@/lib/papers/bibtex";
import { fetchCrossrefMetadata, resolveIdentifier, type ResolvedPaperMetadata } from "@/lib/papers/metadata";
import { extractPdf, generateThumbnail } from "@/lib/papers/pdf";
import type {
  AiApiFormat,
  AnnotationRecord,
  AnnotationType,
  AskThreadMessageRecord,
  AskThreadRecord,
  NoteRecord,
  PaperDetail,
  PaperRecord,
  PaperSelectionRef,
  PaperSourceType,
  PaperStatus,
  ReasoningEffort,
  WorkspaceSnapshot,
} from "@/lib/types";

function mapPaper(row: typeof papers.$inferSelect): PaperRecord {
  return {
    id: row.id,
    title: row.title,
    authors: parseJsonColumn<string[]>(row.authorsJson, []),
    venue: row.venue,
    year: row.year,
    doi: row.doi,
    arxivId: row.arxivId,
    abstract: row.abstract,
    status: row.status as PaperStatus,
    favorite: row.favorite,
    hash: row.hash,
    storagePath: row.storagePath,
    thumbnailPath: row.thumbnailPath,
    fullText: row.fullText,
    pageCount: row.pageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAnnotation(row: typeof annotations.$inferSelect): AnnotationRecord {
  return {
    id: row.id,
    paperId: row.paperId,
    noteId: row.noteId,
    type: row.type as AnnotationType,
    page: row.page,
    rects: parseJsonColumn(row.rectsJson, []),
    color: row.color,
    selectedText: row.selectedText,
    selectionRef: parseJsonColumn(row.selectionRefJson, null),
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

function mapNote(row: typeof notes.$inferSelect): NoteRecord {
  return {
    id: row.id,
    paperId: row.paperId,
    annotationId: row.annotationId,
    title: row.title,
    contentMd: row.contentMd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function serializePaperSource(
  row: typeof paperSources.$inferSelect,
): { id: string; sourceType: PaperSourceType; sourceValue: string } {
  return {
    id: row.id,
    sourceType: row.sourceType as PaperSourceType,
    sourceValue: row.sourceValue,
  };
}

async function addPaperSource(paperId: string, sourceType: PaperSourceType, sourceValue: string) {
  const existing = await db.query.paperSources.findFirst({
    where: and(eq(paperSources.paperId, paperId), eq(paperSources.sourceValue, sourceValue)),
  });

  if (existing) {
    return existing;
  }

  const row = {
    id: crypto.randomUUID(),
    paperId,
    sourceType,
    sourceValue,
    createdAt: nowIso(),
  };

  await db.insert(paperSources).values(row);
  return row;
}

function normalizeAuthors(authors: string[] | null | undefined) {
  if (!authors || authors.length === 0) {
    return [];
  }

  return authors.map((author) => author.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function mergeMetadata(
  extracted: Awaited<ReturnType<typeof extractPdf>>,
  resolved: ResolvedPaperMetadata | null,
  detectedDoi: string | null,
) {
  return {
    title: resolved?.title ?? extracted.title ?? "Untitled paper",
    authors: normalizeAuthors(resolved?.authors),
    venue: resolved?.venue ?? null,
    year: resolved?.year ?? null,
    doi: resolved?.doi ?? detectedDoi ?? null,
    arxivId: resolved?.arxivId ?? null,
    abstract: resolved?.abstract ?? null,
  };
}

async function persistPdf(hash: string, buffer: Buffer) {
  const filePath = path.join(appPaths.pdfDir, `${hash}.pdf`);

  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, buffer);
  }

  return filePath;
}

function syncFtsChunks(
  paperId: string,
  chunks: Array<{ id: string; heading: string | null; content: string }>,
) {
  rawDb.prepare("DELETE FROM paper_chunks_fts WHERE paper_id = ?").run(paperId);

  const statement = rawDb.prepare(
    "INSERT INTO paper_chunks_fts (chunk_id, paper_id, heading, content) VALUES (?, ?, ?, ?)",
  );
  const transaction = rawDb.transaction(() => {
    for (const chunk of chunks) {
      statement.run(chunk.id, paperId, chunk.heading, chunk.content);
    }
  });
  transaction();
}

async function findPaperByHash(hash: string) {
  const row = await db.query.papers.findFirst({
    where: eq(papers.hash, hash),
  });

  return row ? mapPaper(row) : null;
}

async function enrichMetadataFromDoi(doi: string | null) {
  if (!doi) {
    return null;
  }

  return fetchCrossrefMetadata(doi).catch(() => null);
}

async function createImportedPaper(args: {
  buffer: Buffer;
  sourceType: PaperSourceType;
  sourceValue: string;
  resolvedMetadata?: ResolvedPaperMetadata | null;
}) {
  const hash = crypto.createHash("sha256").update(args.buffer).digest("hex");
  const duplicate = await findPaperByHash(hash);

  if (duplicate) {
    await addPaperSource(duplicate.id, args.sourceType, args.sourceValue);
    return getPaperDetail(duplicate.id);
  }

  const extracted = await extractPdf(args.buffer);

  if (!extracted.fullText.trim()) {
    throw new Error("PDF에서 텍스트를 추출하지 못했습니다. 텍스트 레이어가 있는 논문 PDF를 사용하세요.");
  }

  const detectedDoi = detectDoi(extracted.fullText);
  const resolvedMetadata =
    args.resolvedMetadata ??
    (await enrichMetadataFromDoi(detectedDoi));
  const mergedMetadata = mergeMetadata(extracted, resolvedMetadata, detectedDoi);
  const paperId = crypto.randomUUID();
  const storagePath = await persistPdf(hash, args.buffer);
  const thumbnailPath = await generateThumbnail(args.buffer, paperId, mergedMetadata.title);
  const now = nowIso();
  const chunks = splitIntoChunks(extracted.pages).map((chunk) => ({
    id: crypto.randomUUID(),
    paperId,
    heading: chunk.heading,
    content: chunk.content,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    chunkIndex: chunk.chunkIndex,
    tokenEstimate: chunk.tokenEstimate,
    createdAt: now,
  }));

  await db.insert(papers).values({
    id: paperId,
    title: mergedMetadata.title,
    authorsJson: stringifyJsonColumn(mergedMetadata.authors),
    venue: mergedMetadata.venue,
    year: mergedMetadata.year,
    doi: mergedMetadata.doi,
    arxivId: mergedMetadata.arxivId,
    abstract: mergedMetadata.abstract,
    status: "new",
    favorite: false,
    hash,
    storagePath,
    thumbnailPath,
    fullText: extracted.fullText,
    pageCount: extracted.pageCount,
    createdAt: now,
    updatedAt: now,
  });

  await addPaperSource(paperId, args.sourceType, args.sourceValue);

  if (chunks.length > 0) {
    await db.insert(paperChunks).values(chunks);
    syncFtsChunks(
      paperId,
      chunks.map((chunk) => ({
        id: chunk.id,
        heading: chunk.heading,
        content: chunk.content,
      })),
    );
  }

  await db.insert(readingStates).values({
    paperId,
    currentPage: 1,
    zoom: 1,
    lastOpenedAt: now,
  });

  return getPaperDetail(paperId);
}

export async function importPaperFromFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createImportedPaper({
    buffer,
    sourceType: "upload",
    sourceValue: file.name,
  });
}

export async function importPaperFromUrl(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("PDF URL을 가져오지 못했습니다.");
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("pdf")) {
    throw new Error("URL이 PDF 문서를 가리키지 않습니다.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return createImportedPaper({
    buffer,
    sourceType: "url",
    sourceValue: url,
  });
}

export async function importPaperFromIdentifier(identifier: string) {
  const metadata = await resolveIdentifier(identifier);

  if (!metadata) {
    throw new Error("DOI/arXiv 메타데이터를 찾지 못했습니다.");
  }

  if (!metadata.pdfUrl) {
    throw new Error("직접 내려받을 수 있는 PDF 링크를 찾지 못했습니다. PDF URL을 직접 입력하세요.");
  }

  const response = await fetch(metadata.pdfUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("식별자에서 PDF를 내려받지 못했습니다.");
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("pdf")) {
    throw new Error("식별자가 PDF 파일로 해석되지 않았습니다.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return createImportedPaper({
    buffer,
    sourceType: metadata.arxivId ? "arxiv" : "doi",
    sourceValue: identifier,
    resolvedMetadata: metadata,
  });
}

export async function listPapers() {
  const rows = await db.query.papers.findMany({
    orderBy: [desc(papers.updatedAt)],
  });
  return rows.map(mapPaper);
}

export async function getPaperDetail(paperId: string): Promise<PaperDetail | null> {
  const paperRow = await db.query.papers.findFirst({
    where: eq(papers.id, paperId),
  });

  if (!paperRow) {
    return null;
  }

  const [
    sourceRows,
    annotationRows,
    noteRows,
    chunkRows,
    artifactRows,
    threadRows,
    readingStateRow,
    markdownFiles,
  ] =
    await Promise.all([
      db.query.paperSources.findMany({
        where: eq(paperSources.paperId, paperId),
      }),
      db.query.annotations.findMany({
        where: eq(annotations.paperId, paperId),
        orderBy: (fields, { asc }) => [asc(fields.page), asc(fields.createdAt)],
      }),
      db.query.notes.findMany({
        where: eq(notes.paperId, paperId),
        orderBy: (fields, { desc: drizzleDesc }) => [drizzleDesc(fields.updatedAt)],
      }),
      db.query.paperChunks.findMany({
        where: eq(paperChunks.paperId, paperId),
        orderBy: (fields, { asc }) => [asc(fields.chunkIndex)],
      }),
      db.query.aiArtifacts.findMany({
        where: eq(aiArtifacts.paperId, paperId),
        orderBy: (fields, { desc: drizzleDesc }) => [drizzleDesc(fields.createdAt)],
      }),
      db.query.aiThreads.findMany({
        where: eq(aiThreads.paperId, paperId),
        orderBy: (fields, { desc: drizzleDesc }) => [drizzleDesc(fields.updatedAt)],
      }),
      db.query.readingStates.findFirst({
        where: eq(readingStates.paperId, paperId),
      }),
      listPaperMarkdownFiles(paperId),
    ]);

  const threadIds = new Set(threadRows.map((row) => row.id));
  const threadMessageRows =
    threadRows.length === 0
      ? []
      : await db.query.aiThreadMessages.findMany({
          where: inArray(
            aiThreadMessages.threadId,
            threadRows.map((row) => row.id),
          ),
          orderBy: (fields, { asc }) => [asc(fields.createdAt)],
        });
  const groupedThreadMessages = threadMessageRows
    .filter((row) => threadIds.has(row.threadId))
    .reduce<Record<string, AskThreadMessageRecord[]>>((accumulator, row) => {
      if (!accumulator[row.threadId]) {
        accumulator[row.threadId] = [];
      }

      accumulator[row.threadId].push(mapAskThreadMessage(row));
      return accumulator;
    }, {});

  return {
    ...mapPaper(paperRow),
    sources: sourceRows.map(serializePaperSource),
    annotations: annotationRows.map(mapAnnotation),
    notes: noteRows.map(mapNote),
    chunks: chunkRows.map((row) => ({
      id: row.id,
      paperId: row.paperId,
      heading: row.heading,
      content: row.content,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      chunkIndex: row.chunkIndex,
      tokenEstimate: row.tokenEstimate,
    })),
    artifacts: artifactRows.map((row) => ({
      id: row.id,
      paperId: row.paperId,
      kind: row.kind as PaperDetail["artifacts"][number]["kind"],
      promptVersion: row.promptVersion,
      profileId: row.profileId,
      model: row.model,
      selectionHash: row.selectionHash,
      selectionRef: parseJsonColumn(row.selectionRefJson, null),
      contentMd: row.contentMd,
      status: row.status as PaperDetail["artifacts"][number]["status"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    askThreads: threadRows.map((row) => ({
      ...mapAskThread(row),
      messages: groupedThreadMessages[row.id] ?? [],
    })),
    markdownFiles,
    readingState: readingStateRow
      ? {
          paperId: readingStateRow.paperId,
          currentPage: readingStateRow.currentPage,
          zoom: readingStateRow.zoom,
          lastOpenedAt: readingStateRow.lastOpenedAt,
        }
      : null,
  };
}

export async function getWorkspaceSnapshot(selectedPaperId?: string | null): Promise<WorkspaceSnapshot> {
  const paperList = await listPapers();
  const targetId = selectedPaperId ?? paperList[0]?.id ?? null;
  const selectedPaper = targetId ? await getPaperDetail(targetId) : null;
  const profiles = await db.query.aiProfiles.findMany({
    orderBy: (fields, { asc }) => [asc(fields.name)],
  });

  return {
    papers: paperList,
    selectedPaper,
    profiles: profiles.map((row) => {
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
    }),
  };
}

export async function createAnnotation(input: {
  paperId: string;
  noteId?: string | null;
  type: AnnotationType;
  page: number;
  rects: PaperSelectionRef["rects"];
  color: string;
  selectedText?: string | null;
  selectionRef?: PaperSelectionRef | null;
}) {
  const now = nowIso();
  const row = {
    id: crypto.randomUUID(),
    paperId: input.paperId,
    noteId: input.noteId ?? null,
    type: input.type,
    page: input.page,
    rectsJson: stringifyJsonColumn(input.rects),
    color: input.color,
    selectedText: input.selectedText ?? null,
    selectionRefJson: input.selectionRef ? stringifyJsonColumn(input.selectionRef) : null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(annotations).values(row);
  return mapAnnotation(row);
}

export async function createNote(input: {
  paperId: string;
  annotationId?: string | null;
  title: string;
  contentMd: string;
}) {
  const now = nowIso();
  const row = {
    id: crypto.randomUUID(),
    paperId: input.paperId,
    annotationId: input.annotationId ?? null,
    title: input.title,
    contentMd: input.contentMd,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(notes).values(row);

  if (input.annotationId) {
    await db
      .update(annotations)
      .set({
        noteId: row.id,
        updatedAt: now,
      })
      .where(eq(annotations.id, input.annotationId));
  }

  return mapNote(row);
}

export async function deleteAnnotation(paperId: string, annotationId: string) {
  const annotation = await db.query.annotations.findFirst({
    where: and(eq(annotations.id, annotationId), eq(annotations.paperId, paperId)),
  });

  if (!annotation) {
    throw new Error("삭제할 주석을 찾지 못했습니다.");
  }

  const now = nowIso();

  if (annotation.noteId) {
    await db
      .update(notes)
      .set({
        annotationId: null,
        updatedAt: now,
      })
      .where(and(eq(notes.id, annotation.noteId), eq(notes.paperId, paperId)));
  }

  await db
    .delete(annotations)
    .where(and(eq(annotations.id, annotationId), eq(annotations.paperId, paperId)));

  return { id: annotationId };
}

export async function deleteNote(paperId: string, noteId: string) {
  const note = await db.query.notes.findFirst({
    where: and(eq(notes.id, noteId), eq(notes.paperId, paperId)),
  });

  if (!note) {
    throw new Error("삭제할 메모를 찾지 못했습니다.");
  }

  await db
    .delete(annotations)
    .where(and(eq(annotations.paperId, paperId), eq(annotations.noteId, noteId)));

  await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.paperId, paperId)));

  return { id: noteId };
}

export async function readPaperAsset(paperId: string, asset: "pdf" | "thumbnail") {
  const paper = await db.query.papers.findFirst({
    where: eq(papers.id, paperId),
  });

  if (!paper) {
    return null;
  }

  const filePath = asset === "pdf" ? paper.storagePath : paper.thumbnailPath;

  if (!filePath) {
    return null;
  }

  const buffer = await fs.readFile(filePath);
  const contentType =
    asset === "pdf"
      ? "application/pdf"
      : filePath.endsWith(".svg")
        ? "image/svg+xml"
        : "image/png";

  return {
    buffer,
    contentType,
    fileName: path.basename(filePath),
  };
}

export async function exportLibraryBibtex() {
  const allPapers = await listPapers();
  return exportBibtex(allPapers);
}
