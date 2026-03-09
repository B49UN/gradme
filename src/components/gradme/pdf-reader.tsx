"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  ListTree,
  LoaderCircle,
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, truncate } from "@/lib/utils";
import type { AnnotationRecord, PaperSelectionRef } from "@/lib/types";

const DEFAULT_ZOOM = 1.15;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2.25;
const BASE_VIEWPORT_SCALE = 1.34;
const MAX_CACHED_DOCUMENTS = 3;
const MAX_RENDERED_PAGES_PER_DOCUMENT = 6;

type PdfJsModule = typeof import("pdfjs-dist/build/pdf.mjs");
type OutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
type ReaderMode = "paged" | "continuous";

type TextItemView = {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  text: string;
};

type PageView = {
  pageNumber: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  renderedCanvas: HTMLCanvasElement;
  textItems: TextItemView[];
};

type ToolbarSelection = PaperSelectionRef & {
  anchorX: number;
  anchorY: number;
  previewDataUrl?: string | null;
};

type OutlineItemView = {
  id: string;
  title: string;
  depth: number;
  page: number | null;
  url: string | null;
};

type CachedPdfDocument = {
  task: PDFDocumentLoadingTask | null;
  loadedPromise: Promise<{ pdfjs: PdfJsModule; pdfDocument: PDFDocumentProxy }>;
  outlinePromise: Promise<OutlineItemView[]> | null;
  pageCache: Map<string, PageView>;
  pageRenderPromises: Map<string, Promise<PageView>>;
};

type DragState = {
  page: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PageFrameProps = {
  pageView: PageView;
  loadingBadge?: boolean;
  registerPageCanvas: (pageNumber: number, element: HTMLCanvasElement | null) => void;
  annotations: AnnotationRecord[];
  selectedAnnotationId: string | null;
  selection: ToolbarSelection | null;
  dragState: DragState | null;
  onCaptureStart: (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => void;
  onCaptureMove: (event: React.MouseEvent<HTMLDivElement>) => void;
  onCaptureEnd: (event: React.MouseEvent<HTMLDivElement>, pageNumber: number) => void;
  onCreateAnnotation: (payload: {
    type: "highlight" | "underline" | "area";
    page: number;
    rects: Array<{ left: number; top: number; width: number; height: number }>;
    color: string;
    selectedText?: string | null;
    selectionRef?: PaperSelectionRef | null;
  }) => void;
  onCreateSelectionNote: (selection: ToolbarSelection) => void;
  onSendSelectionToAi: (selection: ToolbarSelection) => void;
  clearSelection: () => void;
};

type ContinuousPdfPageProps = Omit<
  PageFrameProps,
  "pageView" | "loadingBadge" | "annotations"
> & {
  pdfUrl: string;
  pageNumber: number;
  zoom: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  registerPageElement: (pageNumber: number, element: HTMLDivElement | null) => void;
  annotations: AnnotationRecord[];
  onVisiblePage: (pageNumber: number) => void;
  initiallyVisible: boolean;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
const cachedPdfDocuments = new Map<string, CachedPdfDocument>();

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/webpack.mjs").then(
      (module) => module as unknown as PdfJsModule,
    );
  }

  return pdfJsModulePromise;
}

function touchCacheEntry<T>(cache: Map<string, T>, key: string) {
  const value = cache.get(key);

  if (!value) {
    return null;
  }

  cache.delete(key);
  cache.set(key, value);
  return value;
}

function disposeRenderedPage(page: PageView) {
  page.renderedCanvas.width = 0;
  page.renderedCanvas.height = 0;
}

function disposeCachedDocument(entry: CachedPdfDocument) {
  for (const cachedPage of entry.pageCache.values()) {
    disposeRenderedPage(cachedPage);
  }

  entry.pageCache.clear();
  entry.pageRenderPromises.clear();

  if (entry.task) {
    void entry.task.destroy().catch(() => undefined);
  }
}

function trimDocumentCache() {
  while (cachedPdfDocuments.size > MAX_CACHED_DOCUMENTS) {
    const oldest = cachedPdfDocuments.entries().next().value as
      | [string, CachedPdfDocument]
      | undefined;

    if (!oldest) {
      break;
    }

    cachedPdfDocuments.delete(oldest[0]);
    disposeCachedDocument(oldest[1]);
  }
}

function trimRenderedPageCache(entry: CachedPdfDocument) {
  while (entry.pageCache.size > MAX_RENDERED_PAGES_PER_DOCUMENT) {
    const oldest = entry.pageCache.entries().next().value as [string, PageView] | undefined;

    if (!oldest) {
      break;
    }

    entry.pageCache.delete(oldest[0]);
    disposeRenderedPage(oldest[1]);
  }
}

function getPageCacheKey(pageNumber: number, zoom: number) {
  return `${pageNumber}:${zoom.toFixed(2)}`;
}

function getOutputScale() {
  return Math.max(1.5, Math.min(window.devicePixelRatio || 1, 2));
}

function getCachedPdfDocument(url: string) {
  const existing = touchCacheEntry(cachedPdfDocuments, url);

  if (existing) {
    return existing;
  }

  const entry: CachedPdfDocument = {
    task: null,
    loadedPromise: loadPdfJsModule().then(async (pdfjs) => {
      const task = pdfjs.getDocument({
        url,
        isEvalSupported: false,
      } as never);
      entry.task = task;
      const pdfDocument = await task.promise;
      return { pdfjs, pdfDocument };
    }),
    outlinePromise: null,
    pageCache: new Map(),
    pageRenderPromises: new Map(),
  };

  cachedPdfDocuments.set(url, entry);
  trimDocumentCache();

  return entry;
}

async function resolveDestinationPage(
  pdfDocument: PDFDocumentProxy,
  dest: OutlineNode["dest"],
): Promise<number | null> {
  if (!dest) {
    return null;
  }

  const resolvedDest = typeof dest === "string" ? await pdfDocument.getDestination(dest) : dest;

  if (!resolvedDest || resolvedDest.length === 0) {
    return null;
  }

  const target = resolvedDest[0];

  if (typeof target === "number") {
    return target + 1;
  }

  if (!target || typeof target !== "object") {
    return null;
  }

  try {
    return (await pdfDocument.getPageIndex(target as never)) + 1;
  } catch {
    return null;
  }
}

async function buildOutlineItems(
  pdfDocument: PDFDocumentProxy,
  nodes: OutlineNode[],
  depth = 0,
  parentId = "outline",
): Promise<OutlineItemView[]> {
  const items: OutlineItemView[] = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const nodeId = `${parentId}-${index}`;

    items.push({
      id: nodeId,
      title: node.title.trim() || `섹션 ${index + 1}`,
      depth,
      page: await resolveDestinationPage(pdfDocument, node.dest),
      url: node.url,
    });

    if (node.items.length > 0) {
      items.push(...(await buildOutlineItems(pdfDocument, node.items, depth + 1, nodeId)));
    }
  }

  return items;
}

async function getDocumentInfo(url: string) {
  const entry = getCachedPdfDocument(url);
  const { pdfDocument } = await entry.loadedPromise;

  if (!entry.outlinePromise) {
    entry.outlinePromise = pdfDocument
      .getOutline()
      .then((outline) => (outline?.length ? buildOutlineItems(pdfDocument, outline) : []))
      .catch(() => []);
  }

  return {
    pageCount: pdfDocument.numPages,
    outline: await entry.outlinePromise,
  };
}

async function renderPage(url: string, pageNumber: number, zoom: number) {
  const entry = getCachedPdfDocument(url);
  const cacheKey = getPageCacheKey(pageNumber, zoom);
  const cachedPage = touchCacheEntry(entry.pageCache, cacheKey);

  if (cachedPage) {
    return cachedPage;
  }

  const pendingRender = entry.pageRenderPromises.get(cacheKey);

  if (pendingRender) {
    return pendingRender;
  }

  const renderPromise = entry.loadedPromise
    .then(async ({ pdfjs, pdfDocument }) => {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: BASE_VIEWPORT_SCALE * zoom });
      const outputScale = getOutputScale();
      const renderedCanvas = window.document.createElement("canvas");
      const context = renderedCanvas.getContext("2d", { alpha: false });

      if (!context) {
        throw new Error("PDF 캔버스 컨텍스트를 만들지 못했습니다.");
      }

      renderedCanvas.width = Math.ceil(viewport.width * outputScale);
      renderedCanvas.height = Math.ceil(viewport.height * outputScale);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";

      await page.render({
        canvasContext: context as never,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      } as never).promise;

      const textContent = await page.getTextContent();
      const textItems = (textContent.items as Array<{
        str: string;
        transform: number[];
        width: number;
        height: number;
      }>).map((item) => {
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.hypot(tx[2], tx[3]);
        const width = item.width * viewport.scale;
        const height = Math.max(item.height * viewport.scale, fontSize);

        return {
          left: tx[4],
          top: tx[5] - height,
          width,
          height,
          fontSize: Math.max(fontSize, 10),
          text: item.str,
        };
      });

      page.cleanup();

      const renderedPage: PageView = {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        pixelWidth: renderedCanvas.width,
        pixelHeight: renderedCanvas.height,
        renderedCanvas,
        textItems,
      };

      entry.pageCache.set(cacheKey, renderedPage);
      trimRenderedPageCache(entry);

      return renderedPage;
    })
    .finally(() => {
      entry.pageRenderPromises.delete(cacheKey);
    });

  entry.pageRenderPromises.set(cacheKey, renderPromise);
  return renderPromise;
}

function paintPageOnCanvas(canvas: HTMLCanvasElement | null, pageView: PageView) {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  canvas.width = pageView.pixelWidth;
  canvas.height = pageView.pixelHeight;
  canvas.style.width = `${pageView.width}px`;
  canvas.style.height = `${pageView.height}px`;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(pageView.renderedCanvas, 0, 0, canvas.width, canvas.height);
}

function annotationLabel(type: AnnotationRecord["type"]) {
  switch (type) {
    case "highlight":
      return "하이라이트";
    case "underline":
      return "밑줄";
    case "area":
      return "영역";
    case "note-link":
      return "메모";
    default:
      return "주석";
  }
}

function annotationPreview(annotation: AnnotationRecord) {
  if (annotation.selectedText?.trim()) {
    return truncate(annotation.selectedText.trim(), 90);
  }

  if (annotation.type === "area") {
    return "영역 캡처 주석";
  }

  if (annotation.type === "note-link") {
    return "선택 영역 메모 연결";
  }

  return "선택 텍스트가 없는 주석";
}

function SelectionToolbar({
  selection,
  onCreateAnnotation,
  onCreateSelectionNote,
  onSendSelectionToAi,
  clearSelection,
}: {
  selection: ToolbarSelection;
  onCreateAnnotation: PageFrameProps["onCreateAnnotation"];
  onCreateSelectionNote: (selection: ToolbarSelection) => void;
  onSendSelectionToAi: (selection: ToolbarSelection) => void;
  clearSelection: () => void;
}) {
  return (
    <div
      className="selection-toolbar absolute z-20 flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[#132228] px-3 py-2 text-white"
      style={{
        left: selection.anchorX,
        top: selection.anchorY,
        transform: "translateX(-50%)",
      }}
    >
      <Button
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl px-2 text-white hover:bg-white/10"
        onClick={() => {
          onCreateAnnotation({
            type: selection.type === "area" ? "area" : "highlight",
            page: selection.page,
            rects: selection.rects,
            color:
              selection.type === "area"
                ? "rgba(194,100,45,0.9)"
                : "rgba(255,211,83,0.28)",
            selectedText:
              selection.type === "text" ? selection.selectedText : selection.selectedText ?? null,
            selectionRef: selection,
          });
          clearSelection();
        }}
      >
        <Highlighter className="h-4 w-4" />
        표시
      </Button>
      {selection.type === "text" ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-xl px-2 text-white hover:bg-white/10"
          onClick={() => {
            onCreateAnnotation({
              type: "underline",
              page: selection.page,
              rects: selection.rects,
              color: "rgba(56,126,223,0.92)",
              selectedText: selection.selectedText,
              selectionRef: selection,
            });
            clearSelection();
          }}
        >
          밑줄
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl px-2 text-white hover:bg-white/10"
        onClick={() => {
          onCreateSelectionNote(selection);
          clearSelection();
        }}
      >
        <MessageSquarePlus className="h-4 w-4" />
        메모
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 rounded-xl px-2 text-white hover:bg-white/10"
        onClick={() => {
          onSendSelectionToAi(selection);
          clearSelection();
        }}
      >
        <Sparkles className="h-4 w-4" />
        AI
      </Button>
    </div>
  );
}

function PageFrame({
  pageView,
  loadingBadge = false,
  registerPageCanvas,
  annotations,
  selectedAnnotationId,
  selection,
  dragState,
  onCaptureStart,
  onCaptureMove,
  onCaptureEnd,
  onCreateAnnotation,
  onCreateSelectionNote,
  onSendSelectionToAi,
  clearSelection,
}: PageFrameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    paintPageOnCanvas(canvasRef.current, pageView);
  }, [pageView]);

  return (
    <div
      className="relative mx-auto rounded-[26px] bg-white shadow-[0_20px_60px_rgba(23,34,47,0.08)]"
      style={{
        width: pageView.width,
        minHeight: pageView.height,
      }}
      data-page-number={pageView.pageNumber}
      onMouseDown={(event) => onCaptureStart(event, pageView.pageNumber)}
      onMouseMove={onCaptureMove}
      onMouseUp={(event) => onCaptureEnd(event, pageView.pageNumber)}
    >
      <canvas
        ref={(element) => {
          canvasRef.current = element;
          registerPageCanvas(pageView.pageNumber, element);
        }}
        className="block rounded-[26px]"
        style={{ width: pageView.width, height: pageView.height }}
      />
      <div className="text-layer absolute inset-0 rounded-[26px]">
        {pageView.textItems.map((item, index) => (
          <span
            key={`${pageView.pageNumber}-${index}`}
            style={{
              left: item.left,
              top: item.top,
              fontSize: `${item.fontSize}px`,
              width: item.width,
              height: item.height,
            }}
          >
            {item.text}
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {annotations.map((annotation) =>
          annotation.rects.map((rect, index) => (
            <div
              key={`${annotation.id}-${index}`}
              className={cn("absolute transition-shadow", {
                "annotation-highlight": annotation.type === "highlight",
                "annotation-underline": annotation.type === "underline",
                "annotation-area": annotation.type === "area",
                "annotation-note-link": annotation.type === "note-link",
                "shadow-[0_0_0_2px_rgba(15,91,102,0.55)]":
                  selectedAnnotationId === annotation.id,
              })}
              style={{
                left: `${rect.left * 100}%`,
                top: `${rect.top * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
                backgroundColor:
                  annotation.type === "highlight" ? annotation.color : undefined,
                borderBottomColor:
                  annotation.type === "underline" ? annotation.color : undefined,
                borderColor:
                  annotation.type === "area" || annotation.type === "note-link"
                    ? annotation.color
                    : undefined,
              }}
            />
          )),
        )}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {dragState && dragState.page === pageView.pageNumber ? (
          <div
            className="annotation-area absolute"
            style={{
              left: `${Math.min(dragState.startX, dragState.currentX)}px`,
              top: `${Math.min(dragState.startY, dragState.currentY)}px`,
              width: `${Math.abs(dragState.currentX - dragState.startX)}px`,
              height: `${Math.abs(dragState.currentY - dragState.startY)}px`,
            }}
          />
        ) : null}
      </div>
      {selection && selection.page === pageView.pageNumber ? (
        <SelectionToolbar
          selection={selection}
          onCreateAnnotation={onCreateAnnotation}
          onCreateSelectionNote={onCreateSelectionNote}
          onSendSelectionToAi={onSendSelectionToAi}
          clearSelection={clearSelection}
        />
      ) : null}
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/88 px-3 py-1 text-xs font-semibold text-[var(--muted)]">
        <span>p.{pageView.pageNumber}</span>
        {loadingBadge ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
      </div>
    </div>
  );
}

function ContinuousPdfPage({
  pdfUrl,
  pageNumber,
  zoom,
  viewportRef,
  registerPageCanvas,
  registerPageElement,
  annotations,
  selectedAnnotationId,
  selection,
  dragState,
  onCaptureStart,
  onCaptureMove,
  onCaptureEnd,
  onCreateAnnotation,
  onCreateSelectionNote,
  onSendSelectionToAi,
  clearSelection,
  onVisiblePage,
  initiallyVisible,
}: ContinuousPdfPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(initiallyVisible);
  const [pageView, setPageView] = useState<PageView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequested = shouldLoad || initiallyVisible;

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoad(true);
          }

          if (entry.intersectionRatio >= 0.55) {
            onVisiblePage(pageNumber);
          }
        }
      },
      {
        root: viewportRef.current,
        rootMargin: "420px 0px",
        threshold: [0.01, 0.55],
      },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [onVisiblePage, pageNumber, viewportRef]);

  useEffect(() => {
    if (!loadRequested) {
      return;
    }

    let cancelled = false;

    void renderPage(pdfUrl, pageNumber, zoom)
      .then((view) => {
        if (!cancelled) {
          setPageView(view);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "페이지 렌더 실패");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadRequested, pageNumber, pdfUrl, zoom]);

  return (
    <div
      ref={(element) => {
        containerRef.current = element;
        registerPageElement(pageNumber, element);
      }}
      className="mx-auto w-full"
    >
      {pageView ? (
        <PageFrame
          pageView={pageView}
          loadingBadge={false}
          registerPageCanvas={registerPageCanvas}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          selection={selection}
          dragState={dragState}
          onCaptureStart={onCaptureStart}
          onCaptureMove={onCaptureMove}
          onCaptureEnd={onCaptureEnd}
          onCreateAnnotation={onCreateAnnotation}
          onCreateSelectionNote={onCreateSelectionNote}
          onSendSelectionToAi={onSendSelectionToAi}
          clearSelection={clearSelection}
        />
      ) : (
        <div className="mx-auto flex min-h-[720px] max-w-[880px] items-center justify-center rounded-[26px] border border-dashed border-[var(--line)] bg-white/60 text-sm text-[var(--muted)]">
          {loadError
            ? loadError
            : loadRequested
              ? `p.${pageNumber} 렌더링 중...`
              : `p.${pageNumber} 대기 중...`}
        </div>
      )}
    </div>
  );
}

export function PdfReader({
  paperId,
  pdfUrl,
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  onSendSelectionToAi,
  onCreateSelectionNote,
  requestedPage,
  onPageChange,
}: {
  paperId: string;
  pdfUrl: string;
  annotations: AnnotationRecord[];
  onCreateAnnotation: (payload: {
    type: "highlight" | "underline" | "area";
    page: number;
    rects: Array<{ left: number; top: number; width: number; height: number }>;
    color: string;
    selectedText?: string | null;
    selectionRef?: PaperSelectionRef | null;
  }) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onSendSelectionToAi: (selection: ToolbarSelection) => void;
  onCreateSelectionNote: (selection: ToolbarSelection) => void;
  requestedPage?: number | null;
  onPageChange?: (page: number) => void;
}) {
  const [pageCount, setPageCount] = useState(0);
  const [outlineItems, setOutlineItems] = useState<OutlineItemView[]>([]);
  const [currentPageViewState, setCurrentPageViewState] = useState<PageView | null>(null);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<ToolbarSelection | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageJumpValue, setPageJumpValue] = useState("1");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [readerMode, setReaderMode] = useState<ReaderMode>("paged");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const pageCanvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pageElementRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);

  function registerPageCanvas(pageNumber: number, element: HTMLCanvasElement | null) {
    pageCanvasRefs.current[pageNumber] = element;
  }

  function registerPageElement(pageNumber: number, element: HTMLDivElement | null) {
    pageElementRefs.current[pageNumber] = element;
  }

  const currentPageView =
    readerMode === "paged" && currentPageViewState?.pageNumber === currentPage
      ? currentPageViewState
      : null;

  const annotationMap = useMemo(() => {
    return annotations.reduce<Record<number, AnnotationRecord[]>>((accumulator, annotation) => {
      if (!accumulator[annotation.page]) {
        accumulator[annotation.page] = [];
      }

      accumulator[annotation.page].push(annotation);
      return accumulator;
    }, {});
  }, [annotations]);

  const currentPageAnnotations = annotationMap[currentPage] ?? [];
  const sidebarVisible = outlineItems.length > 0 || annotations.length > 0;

  function clearSelection() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function movePage(nextPage: number) {
    const clampedPage = Math.min(Math.max(nextPage, 1), Math.max(pageCount, 1));
    setCurrentPage(clampedPage);
    setPageJumpValue(String(clampedPage));
    clearSelection();
    setCaptureMode(false);
    setSelectedAnnotationId(null);

    if (readerMode === "continuous") {
      pageElementRefs.current[clampedPage]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      return;
    }

    viewportRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  }

  function updateZoom(nextZoom: number) {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(nextZoom.toFixed(2)))));
    clearSelection();
  }

  function handlePageJumpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPage = Number.parseInt(pageJumpValue, 10);

    if (!Number.isFinite(nextPage)) {
      setPageJumpValue(String(currentPage));
      return;
    }

    movePage(nextPage);
  }

  function handleCaptureStart(event: React.MouseEvent<HTMLDivElement>, pageNumber: number) {
    if (!captureMode) {
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    setDragState({
      page: pageNumber,
      startX: event.clientX - box.left,
      startY: event.clientY - box.top,
      currentX: event.clientX - box.left,
      currentY: event.clientY - box.top,
    });
  }

  function handleCaptureMove(event: React.MouseEvent<HTMLDivElement>) {
    if (!dragState) {
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    setDragState({
      ...dragState,
      currentX: event.clientX - box.left,
      currentY: event.clientY - box.top,
    });
  }

  function handleCaptureEnd(event: React.MouseEvent<HTMLDivElement>, pageNumber: number) {
    if (!dragState || dragState.page !== pageNumber) {
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    const left = Math.min(dragState.startX, dragState.currentX);
    const top = Math.min(dragState.startY, dragState.currentY);
    const width = Math.abs(dragState.currentX - dragState.startX);
    const height = Math.abs(dragState.currentY - dragState.startY);

    setDragState(null);

    if (width < 12 || height < 12) {
      return;
    }

    const pageCanvas = pageCanvasRefs.current[pageNumber];
    let previewDataUrl: string | null = null;

    if (pageCanvas) {
      const tempCanvas = document.createElement("canvas");
      const tempContext = tempCanvas.getContext("2d");

      if (tempContext) {
        const scaleX = pageCanvas.width / box.width;
        const scaleY = pageCanvas.height / box.height;
        tempCanvas.width = Math.max(1, Math.round(width * scaleX));
        tempCanvas.height = Math.max(1, Math.round(height * scaleY));
        tempContext.drawImage(
          pageCanvas,
          left * scaleX,
          top * scaleY,
          width * scaleX,
          height * scaleY,
          0,
          0,
          tempCanvas.width,
          tempCanvas.height,
        );
        previewDataUrl = tempCanvas.toDataURL("image/png");
      }
    }

    const normalizedRect = {
      left: left / box.width,
      top: top / box.height,
      width: width / box.width,
      height: height / box.height,
    };

    setSelection({
      type: "area",
      page: pageNumber,
      rects: [normalizedRect],
      imagePath: null,
      previewDataUrl,
      anchorX: left + width / 2,
      anchorY: Math.max(top - 56, 16),
    });
  }

  useEffect(() => {
    let cancelled = false;

    setLoadingDocument(true);
    setLoadError(null);
    setOutlineItems([]);
    setPageCount(0);
    setCurrentPageViewState(null);

    void getDocumentInfo(pdfUrl)
      .then((info) => {
        if (cancelled) {
          return;
        }

        setPageCount(info.pageCount);
        setOutlineItems(info.outline);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "PDF 정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingDocument(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    setCurrentPage(1);
    setPageJumpValue("1");
    setZoom(DEFAULT_ZOOM);
    setCaptureMode(false);
    setSelectedAnnotationId(null);
    clearSelection();
  }, [paperId]);

  useEffect(() => {
    if (pageCount === 0) {
      return;
    }

    setCurrentPage((page) => Math.min(Math.max(page, 1), pageCount));
  }, [pageCount]);

  useEffect(() => {
    setPageJumpValue(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  useEffect(() => {
    if (selectedAnnotationId && !annotations.some((annotation) => annotation.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [annotations, selectedAnnotationId]);

  useEffect(() => {
    setSelectedAnnotationId(null);
  }, [currentPage]);

  useEffect(() => {
    if (!requestedPage || pageCount === 0 || requestedPage === currentPage) {
      return;
    }

    const clampedPage = Math.min(Math.max(requestedPage, 1), Math.max(pageCount, 1));
    setCurrentPage(clampedPage);
    setPageJumpValue(String(clampedPage));
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setCaptureMode(false);
    setSelectedAnnotationId(null);

    if (readerMode === "continuous") {
      pageElementRefs.current[clampedPage]?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      return;
    }

    viewportRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  }, [currentPage, pageCount, readerMode, requestedPage]);

  useEffect(() => {
    if (readerMode !== "paged" || pageCount === 0) {
      return;
    }

    let cancelled = false;
    setLoadingPage(true);
    setLoadError(null);

    void renderPage(pdfUrl, currentPage, zoom)
      .then((pageView) => {
        if (!cancelled) {
          setCurrentPageViewState(pageView);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "PDF 페이지를 렌더링하지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingPage(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPage, pageCount, pdfUrl, readerMode, zoom]);

  useEffect(() => {
    if (captureMode) {
      return;
    }

    const handleMouseUp = () => {
      const browserSelection = window.getSelection();

      if (!browserSelection || browserSelection.isCollapsed || !browserSelection.rangeCount) {
        return;
      }

      const range = browserSelection.getRangeAt(0);
      const anchorNode = range.commonAncestorContainer;
      const pageElement =
        anchorNode instanceof Element
          ? anchorNode.closest<HTMLElement>("[data-page-number]")
          : anchorNode.parentElement?.closest<HTMLElement>("[data-page-number]");

      if (!pageElement) {
        return;
      }

      const page = Number(pageElement.dataset.pageNumber);
      const box = pageElement.getBoundingClientRect();
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 1 && rect.height > 1)
        .map((rect) => ({
          left: (rect.left - box.left) / box.width,
          top: (rect.top - box.top) / box.height,
          width: rect.width / box.width,
          height: rect.height / box.height,
        }));

      if (rects.length === 0) {
        return;
      }

      setSelection({
        type: "text",
        page,
        rects,
        selectedText: browserSelection.toString().trim(),
        anchorX: Math.min(Math.max(range.getBoundingClientRect().left - box.left, 24), box.width - 80),
        anchorY: Math.max(range.getBoundingClientRect().top - box.top - 56, 16),
      });
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [captureMode]);

  useEffect(() => {
    if (readerMode !== "paged" || pageCount <= 1) {
      return;
    }

    const pagesToPrefetch = [currentPage - 1, currentPage + 1].filter(
      (page) => page >= 1 && page <= pageCount,
    );

    for (const pageNumber of pagesToPrefetch) {
      void renderPage(pdfUrl, pageNumber, zoom).catch(() => undefined);
    }
  }, [currentPage, pageCount, pdfUrl, readerMode, zoom]);

  const pageModeLabel =
    readerMode === "paged" ? "단일 페이지 · 빠른 페이지 전환" : "세로 스크롤 · 연속 읽기";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[30px] border border-[var(--line)] bg-white/55">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 lg:px-5 lg:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>PDF Reader</Badge>
          <Badge className="bg-transparent">
            {currentPage}/{Math.max(pageCount, 1)} page
          </Badge>
          <Badge className="bg-transparent">{Math.round(zoom * 100)}%</Badge>
          {outlineItems.length > 0 ? (
            <Badge className="bg-transparent">
              <ListTree className="h-3.5 w-3.5" />
              outline
            </Badge>
          ) : null}
          <p className="text-sm text-[var(--muted)]">{pageModeLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-2xl border border-[var(--line)] bg-white/80 p-1">
            <Button
              variant={readerMode === "paged" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 rounded-xl px-3"
              onClick={() => {
                setReaderMode("paged");
                clearSelection();
                viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
              }}
            >
              페이지
            </Button>
            <Button
              variant={readerMode === "continuous" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 rounded-xl px-3"
              onClick={() => {
                setReaderMode("continuous");
                clearSelection();
                window.requestAnimationFrame(() => {
                  pageElementRefs.current[currentPage]?.scrollIntoView({
                    block: "start",
                    behavior: "smooth",
                  });
                });
              }}
            >
              세로
            </Button>
          </div>
          <div className="flex items-center gap-1 rounded-2xl border border-[var(--line)] bg-white/80 p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-xl p-0"
              disabled={currentPage <= 1}
              onClick={() => movePage(currentPage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-xl p-0"
              disabled={pageCount === 0 || currentPage >= pageCount}
              onClick={() => movePage(currentPage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <form
            className="flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-white/80 p-1 pl-3"
            onSubmit={handlePageJumpSubmit}
          >
            <span className="text-xs text-[var(--muted)]">p.</span>
            <Input
              value={pageJumpValue}
              onChange={(event) => setPageJumpValue(event.target.value.replace(/[^\d]/g, ""))}
              className="h-8 w-20 border-0 bg-transparent px-0 py-0 text-center shadow-none focus:ring-0"
              inputMode="numeric"
              aria-label="페이지 번호"
            />
            <Button size="sm" variant="ghost" className="h-8 rounded-xl px-3" type="submit">
              이동
            </Button>
          </form>
          <div className="flex items-center gap-1 rounded-2xl border border-[var(--line)] bg-white/80 p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-xl p-0"
              onClick={() => updateZoom(zoom - 0.1)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-xl px-3"
              onClick={() => updateZoom(DEFAULT_ZOOM)}
            >
              <RotateCcw className="h-4 w-4" />
              기본
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-xl p-0"
              onClick={() => updateZoom(zoom + 0.1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button
            variant={captureMode ? "secondary" : "outline"}
            onClick={() => {
              setCaptureMode((current) => !current);
              clearSelection();
            }}
          >
            <SquareDashedMousePointer className="h-4 w-4" />
            {captureMode ? "캡처 종료" : "영역 캡처"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {sidebarVisible ? (
          <aside className="flex shrink-0 flex-col gap-4 border-b border-[var(--line)] bg-[rgba(255,252,247,0.72)] p-4 lg:w-[292px] lg:min-h-0 lg:border-b-0 lg:border-r lg:overflow-hidden">
            <div className="flex min-h-0 flex-col lg:flex-1">
              <div className="mb-3 flex items-center gap-2">
                <ListTree className="h-4 w-4 text-[var(--accent-strong)]" />
                <p className="font-semibold">개요</p>
              </div>
              <div className="paper-scroll min-h-[140px] space-y-1 overflow-auto pr-1 lg:min-h-0 lg:flex-1">
                {outlineItems.length > 0 ? (
                  outlineItems.map((item) => {
                    const destinationPage = item.page;

                    return destinationPage !== null ? (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2 text-left text-sm transition hover:bg-black/5",
                          currentPage === destinationPage && "bg-[rgba(15,91,102,0.08)]",
                        )}
                        style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                        onClick={() => movePage(destinationPage)}
                      >
                        <span className="min-w-0 truncate">{item.title}</span>
                        <span className="shrink-0 text-xs text-[var(--muted)]">p.{destinationPage}</span>
                      </button>
                    ) : (
                      <div
                        key={item.id}
                        className="rounded-2xl px-3 py-2 text-sm text-[var(--muted)]"
                        style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                      >
                        {item.title}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-6 text-sm text-[var(--muted)]">
                    이 PDF에는 탐색 가능한 개요가 없습니다.
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col lg:flex-1">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">현재 페이지 주석</p>
                  <p className="text-xs text-[var(--muted)]">삭제할 주석을 바로 선택할 수 있습니다.</p>
                </div>
                <Badge className="bg-transparent">{currentPageAnnotations.length}</Badge>
              </div>
              <div className="paper-scroll min-h-[140px] space-y-2 overflow-auto pr-1 lg:min-h-0 lg:flex-1">
                {currentPageAnnotations.length > 0 ? (
                  currentPageAnnotations.map((annotation) => (
                    <div
                      key={annotation.id}
                      className={cn(
                        "rounded-[20px] border px-3 py-3 transition",
                        selectedAnnotationId === annotation.id
                          ? "border-[var(--accent-strong)] bg-[rgba(15,91,102,0.08)]"
                          : "border-[var(--line)] bg-white/70",
                      )}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() =>
                          setSelectedAnnotationId((current) =>
                            current === annotation.id ? null : annotation.id,
                          )
                        }
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{annotationLabel(annotation.type)}</span>
                          <span className="text-xs text-[var(--muted)]">p.{annotation.page}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                          {annotationPreview(annotation)}
                        </p>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 h-8 rounded-xl px-2 text-[#a43a2c] hover:bg-[rgba(164,58,44,0.08)]"
                        onClick={() => {
                          setSelectedAnnotationId(null);
                          onDeleteAnnotation(annotation.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                        삭제
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-6 text-sm text-[var(--muted)]">
                    이 페이지에는 저장된 주석이 없습니다.
                  </div>
                )}
              </div>
            </div>
          </aside>
        ) : null}

        <div ref={viewportRef} className="paper-scroll flex-1 overflow-auto px-3 py-3 lg:px-4 lg:py-4">
          <div className="mx-auto flex w-full flex-col gap-4">
            {loadError ? (
              <div className="rounded-[24px] border border-dashed border-[#a43a2c]/30 bg-[#fff4f1] p-10 text-center text-sm text-[#8d2619]">
                {loadError}
              </div>
            ) : null}

            {!loadError && readerMode === "paged" && !currentPageView ? (
              <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/60 p-10 text-center text-sm text-[var(--muted)]">
                <LoaderCircle className="mx-auto mb-3 h-5 w-5 animate-spin" />
                PDF를 렌더링하는 중입니다...
              </div>
            ) : null}

            {readerMode === "paged" && currentPageView ? (
              <PageFrame
                pageView={currentPageView}
                loadingBadge={loadingDocument || loadingPage}
                registerPageCanvas={registerPageCanvas}
                annotations={currentPageAnnotations}
                selectedAnnotationId={selectedAnnotationId}
                selection={selection}
                dragState={dragState}
                onCaptureStart={handleCaptureStart}
                onCaptureMove={handleCaptureMove}
                onCaptureEnd={handleCaptureEnd}
                onCreateAnnotation={onCreateAnnotation}
                onCreateSelectionNote={onCreateSelectionNote}
                onSendSelectionToAi={onSendSelectionToAi}
                clearSelection={clearSelection}
              />
            ) : null}

            {readerMode === "continuous" && pageCount > 0 ? (
              Array.from({ length: pageCount }, (_, index) => {
                const pageNumber = index + 1;

                return (
                  <ContinuousPdfPage
                    key={`${paperId}-${pageNumber}-${zoom.toFixed(2)}`}
                    pdfUrl={pdfUrl}
                    pageNumber={pageNumber}
                    zoom={zoom}
                    viewportRef={viewportRef}
                    registerPageCanvas={registerPageCanvas}
                    registerPageElement={registerPageElement}
                    annotations={annotationMap[pageNumber] ?? []}
                    selectedAnnotationId={selectedAnnotationId}
                    selection={selection}
                    dragState={dragState}
                    onCaptureStart={handleCaptureStart}
                    onCaptureMove={handleCaptureMove}
                    onCaptureEnd={handleCaptureEnd}
                    onCreateAnnotation={onCreateAnnotation}
                    onCreateSelectionNote={onCreateSelectionNote}
                    onSendSelectionToAi={onSendSelectionToAi}
                    clearSelection={clearSelection}
                    onVisiblePage={(visiblePage) => setCurrentPage((page) => (page === visiblePage ? page : visiblePage))}
                    initiallyVisible={pageNumber <= 2 || Math.abs(pageNumber - currentPage) <= 1}
                  />
                );
              })
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
