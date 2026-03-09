import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  authorsJson: text("authors_json").notNull(),
  venue: text("venue"),
  year: integer("year"),
  doi: text("doi"),
  arxivId: text("arxiv_id"),
  abstract: text("abstract"),
  status: text("status").notNull().default("new"),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  hash: text("hash").notNull(),
  storagePath: text("storage_path").notNull(),
  thumbnailPath: text("thumbnail_path"),
  fullText: text("full_text").notNull(),
  pageCount: integer("page_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("papers_hash_idx").on(table.hash),
  index("papers_status_idx").on(table.status),
]);

export const paperSources = sqliteTable("paper_sources", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceValue: text("source_value").notNull(),
  createdAt: text("created_at").notNull(),
});

export const paperChunks = sqliteTable("paper_chunks", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  heading: text("heading"),
  content: text("content").notNull(),
  pageStart: integer("page_start").notNull(),
  pageEnd: integer("page_end").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  tokenEstimate: integer("token_estimate").notNull().default(0),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("paper_chunks_unique_idx").on(table.paperId, table.chunkIndex),
  index("paper_chunks_paper_idx").on(table.paperId),
]);

export const annotations = sqliteTable("annotations", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  noteId: text("note_id"),
  type: text("type").notNull(),
  page: integer("page").notNull(),
  rectsJson: text("rects_json").notNull(),
  color: text("color").notNull(),
  selectedText: text("selected_text"),
  selectionRefJson: text("selection_ref_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("annotations_paper_page_idx").on(table.paperId, table.page),
]);

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  annotationId: text("annotation_id"),
  title: text("title").notNull(),
  contentMd: text("content_md").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("notes_paper_idx").on(table.paperId),
]);

export const aiProfiles = sqliteTable("ai_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiFormat: text("api_format").notNull().default("responses"),
  model: text("model").notNull(),
  supportsVision: integer("supports_vision", { mode: "boolean" }).notNull().default(false),
  streamingEnabled: integer("streaming_enabled", { mode: "boolean" }).notNull().default(true),
  temperature: real("temperature").notNull().default(0.2),
  maxTokens: integer("max_tokens").notNull().default(1600),
  reasoningEffort: text("reasoning_effort"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("ai_profiles_name_idx").on(table.name),
]);

export const aiArtifacts = sqliteTable("ai_artifacts", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  promptVersion: text("prompt_version").notNull(),
  profileId: text("profile_id").references(() => aiProfiles.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  selectionHash: text("selection_hash"),
  selectionRefJson: text("selection_ref_json"),
  contentMd: text("content_md").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("ai_artifacts_paper_kind_idx").on(table.paperId, table.kind),
]);

export const aiThreads = sqliteTable("ai_threads", {
  id: text("id").primaryKey(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  contentMd: text("content_md").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("ai_threads_paper_idx").on(table.paperId),
]);

export const aiThreadMessages = sqliteTable("ai_thread_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => aiThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  contentMd: text("content_md").notNull(),
  selectionRefJson: text("selection_ref_json"),
  artifactId: text("artifact_id").references(() => aiArtifacts.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("ai_thread_messages_thread_idx").on(table.threadId, table.createdAt),
]);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
}, (table) => [uniqueIndex("tags_name_idx").on(table.name)]);

export const paperTags = sqliteTable("paper_tags", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.paperId, table.tagId] })]);

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("collections_name_idx").on(table.name)]);

export const paperCollections = sqliteTable("paper_collections", {
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  collectionId: text("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.paperId, table.collectionId] })]);

export const readingStates = sqliteTable("reading_states", {
  paperId: text("paper_id").primaryKey().references(() => papers.id, { onDelete: "cascade" }),
  currentPage: integer("current_page").notNull().default(1),
  zoom: real("zoom").notNull().default(1),
  lastOpenedAt: text("last_opened_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schema = {
  aiArtifacts,
  aiProfiles,
  aiThreadMessages,
  aiThreads,
  annotations,
  collections,
  notes,
  paperChunks,
  paperCollections,
  papers,
  paperSources,
  paperTags,
  readingStates,
  settings,
  tags,
};
