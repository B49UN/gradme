"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookCopy,
  BrainCircuit,
  FileUp,
  Globe,
  LoaderCircle,
  NotebookPen,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { MarkdownRenderer } from "@/components/gradme/markdown-renderer";
import { NoteEditor } from "@/components/gradme/note-editor";
import { PdfReader } from "@/components/gradme/pdf-reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, postJson } from "@/lib/client/api";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";
import { cn, formatAuthors, formatDateTime, truncate } from "@/lib/utils";
import type {
  AiApiFormat,
  AiArtifactRecord,
  AnnotationRecord,
  FocusKind,
  NoteRecord,
  PaperDetail,
  PaperSelectionRef,
  ReasoningEffort,
  WorkspaceSnapshot,
} from "@/lib/types";

type ProfileOption = {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: AiApiFormat;
  model: string;
  supportsVision: boolean;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort | null;
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
};

type SelectionDraft = PaperSelectionRef & {
  previewDataUrl?: string | null;
  anchorX?: number;
  anchorY?: number;
};

const EMPTY_PROFILES: ProfileOption[] = [];

function latestArtifact(
  artifacts: AiArtifactRecord[],
  kind: AiArtifactRecord["kind"],
  promptVersion?: string,
) {
  return artifacts.find(
    (artifact) =>
      artifact.kind === kind && (!promptVersion || artifact.promptVersion === promptVersion),
  );
}

function focusKindToArtifactKind(kind: FocusKind): AiArtifactRecord["kind"] {
  return ({
    methodology: "focus-methodology",
    "experimental-setup": "focus-experimental-setup",
    results: "focus-results",
    contribution: "focus-contribution",
    limitations: "focus-limitations",
  } as const)[kind];
}

function ImportDialog({
  onImportFile,
  onImportUrl,
  onImportIdentifier,
  importing,
}: {
  onImportFile: (file: File) => void;
  onImportUrl: (url: string) => void;
  onImportIdentifier: (identifier: string) => void;
  importing: boolean;
}) {
  const [url, setUrl] = useState("");
  const [identifier, setIdentifier] = useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <FileUp className="h-4 w-4" />
          논문 가져오기
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>논문 등록</DialogTitle>
          <DialogDescription>
            파일 업로드, PDF URL, DOI/arXiv 식별자를 모두 지원합니다.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="file" className="space-y-4">
          <TabsList>
            <TabsTrigger value="file">파일</TabsTrigger>
            <TabsTrigger value="url">PDF URL</TabsTrigger>
            <TabsTrigger value="id">DOI / arXiv</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--line)] bg-white/60 px-6 py-12 text-center">
              <FileUp className="mb-3 h-8 w-8 text-[var(--accent)]" />
              <span className="text-base font-medium">PDF 파일 업로드</span>
              <span className="mt-2 text-sm text-[var(--muted)]">
                drag & drop 대신 파일 선택 버튼으로 시작합니다.
              </span>
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onImportFile(file);
                  }
                }}
              />
            </label>
          </TabsContent>
          <TabsContent value="url" className="space-y-4">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
            />
            <Button
              className="w-full"
              disabled={importing || !url}
              onClick={() => onImportUrl(url)}
            >
              <Globe className="h-4 w-4" />
              URL에서 가져오기
            </Button>
          </TabsContent>
          <TabsContent value="id" className="space-y-4">
            <Input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="10.2514/1.J057395 또는 2401.01234"
            />
            <Button
              className="w-full"
              disabled={importing || !identifier}
              onClick={() => onImportIdentifier(identifier)}
            >
              <Search className="h-4 w-4" />
              식별자로 가져오기
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  profiles,
  activeProfileId,
  onSave,
  saving,
}: {
  onSave: (payload: {
    id?: string;
    name: string;
    baseUrl: string;
    apiFormat: AiApiFormat;
    model: string;
    apiKey: string;
    supportsVision: boolean;
    maxOutputTokens: number;
    reasoningEffort: ReasoningEffort | null;
  }) => void;
  profiles: ProfileOption[];
  activeProfileId: string;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState("new");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiFormat, setApiFormat] = useState<AiApiFormat>("responses");
  const [model, setModel] = useState("gpt-5.1");
  const [apiKey, setApiKey] = useState("");
  const [supportsVision, setSupportsVision] = useState(true);
  const [maxOutputTokens, setMaxOutputTokens] = useState("1600");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | "auto">("auto");

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editTarget) ?? null,
    [editTarget, profiles],
  );

  function loadProfile(profile: ProfileOption | null) {
    if (!profile) {
      setEditTarget("new");
      setName("");
      setBaseUrl("https://api.openai.com/v1");
      setApiFormat("responses");
      setModel("gpt-5.1");
      setApiKey("");
      setSupportsVision(true);
      setMaxOutputTokens("1600");
      setReasoningEffort("auto");
      return;
    }

    setEditTarget(profile.id);
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiFormat(profile.apiFormat);
    setModel(profile.model);
    setApiKey("");
    setSupportsVision(profile.supportsVision);
    setMaxOutputTokens(String(profile.maxOutputTokens));
    setReasoningEffort(profile.reasoningEffort ?? "auto");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          loadProfile(profiles.find((profile) => profile.id === activeProfileId) ?? null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Settings2 className="h-4 w-4" />
          모델 설정
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>모델 프로필 설정</DialogTitle>
          <DialogDescription>
            OpenAI 최신 기본값은 `Responses API`입니다. Base URL에는 `/responses`나
            `/chat/completions`를 붙이지 마세요.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>편집 대상</Label>
            <Select
              value={editTarget}
              onValueChange={(value) =>
                loadProfile(profiles.find((profile) => profile.id === value) ?? null)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">새 프로필</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name} · {profile.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>프로필 이름</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>모델명</Label>
            <Input value={model} onChange={(event) => setModel(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>API 형식</Label>
            <Select
              value={apiFormat}
              onValueChange={(value) => setApiFormat(value as AiApiFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="responses">Responses API</SelectItem>
                <SelectItem value="chat-completions">Chat Completions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>API Key</Label>
            <Input
              value={apiKey}
              type="password"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                editingProfile
                  ? editingProfile.hasApiKey
                    ? "변경하지 않으려면 비워두세요"
                    : "기존 프로필에 API 키가 없습니다"
                  : "sk-..."
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Max output tokens</Label>
            <Input
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              type="number"
              min="256"
              max="128000"
              step="64"
            />
          </div>
          <div className="space-y-2">
            <Label>Reasoning effort</Label>
            <Select
              value={reasoningEffort}
              onValueChange={(value) => setReasoningEffort(value as ReasoningEffort | "auto")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">자동</SelectItem>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 md:col-span-2">
            <div>
              <p className="font-medium">Vision 지원</p>
              <p className="text-sm text-[var(--muted)]">영역 캡처 질문에 필요합니다.</p>
            </div>
            <Switch checked={supportsVision} onCheckedChange={setSupportsVision} />
          </div>
        </div>
        <Button
          className="mt-6 w-full"
          disabled={
            saving ||
            !name ||
            !baseUrl ||
            !model ||
            (!editingProfile && !apiKey.trim())
          }
          onClick={() =>
            onSave({
              id: editingProfile?.id,
              name,
              baseUrl,
              apiFormat,
              model,
              apiKey,
              supportsVision,
              maxOutputTokens: Number(maxOutputTokens),
              reasoningEffort: reasoningEffort === "auto" ? null : reasoningEffort,
            })
          }
        >
          {saving ? "저장 중..." : editingProfile ? "프로필 수정" : "프로필 저장"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function GradMeApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const selectedPaperId = searchParams.get("paper");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"library" | "reader" | "ai">("reader");
  const [currentProfileId, setCurrentProfileId] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem("gradme.currentProfileId") ?? ""
      : "",
  );
  const [aiTab, setAiTab] = useState("summary");
  const [askText, setAskText] = useState("");
  const [savedFilter, setSavedFilter] = useState<AiArtifactRecord["kind"] | "all">("all");
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [noteDraft, setNoteDraft] = useState<{
    title: string;
    contentMd: string;
    selection: SelectionDraft | null;
  } | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [readerPaneHeight, setReaderPaneHeight] = useState<number | null>(null);
  const [isResizingReaderPane, setIsResizingReaderPane] = useState(false);
  const autoSummaryKeys = useRef(new Set<string>());
  const readerSplitRef = useRef<HTMLDivElement | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ["workspace", selectedPaperId],
    queryFn: () =>
      fetchJson<WorkspaceSnapshot>(
        `/api/workspace${selectedPaperId ? `?paper=${selectedPaperId}` : ""}`,
      ),
  });

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: () => fetchJson<ProfileOption[]>("/api/settings/models"),
  });

  const selectedPaper = workspaceQuery.data?.selectedPaper ?? null;
  const effectivePaperId = selectedPaper?.id ?? selectedPaperId ?? "";
  const profiles = profilesQuery.data ?? EMPTY_PROFILES;
  const activeProfileId =
    currentProfileId && profiles.some((profile) => profile.id === currentProfileId)
      ? currentProfileId
      : profiles[0]?.id || "";
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;

  useEffect(() => {
    if (activeProfileId) {
      window.localStorage.setItem("gradme.currentProfileId", activeProfileId);
      return;
    }

    window.localStorage.removeItem("gradme.currentProfileId");
  }, [activeProfileId]);

  useEffect(() => {
    if (!selectedPaperId && selectedPaper?.id) {
      router.replace(`/?paper=${selectedPaper.id}`);
    }
  }, [router, selectedPaper?.id, selectedPaperId]);

  useEffect(() => {
    if (!selectedPaperId) {
      return;
    }

    const element = readerSplitRef.current;

    if (!element) {
      return;
    }

    const updateHeight = () => {
      const totalHeight = element.getBoundingClientRect().height;
      const minHeight = 360;
      const maxHeight = Math.max(minHeight, totalHeight - 220);

      setReaderPaneHeight((current) => {
        const fallback = Math.round(Math.min(Math.max(totalHeight * 0.68, minHeight), maxHeight));

        if (current === null) {
          return fallback;
        }

        const clamped = Math.round(Math.min(Math.max(current, minHeight), maxHeight));
        return clamped === current ? current : clamped;
      });
    };

    const frame = window.requestAnimationFrame(updateHeight);
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(element);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [selectedPaperId]);

  useEffect(() => {
    if (!isResizingReaderPane) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const element = readerSplitRef.current;

      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const minHeight = 360;
      const maxHeight = Math.max(minHeight, rect.height - 220);
      const nextHeight = Math.min(Math.max(event.clientY - rect.top, minHeight), maxHeight);
      setReaderPaneHeight(Math.round(nextHeight));
    }

    function handleMouseUp() {
      setIsResizingReaderPane(false);
    }

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingReaderPane]);

  const importFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/papers/import/file", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as PaperDetail | { error: string };
      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "파일 import 실패");
      }
      return payload;
    },
    onSuccess: (paper) => {
      setStatusMessage("논문을 라이브러리에 추가했습니다.");
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      router.replace(`/?paper=${paper.id}`);
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "가져오기에 실패했습니다."),
  });

  const importUrlMutation = useMutation({
    mutationFn: (url: string) => postJson<PaperDetail>("/api/papers/import/url", { url }),
    onSuccess: (paper) => {
      setStatusMessage("PDF URL에서 논문을 가져왔습니다.");
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      router.replace(`/?paper=${paper.id}`);
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "가져오기에 실패했습니다."),
  });

  const importIdentifierMutation = useMutation({
    mutationFn: (identifier: string) =>
      postJson<PaperDetail>("/api/papers/import/id", { identifier }),
    onSuccess: (paper) => {
      setStatusMessage("식별자 기반으로 논문을 가져왔습니다.");
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      router.replace(`/?paper=${paper.id}`);
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "가져오기에 실패했습니다."),
  });

  const annotationMutation = useMutation({
    mutationFn: (payload: Parameters<typeof postJson<AnnotationRecord>>[1] & { paperId: string }) =>
      postJson<AnnotationRecord>(`/api/papers/${payload.paperId}/annotations`, payload),
    onSuccess: async () => {
      setStatusMessage("주석을 저장했습니다.");
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "주석 저장 실패"),
  });

  const noteMutation = useMutation({
    mutationFn: async (payload: {
      paperId: string;
      title: string;
      contentMd: string;
      selection: SelectionDraft | null;
    }) => {
      let annotationId: string | null = null;

      if (payload.selection) {
        const annotation = await postJson<AnnotationRecord>(
          `/api/papers/${payload.paperId}/annotations`,
          {
            type: "note-link",
            page: payload.selection.page,
            rects: payload.selection.rects,
            color: "rgba(15,91,102,0.78)",
            selectedText:
              payload.selection.type === "text"
                ? payload.selection.selectedText
                : payload.selection.selectedText ?? null,
            selectionRef: payload.selection,
          },
        );
        annotationId = annotation.id;
      }

      return postJson<NoteRecord>(`/api/papers/${payload.paperId}/notes`, {
        title: payload.title,
        contentMd: payload.contentMd,
        annotationId,
      });
    },
    onSuccess: async () => {
      setStatusMessage("메모를 저장했습니다.");
      setNoteDraft(null);
      setNoteDialogOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "메모 저장 실패"),
  });

  const saveProfileMutation = useMutation({
    mutationFn: (payload: {
      id?: string;
      name: string;
      baseUrl: string;
      apiFormat: AiApiFormat;
      model: string;
      apiKey: string;
      supportsVision: boolean;
      maxOutputTokens: number;
      reasoningEffort: ReasoningEffort | null;
    }) => postJson<{ profile: ProfileOption; secretStored: boolean; keytarAvailable: boolean }>("/api/settings/models", payload),
    onSuccess: async (result) => {
      setCurrentProfileId(result.profile.id);
      setStatusMessage(
        result.secretStored
          ? "모델 프로필과 API 키를 저장했습니다."
          : "프로필은 저장했지만 OS 키체인을 사용할 수 없어 API 키는 저장되지 않았습니다.",
      );
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "프로필 저장에 실패했습니다."),
  });

  const summaryMutation = useMutation({
    mutationFn: ({ force = false }: { force?: boolean } = {}) =>
      postJson<AiArtifactRecord>(`/api/papers/${effectivePaperId}/ai/summary`, {
        profileId: activeProfileId,
        force,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) => setStatusMessage(error instanceof Error ? error.message : "요약 생성 실패"),
  });

  const translateMutation = useMutation({
    mutationFn: ({ force = false }: { force?: boolean } = {}) =>
      postJson<AiArtifactRecord>(`/api/papers/${effectivePaperId}/ai/translate`, {
        profileId: activeProfileId,
        force,
      }),
    onSuccess: async () => {
      setAiTab("translate");
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "번역 생성에 실패했습니다."),
  });

  const askMutation = useMutation({
    mutationFn: (payload: {
      question: string;
      selectionRef?: SelectionDraft | null;
      focusKind?: FocusKind;
      force?: boolean;
    }) =>
      postJson<AiArtifactRecord>(`/api/papers/${effectivePaperId}/ai/ask`, {
        profileId: activeProfileId,
        question: payload.question,
        selectionRef: payload.selectionRef
          ? {
              ...payload.selectionRef,
              imagePath: payload.selectionRef.type === "area" ? null : undefined,
            }
          : null,
        selectionPreviewDataUrl:
          payload.selectionRef?.type === "area"
            ? payload.selectionRef.previewDataUrl ?? null
            : null,
        focusKind: payload.focusKind,
        force: payload.force ?? false,
      }),
    onSuccess: async () => {
      setAiTab("ask");
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "질의응답 생성 실패"),
  });

  const filteredPapers = useMemo(() => {
    const papers = workspaceQuery.data?.papers ?? [];
    const query = libraryQuery.trim().toLowerCase();

    if (!query) {
      return papers;
    }

    return papers.filter((paper) => {
      const searchText = [
        paper.title,
        paper.authors.join(" "),
        paper.venue ?? "",
        paper.doi ?? "",
        paper.arxivId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(query);
    });
  }, [libraryQuery, workspaceQuery.data?.papers]);

  const summaryArtifact = selectedPaper
    ? latestArtifact(selectedPaper.artifacts, "summary", PROMPT_VERSIONS.summary)
    : null;
  const translationArtifact = selectedPaper
    ? latestArtifact(selectedPaper.artifacts, "translation", PROMPT_VERSIONS.translation)
    : null;
  const latestQaArtifact = selectedPaper
    ? latestArtifact(selectedPaper.artifacts, "qa", PROMPT_VERSIONS.qa)
    : null;
  const latestFocusArtifact = selectedPaper
    ? selectedPaper.artifacts.find(
        (artifact) =>
          artifact.promptVersion === PROMPT_VERSIONS.focus &&
          (artifact.kind === focusKindToArtifactKind("methodology") ||
            artifact.kind === focusKindToArtifactKind("experimental-setup") ||
            artifact.kind === focusKindToArtifactKind("results") ||
            artifact.kind === focusKindToArtifactKind("contribution") ||
            artifact.kind === focusKindToArtifactKind("limitations")),
      ) ?? null
    : null;
  const savedArtifacts = useMemo(() => {
    if (!selectedPaper) {
      return [];
    }

    if (savedFilter === "all") {
      return selectedPaper.artifacts;
    }

    return selectedPaper.artifacts.filter((artifact) => artifact.kind === savedFilter);
  }, [savedFilter, selectedPaper]);

  useEffect(() => {
    if (!selectedPaper || !activeProfileId) {
      return;
    }

    const cacheKey = `${selectedPaper.id}:${activeProfileId}`;
    if (summaryArtifact || summaryMutation.isPending || autoSummaryKeys.current.has(cacheKey)) {
      return;
    }

    autoSummaryKeys.current.add(cacheKey);
    summaryMutation.mutate({ force: false });
  }, [activeProfileId, selectedPaper, summaryArtifact, summaryMutation]);

  function openPaper(paperId: string) {
    router.replace(`/?paper=${paperId}`);
    setMobilePane("reader");
  }

  function openSelectionNoteDraft(selection: SelectionDraft) {
    setNoteDraft({
      title:
        selection.type === "text" ? `p.${selection.page} 메모` : `p.${selection.page} 영역 메모`,
      contentMd:
        selection.type === "text" ? `> ${selection.selectedText}\n\n` : "영역 캡처 메모\n\n",
      selection,
    });
    setNoteDialogOpen(true);
  }

  function renderReaderPanel(className?: string) {
    if (!selectedPaper) {
      return null;
    }

    return (
      <div className={cn("min-h-0", className)}>
        <PdfReader
          paperId={selectedPaper.id}
          pdfUrl={`/api/papers/${selectedPaper.id}?asset=pdf`}
          annotations={selectedPaper.annotations}
          onCreateAnnotation={(payload) =>
            annotationMutation.mutate({
              paperId: selectedPaper.id,
              ...payload,
            })
          }
          onSendSelectionToAi={(selection) => {
            setSelectionDraft(selection);
            setAiTab("ask");
            setMobilePane("ai");
          }}
          onCreateSelectionNote={openSelectionNoteDraft}
        />
      </div>
    );
  }

  function renderNotesPanel(className?: string) {
    if (!selectedPaper) {
      return null;
    }

    return (
      <Card className={cn("flex min-h-0 flex-col overflow-hidden p-5", className)}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="heading-display text-xl font-semibold">Notes</p>
            <p className="text-sm text-[var(--muted)]">Markdown + 수식 렌더링 지원</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setNoteDraft({
                title: selectedPaper.title,
                contentMd: "",
                selection: null,
              });
              setNoteDialogOpen(true);
            }}
          >
            <NotebookPen className="h-4 w-4" />
            새 메모
          </Button>
        </div>
        <Dialog
          open={noteDialogOpen && Boolean(noteDraft)}
          onOpenChange={(open) => {
            if (noteMutation.isPending) {
              return;
            }

            setNoteDialogOpen(open);
            if (!open) {
              setNoteDraft(null);
            }
          }}
        >
          <DialogContent className="max-h-[88vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>메모 작성</DialogTitle>
              <DialogDescription>
                선택 영역 메모와 전역 메모 모두 Markdown + 수식으로 저장됩니다.
              </DialogDescription>
            </DialogHeader>
            {noteDraft ? (
              <NoteEditor
                title={noteDraft.title}
                content={noteDraft.contentMd}
                onTitleChange={(value) =>
                  setNoteDraft((current) => (current ? { ...current, title: value } : current))
                }
                onContentChange={(value) =>
                  setNoteDraft((current) => (current ? { ...current, contentMd: value } : current))
                }
                onSave={() => {
                  noteMutation.mutate({
                    paperId: selectedPaper.id,
                    title: noteDraft.title,
                    contentMd: noteDraft.contentMd,
                    selection: noteDraft.selection,
                  });
                }}
                onCancel={() => {
                  setNoteDialogOpen(false);
                  setNoteDraft(null);
                }}
                saving={noteMutation.isPending}
              />
            ) : null}
          </DialogContent>
        </Dialog>
        {!noteDraft ? (
          <div className="paper-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {selectedPaper.notes.map((note) => (
              <div
                key={note.id}
                className="rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold">{note.title}</p>
                  <span className="text-xs text-[var(--muted)]">{formatDateTime(note.updatedAt)}</span>
                </div>
                <MarkdownRenderer content={truncate(note.contentMd, 560)} />
              </div>
            ))}
            {selectedPaper.notes.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-10 text-center text-sm text-[var(--muted)]">
                선택 영역에서 바로 메모를 만들거나, 전역 메모를 추가할 수 있습니다.
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div className="min-h-screen px-4 py-4 text-[var(--foreground)] md:px-6">
      <div className="mx-auto flex max-w-[2200px] flex-col gap-4">
        <Card className="overflow-hidden px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="heading-display text-3xl font-semibold">GradMe</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                로컬에서 동작하는 AI 논문 읽기 · 관리 스튜디오
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ImportDialog
                onImportFile={(file) => importFileMutation.mutate(file)}
                onImportUrl={(url) => importUrlMutation.mutate(url)}
                onImportIdentifier={(identifier) => importIdentifierMutation.mutate(identifier)}
                importing={
                  importFileMutation.isPending ||
                  importUrlMutation.isPending ||
                  importIdentifierMutation.isPending
                }
              />
              <SettingsDialog
                profiles={profiles}
                activeProfileId={activeProfileId}
                onSave={(payload) => saveProfileMutation.mutate(payload)}
                saving={saveProfileMutation.isPending}
              />
              <Button asChild variant="outline">
                <a href="/api/export/bibtex">
                  <BookCopy className="h-4 w-4" />
                  BibTeX Export
                </a>
              </Button>
            </div>
          </div>
          {statusMessage ? (
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm">
              {statusMessage}
            </div>
          ) : null}
          <div className="mt-4 flex gap-2 xl:hidden">
            <Button
              variant={mobilePane === "library" ? "secondary" : "outline"}
              onClick={() => setMobilePane("library")}
            >
              Library
            </Button>
            <Button
              variant={mobilePane === "reader" ? "secondary" : "outline"}
              onClick={() => setMobilePane("reader")}
            >
              Reader
            </Button>
            <Button
              variant={mobilePane === "ai" ? "secondary" : "outline"}
              onClick={() => setMobilePane("ai")}
            >
              AI
            </Button>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1.45fr)_360px] 2xl:grid-cols-[300px_minmax(0,1.6fr)_390px]">
          <Card
            className={cn(
              "overflow-hidden",
              mobilePane !== "library" && "hidden xl:block",
            )}
          >
            <div className="border-b border-[var(--line)] px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="heading-display text-xl font-semibold">Library</p>
                  <p className="text-sm text-[var(--muted)]">
                    PDF, DOI, arXiv 기반 논문 수집
                  </p>
                </div>
                <Badge>{workspaceQuery.data?.papers.length ?? 0} papers</Badge>
              </div>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="제목, 저자, DOI 검색"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="paper-scroll max-h-[calc(100vh-280px)] overflow-auto p-4">
              <div className="space-y-3">
                {filteredPapers.map((paper) => (
                  <button
                    key={paper.id}
                    className={cn(
                      "w-full rounded-[24px] border border-[var(--line)] bg-white/70 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white",
                      selectedPaperId === paper.id && "border-[var(--accent)] shadow-md",
                    )}
                    onClick={() => openPaper(paper.id)}
                  >
                    <div className="flex gap-3">
                      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[#f4ede3]">
                        {paper.thumbnailPath ? (
                          <img
                            src={`/api/papers/${paper.id}?asset=thumbnail`}
                            alt={paper.title}
                            width={64}
                            height={96}
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold leading-6">{truncate(paper.title, 92)}</p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {formatAuthors(paper.authors)}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.year ? <Badge>{paper.year}</Badge> : null}
                          {paper.venue ? <Badge>{truncate(paper.venue, 18)}</Badge> : null}
                          {paper.doi ? <Badge>DOI</Badge> : null}
                          {paper.arxivId ? <Badge>arXiv</Badge> : null}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
                {filteredPapers.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/50 px-4 py-10 text-center text-sm text-[var(--muted)]">
                    등록된 논문이 없습니다.
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          <div
            className={cn(
              "space-y-4 xl:flex xl:h-[calc(100vh-9rem)] xl:flex-col",
              mobilePane !== "reader" && "hidden xl:flex",
            )}
          >
            <Card className="overflow-hidden px-5 py-4">
              {selectedPaper ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="heading-display text-2xl font-semibold leading-tight">
                        {selectedPaper.title}
                      </p>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        {formatAuthors(selectedPaper.authors)}
                        {selectedPaper.venue ? ` · ${selectedPaper.venue}` : ""}
                        {selectedPaper.year ? ` · ${selectedPaper.year}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge>{selectedPaper.pageCount} pages</Badge>
                      {selectedPaper.doi ? <Badge>DOI</Badge> : null}
                      {selectedPaper.arxivId ? <Badge>arXiv</Badge> : null}
                    </div>
                  </div>
                  {selectedPaper.abstract ? (
                    <p className="rounded-[22px] border border-[var(--line)] bg-white/65 px-4 py-3 text-sm leading-7 text-[var(--muted)]">
                      {truncate(selectedPaper.abstract, 420)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-6 py-12 text-center">
                  <p className="heading-display text-2xl font-semibold">논문을 먼저 등록하세요</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    등록 후 자동 요약, 주석, 번역, AI 질의를 사용할 수 있습니다.
                  </p>
                </div>
              )}
            </Card>

            {selectedPaper ? (
              <>
                <div className="space-y-4 xl:hidden">
                  {renderReaderPanel()}
                  {renderNotesPanel()}
                </div>
                <div
                  ref={readerSplitRef}
                  className="hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden"
                >
                  <div
                    className="relative min-h-[360px] shrink-0"
                    style={{ height: readerPaneHeight ? `${readerPaneHeight}px` : "68%" }}
                  >
                    <div className="h-[calc(100%-14px)] min-h-[346px]">
                      {renderReaderPanel("h-full")}
                    </div>
                    <button
                      type="button"
                      aria-label="PDF 영역 높이 조절"
                      className="group absolute inset-x-0 bottom-0 flex h-[14px] cursor-row-resize items-center px-4"
                      onMouseDown={() => setIsResizingReaderPane(true)}
                    >
                      <span className="h-1.5 w-full rounded-full bg-[rgba(23,34,47,0.14)] transition group-hover:bg-[rgba(194,100,45,0.45)]" />
                    </button>
                  </div>
                  <div className="min-h-[180px] min-w-0 flex-1 overflow-hidden pt-1">
                    {renderNotesPanel("h-full")}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <Card
            className={cn(
              "overflow-hidden xl:flex xl:h-[calc(100vh-9rem)] xl:min-h-0 xl:flex-col",
              mobilePane !== "ai" && "hidden xl:flex",
            )}
          >
            <div className="border-b border-[var(--line)] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="heading-display text-xl font-semibold">AI Workspace</p>
                  <p className="text-sm text-[var(--muted)]">
                    요약, 번역, 선택 기반 질의, 저장된 응답
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={activeProfileId} onValueChange={setCurrentProfileId}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="모델 프로필 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} · {profile.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
              {profiles.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/55 px-5 py-10 text-center">
                  <BrainCircuit className="mx-auto h-10 w-10 text-[var(--accent)]" />
                  <p className="mt-4 heading-display text-2xl font-semibold">모델 프로필이 필요합니다</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    OpenAI 호환 API 키와 모델명을 저장하면 바로 요약과 질의를 사용할 수 있습니다.
                  </p>
                </div>
              ) : (
                <Tabs
                  value={aiTab}
                  onValueChange={setAiTab}
                  className="space-y-4 xl:grid xl:min-h-0 xl:flex-1 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden"
                >
                  <TabsList className="shrink-0">
                    <TabsTrigger value="summary">Summary</TabsTrigger>
                    <TabsTrigger value="ask">Ask</TabsTrigger>
                    <TabsTrigger value="translate">Translate</TabsTrigger>
                    <TabsTrigger value="saved">Saved</TabsTrigger>
                  </TabsList>

                  <TabsContent value="summary" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        disabled={!selectedPaper || !activeProfileId || summaryMutation.isPending}
                        onClick={() => summaryMutation.mutate({ force: true })}
                      >
                        {summaryMutation.isPending ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        요약 재생성
                      </Button>
                    </div>
                    <div className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll">
                      {summaryArtifact ? (
                        <MarkdownRenderer content={summaryArtifact.contentMd} />
                      ) : (
                        <p className="text-sm text-[var(--muted)]">
                          논문을 열면 기본 요약이 자동 생성됩니다.
                        </p>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="ask" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                    <div className="shrink-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4">
                      <Textarea
                        value={askText}
                        onChange={(event) => setAskText(event.target.value)}
                        placeholder={
                          selectionDraft
                            ? "선택한 영역을 기준으로 질문하세요."
                            : "논문의 가정, 식, 방법론, 결과를 질문하세요."
                        }
                      />
                      {selectionDraft ? (
                        <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[#f7f1e8] px-3 py-2 text-sm">
                          선택 연결됨: p.{selectionDraft.page} ·{" "}
                          {selectionDraft.type === "text"
                            ? truncate(selectionDraft.selectedText, 120)
                            : "영역 캡처"}
                        </div>
                      ) : null}
                      {selectionDraft?.type === "area" && activeProfile && !activeProfile.supportsVision ? (
                        <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          현재 프로필은 영역 캡처 질문을 지원하지 않습니다. Vision 지원 프로필로 바꾸세요.
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {(
                          [
                            ["methodology", "방법론"],
                            ["experimental-setup", "실험 설정"],
                            ["results", "주요 결과"],
                            ["contribution", "핵심 기여"],
                            ["limitations", "한계"],
                          ] as Array<[FocusKind, string]>
                        ).map(([kind, label]) => (
                          <Button
                            key={kind}
                            variant="outline"
                            onClick={() =>
                              askMutation.mutate({
                                question: label,
                                focusKind: kind,
                              })
                            }
                            disabled={!selectedPaper || !activeProfileId || askMutation.isPending}
                          >
                            {label}
                          </Button>
                        ))}
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setSelectionDraft(null)}
                          disabled={!selectionDraft}
                        >
                          선택 해제
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={
                            !selectedPaper ||
                            !activeProfileId ||
                            !askText ||
                            askMutation.isPending ||
                            (selectionDraft?.type === "area" && !activeProfile?.supportsVision)
                          }
                          onClick={() =>
                            askMutation.mutate({
                              question: askText,
                              selectionRef: selectionDraft,
                            })
                          }
                        >
                          {askMutation.isPending ? "질문 중..." : "질문 보내기"}
                        </Button>
                      </div>
                    </div>
                    <div className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll">
                      <MarkdownRenderer
                        content={
                          selectedPaper
                            ? latestQaArtifact?.contentMd ??
                              latestFocusArtifact?.contentMd ??
                              "## 답변\n아직 저장된 답변이 없습니다."
                            : "## 답변\n논문을 선택하세요."
                        }
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="translate" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        disabled={!selectedPaper || !activeProfileId || translateMutation.isPending}
                        onClick={() => translateMutation.mutate({ force: true })}
                      >
                        {translateMutation.isPending ? "번역 중..." : "전문 번역"}
                      </Button>
                    </div>
                    <div className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll">
                      <MarkdownRenderer
                        content={
                          translationArtifact?.contentMd ??
                          "## 전문 번역\n버튼을 누르면 논문 전체 번역을 생성하고 저장합니다."
                        }
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="saved" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                    <div className="shrink-0 flex items-center justify-between">
                      <Select
                        value={savedFilter}
                        onValueChange={(value) =>
                          setSavedFilter(value as typeof savedFilter)
                        }
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">전체</SelectItem>
                          <SelectItem value="summary">Summary</SelectItem>
                          <SelectItem value="translation">Translation</SelectItem>
                          <SelectItem value="qa">Q&A</SelectItem>
                          <SelectItem value="focus-methodology">방법론</SelectItem>
                          <SelectItem value="focus-experimental-setup">실험 설정</SelectItem>
                          <SelectItem value="focus-results">주요 결과</SelectItem>
                          <SelectItem value="focus-contribution">핵심 기여</SelectItem>
                          <SelectItem value="focus-limitations">한계</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge>{savedArtifacts.length} saved</Badge>
                    </div>
                    <div className="paper-scroll min-h-0 space-y-3 xl:overflow-y-scroll xl:pr-1">
                      {savedArtifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="rounded-[24px] border border-[var(--line)] bg-white/70 p-4"
                        >
                          <div className="mb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge>{artifact.kind}</Badge>
                              <span className="text-xs text-[var(--muted)]">{artifact.model}</span>
                            </div>
                            <span className="text-xs text-[var(--muted)]">
                              {formatDateTime(artifact.createdAt)}
                            </span>
                          </div>
                          <MarkdownRenderer content={truncate(artifact.contentMd, 900)} />
                        </div>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
