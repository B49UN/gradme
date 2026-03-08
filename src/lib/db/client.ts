import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import "server-only";
import { ensureAppDirectories, appPaths } from "@/lib/server/app-paths";
import { initializeDatabase } from "@/lib/db/init";
import { schema } from "@/lib/db/schema";

ensureAppDirectories();

const sqlite = new Database(appPaths.dbPath);
initializeDatabase(sqlite);

export const rawDb = sqlite;
export const db = drizzle(sqlite, { schema });

export function nowIso() {
  return new Date().toISOString();
}

export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJsonColumn(value: unknown) {
  return JSON.stringify(value);
}
