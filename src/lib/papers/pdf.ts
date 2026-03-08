import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "server-only";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { appPaths } from "@/lib/server/app-paths";
import { ExtractedPage } from "@/lib/papers/chunking";

const serverWorkerSrc = pathToFileURL(
  path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
).toString();
const standardFontDataUrl = `${pathToFileURL(
  path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts"),
).toString()}/`;

type PdfTextItem = {
  str: string;
  transform: number[];
  hasEOL?: boolean;
};

function installCanvasGlobals() {
  if (!("DOMMatrix" in globalThis)) {
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  }
}

async function loadServerPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = serverWorkerSrc;
  return pdfjs;
}

function groupItemsIntoText(items: PdfTextItem[]) {
  const lines: string[] = [];
  let currentLine = "";
  let lastY: number | null = null;

  for (const item of items) {
    const value = item.str ?? "";
    const y = Math.round(item.transform[5] ?? 0);

    if (lastY !== null && Math.abs(y - lastY) > 4) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    currentLine += value;

    if (item.hasEOL) {
      lines.push(currentLine.trim());
      currentLine = "";
    }

    lastY = y;
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.filter(Boolean).join("\n");
}

export async function extractPdf(buffer: Buffer) {
  installCanvasGlobals();
  const pdfjs = await loadServerPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
  });
  const document = await task.promise;
  const metadata = await document.getMetadata().catch(() => null);
  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items = textContent.items as PdfTextItem[];
    const text = groupItemsIntoText(items);
    pages.push({ pageNumber, text });
  }

  await document.destroy();

  return {
    pageCount: pages.length,
    pages,
    fullText: pages.map((page) => page.text).join("\n\n"),
    title:
      (metadata?.info as { Title?: string } | undefined)?.Title?.trim() || null,
  };
}

function fallbackThumbnailSvg(title: string) {
  const safeTitle = title.replace(/[<>&"]/g, " ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f5b66" />
        <stop offset="100%" stop-color="#c2642d" />
      </linearGradient>
    </defs>
    <rect width="420" height="560" rx="28" fill="#fff8ef" />
    <rect x="18" y="18" width="384" height="524" rx="24" fill="url(#g)" opacity="0.14" />
    <text x="40" y="92" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#17222f">GradMe Preview</text>
    <text x="40" y="146" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#17222f">${safeTitle.slice(0, 120)}</text>
    <text x="40" y="512" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#6e716f">Thumbnail fallback</text>
  </svg>`;
}

export async function generateThumbnail(buffer: Buffer, paperId: string, title: string) {
  installCanvasGlobals();

  try {
    const pdfjs = await loadServerPdfJs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      standardFontDataUrl,
    });
    const document = await task.promise;
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context as never,
      viewport,
      canvas,
    } as never).promise;

    await document.destroy();

    const pngPath = path.join(appPaths.thumbnailDir, `${paperId}.png`);
    await fs.writeFile(pngPath, canvas.toBuffer("image/png"));
    return pngPath;
  } catch {
    const svgPath = path.join(appPaths.thumbnailDir, `${paperId}.svg`);
    await fs.writeFile(svgPath, fallbackThumbnailSvg(title), "utf8");
    return svgPath;
  }
}
