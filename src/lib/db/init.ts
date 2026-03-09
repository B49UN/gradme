import type Database from "better-sqlite3";

function hasColumn(sqlite: Database.Database, table: string, column: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(
  sqlite: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  if (!hasColumn(sqlite, table, column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function normalizeLegacyAiProfiles(sqlite: Database.Database) {
  const rows = sqlite
    .prepare("SELECT id, base_url, api_format FROM ai_profiles")
    .all() as Array<{ id: string; base_url: string; api_format: string | null }>;

  const update = sqlite.prepare(
    "UPDATE ai_profiles SET base_url = ?, api_format = ? WHERE id = ?",
  );

  const transaction = sqlite.transaction(() => {
    for (const row of rows) {
      const trimmed = row.base_url.trim().replace(/\/+$/, "");
      let apiFormat = row.api_format || "responses";
      let baseUrl = trimmed;

      try {
        const parsed = new URL(trimmed);

        if (parsed.hostname === "generativelanguage.googleapis.com") {
          baseUrl = "https://generativelanguage.googleapis.com";
          apiFormat = "gemini-native";
        } else if (trimmed.endsWith("/chat/completions")) {
          apiFormat = "chat-completions";
          baseUrl = trimmed.slice(0, -"/chat/completions".length) || "/";
        } else if (trimmed.endsWith("/responses")) {
          apiFormat = "responses";
          baseUrl = trimmed.slice(0, -"/responses".length) || "/";
        }
      } catch {
        if (trimmed.endsWith("/chat/completions")) {
          apiFormat = "chat-completions";
          baseUrl = trimmed.slice(0, -"/chat/completions".length) || "/";
        } else if (trimmed.endsWith("/responses")) {
          apiFormat = "responses";
          baseUrl = trimmed.slice(0, -"/responses".length) || "/";
        }
      }

      if (baseUrl !== row.base_url || apiFormat !== row.api_format) {
        update.run(baseUrl, apiFormat, row.id);
      }
    }
  });

  transaction();
}

export function initializeDatabase(sqlite: Database.Database) {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS papers (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      authors_json TEXT NOT NULL,
      venue TEXT,
      year INTEGER,
      doi TEXT,
      arxiv_id TEXT,
      abstract TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      favorite INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      thumbnail_path TEXT,
      full_text TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_sources (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_chunks (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      heading TEXT,
      content TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS paper_chunks_unique_idx ON paper_chunks(paper_id, chunk_index);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      note_id TEXT,
      type TEXT NOT NULL,
      page INTEGER NOT NULL,
      rects_json TEXT NOT NULL,
      color TEXT NOT NULL,
      selected_text TEXT,
      selection_ref_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      annotation_id TEXT,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      api_format TEXT NOT NULL DEFAULT 'responses',
      model TEXT NOT NULL,
      supports_vision INTEGER NOT NULL DEFAULT 0,
      streaming_enabled INTEGER NOT NULL DEFAULT 1,
      temperature REAL NOT NULL DEFAULT 0.2,
      max_tokens INTEGER NOT NULL DEFAULT 1600,
      reasoning_effort TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_artifacts (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      profile_id TEXT REFERENCES ai_profiles(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      selection_hash TEXT,
      selection_ref_json TEXT,
      content_md TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_threads (
      id TEXT PRIMARY KEY,
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ai_threads_paper_idx ON ai_threads(paper_id);

    CREATE TABLE IF NOT EXISTS ai_thread_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content_md TEXT NOT NULL,
      selection_ref_json TEXT,
      artifact_id TEXT REFERENCES ai_artifacts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ai_thread_messages_thread_idx
      ON ai_thread_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS paper_tags (
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (paper_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_collections (
      paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY (paper_id, collection_id)
    );

    CREATE TABLE IF NOT EXISTS reading_states (
      paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
      current_page INTEGER NOT NULL DEFAULT 1,
      zoom REAL NOT NULL DEFAULT 1,
      last_opened_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS paper_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      paper_id UNINDEXED,
      heading,
      content
    );
  `);

  ensureColumn(sqlite, "ai_profiles", "api_format", "TEXT NOT NULL DEFAULT 'responses'");
  ensureColumn(sqlite, "ai_profiles", "reasoning_effort", "TEXT");
  ensureColumn(sqlite, "ai_profiles", "streaming_enabled", "INTEGER NOT NULL DEFAULT 1");
  normalizeLegacyAiProfiles(sqlite);
}
