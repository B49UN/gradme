import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "server-only";

const APP_NAME = "GradMe";

function resolveBaseDir() {
  if (process.env.GRADME_DATA_DIR) {
    return process.env.GRADME_DATA_DIR;
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }

  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    APP_NAME,
  );
}

export const appPaths = {
  rootDir: resolveBaseDir(),
  dbPath: path.join(resolveBaseDir(), "library.db"),
  pdfDir: path.join(resolveBaseDir(), "pdfs"),
  thumbnailDir: path.join(resolveBaseDir(), "thumbnails"),
  artifactDir: path.join(resolveBaseDir(), "artifacts"),
};

export function ensureAppDirectories() {
  for (const directory of [
    appPaths.rootDir,
    appPaths.pdfDir,
    appPaths.thumbnailDir,
    appPaths.artifactDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}
