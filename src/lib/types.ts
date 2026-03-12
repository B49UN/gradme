export type PaperStatus = "new" | "reading" | "reviewed" | "archived";
export type PaperSourceType = "upload" | "url" | "doi" | "arxiv";
export type AnnotationType = "highlight" | "underline" | "area" | "note-link";
export type AiProvider = "openai" | "google-gemini";
export type AiApiFormat = "responses" | "chat-completions" | "gemini-native";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type AiArtifactKind =
  | "summary"
  | "translation"
  | "translation-range"
  | "qa"
  | "focus-methodology"
  | "focus-experimental-setup"
  | "focus-results"
  | "focus-contribution"
  | "focus-limitations";

export type FocusKind =
  | "methodology"
  | "experimental-setup"
  | "results"
  | "contribution"
  | "limitations";

export type NormalizedRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type TextSelectionRef = {
  type: "text";
  page: number;
  rects: NormalizedRect[];
  selectedText: string;
};

export type AreaSelectionRef = {
  type: "area";
  page: number;
  rects: NormalizedRect[];
  imagePath: string | null;
  selectedText?: string;
};

export type PaperSelectionRef = TextSelectionRef | AreaSelectionRef;

export type CollectionRecord = {
  id: string;
  name: string;
  createdAt: string;
};

export type PaperRecord = {
  id: string;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  abstract: string | null;
  status: PaperStatus;
  favorite: boolean;
  hash: string;
  storagePath: string;
  thumbnailPath: string | null;
  fullText: string;
  pageCount: number;
  collections: CollectionRecord[];
  createdAt: string;
  updatedAt: string;
};

export type PaperChunkRecord = {
  id: string;
  paperId: string;
  heading: string | null;
  content: string;
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
  tokenEstimate: number;
};

export type AnnotationRecord = {
  id: string;
  paperId: string;
  noteId: string | null;
  type: AnnotationType;
  page: number;
  rects: NormalizedRect[];
  color: string;
  selectedText: string | null;
  selectionRef: PaperSelectionRef | null;
  createdAt: string;
  updatedAt: string;
};

export type NoteRecord = {
  id: string;
  paperId: string;
  annotationId: string | null;
  title: string;
  contentMd: string;
  createdAt: string;
  updatedAt: string;
};

export type AiProfileRecord = {
  id: string;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  apiFormat: AiApiFormat;
  model: string;
  supportsVision: boolean;
  streamingEnabled: boolean;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort | null;
  createdAt: string;
  updatedAt: string;
};

export type AiArtifactRecord = {
  id: string;
  paperId: string;
  kind: AiArtifactKind;
  promptVersion: string;
  profileId: string | null;
  model: string;
  selectionHash: string | null;
  selectionRef: PaperSelectionRef | null;
  contentMd: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
};

export type AskThreadMessageRecord = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  contentMd: string;
  selectionRef: PaperSelectionRef | null;
  artifactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AskThreadRecord = {
  id: string;
  paperId: string;
  title: string;
  contentMd: string;
  createdAt: string;
  updatedAt: string;
  messages: AskThreadMessageRecord[];
};

export type PaperMarkdownFileRecord = {
  id: string;
  kind: "thread" | "translation" | "translation-range";
  title: string;
  fileName: string;
  path: string;
  targetId: string;
  updatedAt: string;
};

export type ReadingStateRecord = {
  paperId: string;
  currentPage: number;
  zoom: number;
  lastOpenedAt: string;
};

export type PaperDetail = PaperRecord & {
  sources: { id: string; sourceType: PaperSourceType; sourceValue: string }[];
  annotations: AnnotationRecord[];
  notes: NoteRecord[];
  chunks: PaperChunkRecord[];
  artifacts: AiArtifactRecord[];
  askThreads: AskThreadRecord[];
  markdownFiles: PaperMarkdownFileRecord[];
  readingState: ReadingStateRecord | null;
};

export type WorkspaceSnapshot = {
  papers: PaperRecord[];
  selectedPaper: PaperDetail | null;
  profiles: AiProfileRecord[];
  collections: CollectionRecord[];
};
