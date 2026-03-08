"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Highlighter,
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  SquareDashedMousePointer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnnotationRecord, PaperSelectionRef } from "@/lib/types";

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
  canvasDataUrl: string;
  textItems: TextItemView[];
};

type ToolbarSelection = PaperSelectionRef & {
  anchorX: number;
  anchorY: number;
  previewDataUrl?: string | null;
};

async function loadPdfDocument(url: string) {
  const pdfjs =
    (await import("pdfjs-dist/webpack.mjs")) as unknown as typeof import("pdfjs-dist/build/pdf.mjs");
  const task = pdfjs.getDocument({
    url,
    isEvalSupported: false,
  } as never);
  const document = await task.promise;
  return { pdfjs, document };
}

export function PdfReader({
  paperId,
  pdfUrl,
  annotations,
  onCreateAnnotation,
  onSendSelectionToAi,
  onCreateSelectionNote,
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
  onSendSelectionToAi: (selection: ToolbarSelection) => void;
  onCreateSelectionNote: (selection: ToolbarSelection) => void;
}) {
  const [pages, setPages] = useState<PageView[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<ToolbarSelection | null>(null);
  const [captureMode, setCaptureMode] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.15);
  const [dragState, setDragState] = useState<{
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const pageCanvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const currentPageView = pages[currentPage - 1] ?? null;

  useEffect(() => {
    let disposed = false;

    const render = async () => {
      setLoading(true);
      setSelection(null);

      try {
        const { pdfjs, document: pdfDocument } = await loadPdfDocument(pdfUrl);
        const rendered: PageView[] = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.34 });
          const canvas = window.document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) {
            continue;
          }

          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: context as never, viewport, canvas } as never).promise;

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

          rendered.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
            canvasDataUrl: canvas.toDataURL("image/png"),
            textItems,
          });
        }

        await pdfDocument.destroy();

        if (!disposed) {
          setPages(rendered);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void render();

    return () => {
      disposed = true;
    };
  }, [paperId, pdfUrl]);

  useEffect(() => {
    setCurrentPage(1);
    setZoom(1.15);
    setCaptureMode(false);
    clearSelection();
  }, [paperId]);

  useEffect(() => {
    if (pages.length === 0) {
      return;
    }

    setCurrentPage((current) => Math.min(Math.max(current, 1), pages.length));
  }, [pages.length]);

  useEffect(() => {
    if (!currentPageView) {
      return;
    }

    const canvas = pageCanvasRefs.current[currentPageView.pageNumber];

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const image = new Image();
    image.onload = () => {
      canvas.width = Math.ceil(currentPageView.width);
      canvas.height = Math.ceil(currentPageView.height);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = currentPageView.canvasDataUrl;
  }, [currentPageView]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (captureMode) {
        return;
      }

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

  const annotationMap = useMemo(() => {
    return annotations.reduce<Record<number, AnnotationRecord[]>>((accumulator, annotation) => {
      if (!accumulator[annotation.page]) {
        accumulator[annotation.page] = [];
      }

      accumulator[annotation.page].push(annotation);
      return accumulator;
    }, {});
  }, [annotations]);

  function clearSelection() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function movePage(nextPage: number) {
    setCurrentPage(nextPage);
    clearSelection();
    setCaptureMode(false);
    viewportRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "smooth",
    });
  }

  function updateZoom(nextZoom: number) {
    setZoom(Math.min(2.25, Math.max(0.75, Number(nextZoom.toFixed(2)))));
    clearSelection();
  }

  function handleCaptureStart(
    event: React.MouseEvent<HTMLDivElement>,
    pageNumber: number,
  ) {
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

  function handleCaptureEnd(
    event: React.MouseEvent<HTMLDivElement>,
    pageNumber: number,
  ) {
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

  return (
    <div className="flex h-full min-h-[48vh] flex-col rounded-[30px] border border-[var(--line)] bg-white/55 xl:min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>PDF Reader</Badge>
          <Badge className="bg-transparent">
            {currentPage}/{Math.max(pages.length, 1)} page
          </Badge>
          <Badge className="bg-transparent">{Math.round(zoom * 100)}%</Badge>
          <p className="text-sm text-[var(--muted)]">
            단일 페이지 보기 · 텍스트 선택 · 하이라이트 · 영역 캡처
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              disabled={currentPage >= pages.length}
              onClick={() => movePage(currentPage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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
              onClick={() => updateZoom(1.15)}
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
      <div ref={viewportRef} className="paper-scroll flex-1 overflow-auto px-4 py-5">
        <div className="mx-auto w-full">
          {loading ? (
            <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/60 p-10 text-center text-sm text-[var(--muted)]">
              PDF를 렌더링하는 중입니다...
            </div>
          ) : null}
          {currentPageView ? (
            <div
              key={currentPageView.pageNumber}
              className="relative mx-auto rounded-[26px] bg-white shadow-[0_20px_60px_rgba(23,34,47,0.08)]"
              style={{
                width: currentPageView.width * zoom,
                minHeight: currentPageView.height * zoom,
              }}
              data-page-number={currentPageView.pageNumber}
              onMouseDown={(event) => handleCaptureStart(event, currentPageView.pageNumber)}
              onMouseMove={handleCaptureMove}
              onMouseUp={(event) => handleCaptureEnd(event, currentPageView.pageNumber)}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{
                  width: currentPageView.width,
                  height: currentPageView.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <canvas
                  ref={(element) => {
                    pageCanvasRefs.current[currentPageView.pageNumber] = element;
                  }}
                  className="block rounded-[26px]"
                  style={{ width: currentPageView.width, height: currentPageView.height }}
                />
                <div className="text-layer absolute inset-0 rounded-[26px]">
                  {currentPageView.textItems.map((item, index) => (
                    <span
                      key={`${currentPageView.pageNumber}-${index}`}
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
                  {(annotationMap[currentPageView.pageNumber] ?? []).map((annotation) =>
                    annotation.rects.map((rect, index) => (
                      <div
                        key={`${annotation.id}-${index}`}
                        className={cn("absolute", {
                          "annotation-highlight": annotation.type === "highlight",
                          "annotation-underline": annotation.type === "underline",
                          "annotation-area": annotation.type === "area",
                          "annotation-note-link": annotation.type === "note-link",
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
              </div>
              <div className="pointer-events-none absolute inset-0">
                {dragState && dragState.page === currentPageView.pageNumber ? (
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
              {selection && selection.page === currentPageView.pageNumber ? (
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
              ) : null}
              <div className="absolute left-4 top-4 rounded-full bg-white/88 px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                p.{currentPageView.pageNumber}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
