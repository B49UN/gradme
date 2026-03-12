"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookCopy,
  BrainCircuit,
  FileUp,
  FolderOpen,
  Globe,
  LoaderCircle,
  MessageSquarePlus,
  NotebookPen,
  Search,
  Settings2,
  Sparkles,
  Trash2,
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
import { deleteJson, fetchJson, postEventStream, postJson } from "@/lib/client/api";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";
import {
  findTranslationSectionForPage,
  formatTranslationPageRange,
  parseTranslationDocument,
} from "@/lib/ai/translation";
import { describeThreadSelection } from "@/lib/ai/threads";
import {
  getProviderDefaults,
  inferProviderFromBaseUrl,
} from "@/lib/ai/profile-utils";
import { cn, formatAuthors, formatDateTime, truncate } from "@/lib/utils";
import type {
  AiApiFormat,
  AiProvider,
  AiArtifactRecord,
  AnnotationRecord,
  AskThreadRecord,
  CollectionRecord,
  FocusKind,
  NoteRecord,
  PaperDetail,
  PaperMarkdownFileRecord,
  PaperSelectionRef,
  ReasoningEffort,
  WorkspaceSnapshot,
} from "@/lib/types";

type ProfileOption = {
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
  hasApiKey: boolean;
};

type SelectionDraft = PaperSelectionRef & {
  previewDataUrl?: string | null;
  anchorX?: number;
  anchorY?: number;
};

type AskResponsePayload = {
  artifact: AiArtifactRecord;
  thread: AskThreadRecord;
};

type SummaryStreamState = {
  paperId: string;
  profileId: string;
  contentMd: string;
  status: "streaming" | "failed";
};

type AskStreamDraft = {
  paperId: string;
  profileId: string;
  threadId: string | null;
  question: string;
  answerMd: string;
  selection: SelectionDraft | null;
  status: "streaming" | "failed";
};

const EMPTY_PROFILES: ProfileOption[] = [];
const EMPTY_COLLECTIONS: CollectionRecord[] = [];
const DESKTOP_HANDLE_WIDTH = 12;
const DESKTOP_LEFT_MIN = 260;
const DESKTOP_LEFT_MAX = 520;
const DESKTOP_RIGHT_MIN = 300;
const DESKTOP_RIGHT_MAX = 560;

function clampDesktopColumns(
  totalWidth: number,
  widths: { left: number; right: number },
) {
  const baseCenterMin = Math.min(760, Math.max(460, Math.round(totalWidth * 0.36)));
  const availableCenter = totalWidth - DESKTOP_HANDLE_WIDTH * 2 - DESKTOP_LEFT_MIN - DESKTOP_RIGHT_MIN;
  const centerMin = Math.min(baseCenterMin, Math.max(260, availableCenter));

  let left = Math.min(Math.max(widths.left, DESKTOP_LEFT_MIN), DESKTOP_LEFT_MAX);
  let right = Math.min(Math.max(widths.right, DESKTOP_RIGHT_MIN), DESKTOP_RIGHT_MAX);

  const totalNeeded = left + right + DESKTOP_HANDLE_WIDTH * 2 + centerMin;
  const overflow = totalNeeded - totalWidth;

  if (overflow > 0) {
    const shrinkRight = Math.min(overflow, right - DESKTOP_RIGHT_MIN);
    right -= shrinkRight;
    left -= Math.min(overflow - shrinkRight, left - DESKTOP_LEFT_MIN);
  }

  const maxLeftBySpace = totalWidth - DESKTOP_HANDLE_WIDTH * 2 - centerMin - right;
  left = Math.min(left, Math.max(DESKTOP_LEFT_MIN, maxLeftBySpace));

  const maxRightBySpace = totalWidth - DESKTOP_HANDLE_WIDTH * 2 - centerMin - left;
  right = Math.min(right, Math.max(DESKTOP_RIGHT_MIN, maxRightBySpace));

  return {
    left: Math.round(left),
    right: Math.round(right),
  };
}

function latestArtifact(
  artifacts: AiArtifactRecord[],
  kind: AiArtifactRecord["kind"],
  profileId?: string,
  promptVersion?: string,
) {
  return artifacts.find(
    (artifact) =>
      artifact.kind === kind &&
      (!profileId || artifact.profileId === profileId) &&
      (!promptVersion || artifact.promptVersion === promptVersion),
  );
}

function threadPreview(thread: AskThreadRecord) {
  const lastMessage = thread.messages.at(-1);

  if (!lastMessage) {
    return "새 질문을 시작하면 대화가 누적됩니다.";
  }

  return truncate(lastMessage.contentMd.replace(/\s+/g, " ").trim(), 72);
}

function translationArtifactLabel(artifact: AiArtifactRecord) {
  if (artifact.kind === "translation") {
    return "전체 번역";
  }

  const sections = parseTranslationDocument(artifact.contentMd);
  const first = sections[0];
  const last = sections.at(-1);

  if (!first || !last) {
    return "범위 번역";
  }

  return `범위 ${formatTranslationPageRange(first.pageStart, last.pageEnd)}`;
}

function resolveMarkdownFileContent(
  file: PaperMarkdownFileRecord,
  sources: {
    artifactById: Map<string, AiArtifactRecord>;
    threadById: Map<string, AskThreadRecord>;
  },
) {
  if (file.kind === "thread") {
    return sources.threadById.get(file.targetId)?.contentMd ?? "";
  }

  return sources.artifactById.get(file.targetId)?.contentMd ?? "";
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
    streamingEnabled: boolean;
    maxOutputTokens: number;
    reasoningEffort: ReasoningEffort | null;
  }) => void;
  profiles: ProfileOption[];
  activeProfileId: string;
  saving: boolean;
}) {
  const openAiDefaults = getProviderDefaults("openai");
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState("new");
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(openAiDefaults.baseUrl);
  const [apiFormat, setApiFormat] = useState<AiApiFormat>(openAiDefaults.apiFormat);
  const [model, setModel] = useState(openAiDefaults.model);
  const [apiKey, setApiKey] = useState("");
  const [supportsVision, setSupportsVision] = useState(openAiDefaults.supportsVision);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(openAiDefaults.maxOutputTokens));
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | "auto">("auto");

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editTarget) ?? null,
    [editTarget, profiles],
  );
  const providerDefaults = getProviderDefaults(provider);

  function applyProviderDefaults(nextProvider: AiProvider, preserveName = true) {
    const defaults = getProviderDefaults(nextProvider);
    setProvider(nextProvider);
    setBaseUrl(defaults.baseUrl);
    setApiFormat(defaults.apiFormat);
    setModel(defaults.model);
    setSupportsVision(defaults.supportsVision);
    setStreamingEnabled(true);
    setMaxOutputTokens(String(defaults.maxOutputTokens));
    setReasoningEffort(defaults.reasoningEffort);
    if (!preserveName || !name.trim()) {
      setName(nextProvider === "openai" ? "OpenAI" : "Google Gemini");
    }
  }

  function loadProfile(profile: ProfileOption | null) {
    if (!profile) {
      setEditTarget("new");
      applyProviderDefaults("openai", false);
      setName("");
      setApiKey("");
      setReasoningEffort("auto");
      return;
    }

    const inferredProvider = profile.provider ?? inferProviderFromBaseUrl(profile.baseUrl);
    setEditTarget(profile.id);
    setProvider(inferredProvider);
    setName(profile.name);
    setBaseUrl(profile.baseUrl);
    setApiFormat(profile.apiFormat);
    setModel(profile.model);
    setApiKey("");
    setSupportsVision(profile.supportsVision);
    setStreamingEnabled(profile.streamingEnabled);
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
            OpenAI는 Responses API를, Google은 Gemini native SDK를 사용합니다.
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
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => applyProviderDefaults(value as AiProvider)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="google-gemini">Google Gemini</SelectItem>
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
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              readOnly={provider === "google-gemini"}
            />
            <p className="text-xs text-[var(--muted)]">{providerDefaults.providerDescription}</p>
          </div>
          <div className="space-y-2">
            <Label>API 형식</Label>
            {provider === "openai" ? (
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
            ) : (
              <Input value="Gemini Native SDK" readOnly />
            )}
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
                  : providerDefaults.apiKeyPlaceholder
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
                <SelectItem value="minimal">minimal</SelectItem>
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
          <div className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 md:col-span-2">
            <div>
              <p className="font-medium">실시간 답변</p>
              <p className="text-sm text-[var(--muted)]">Summary와 Ask에서 스트리밍으로 표시합니다.</p>
            </div>
            <Switch checked={streamingEnabled} onCheckedChange={setStreamingEnabled} />
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
              streamingEnabled,
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

function CollectionManagerDialog({
  collections,
  collectionCounts,
  creating,
  deletingCollectionId,
  onCreate,
  onDelete,
}: {
  collections: CollectionRecord[];
  collectionCounts: Map<string, number>;
  creating: boolean;
  deletingCollectionId: string | null;
  onCreate: (name: string) => void;
  onDelete: (collectionId: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FolderOpen className="h-4 w-4" />
          폴더 관리
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>라이브러리 폴더</DialogTitle>
          <DialogDescription>
            폴더를 만들고 삭제해서 논문 분류 체계를 관리합니다.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();

            const normalizedName = name.replace(/\s+/g, " ").trim();
            if (!normalizedName) {
              return;
            }

            onCreate(normalizedName);
            setName("");
          }}
        >
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="예: 실험 설계, 읽을 목록, 핵심 참고문헌"
            />
            <Button type="submit" disabled={creating || !name.trim()}>
              {creating ? "생성 중..." : "폴더 추가"}
            </Button>
          </div>
        </form>
        <div className="space-y-3">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="flex items-center justify-between gap-3 rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{collection.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {collectionCounts.get(collection.id) ?? 0} papers
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-xl px-2 text-[#a43a2c] hover:bg-[rgba(164,58,44,0.08)]"
                disabled={deletingCollectionId === collection.id}
                onClick={() => onDelete(collection.id)}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
                삭제
              </Button>
            </div>
          ))}
          {collections.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-8 text-center text-sm text-[var(--muted)]">
              아직 만든 폴더가 없습니다.
            </div>
          ) : null}
        </div>
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
  const [libraryCollectionFilter, setLibraryCollectionFilter] = useState("all");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"library" | "reader" | "ai">("reader");
  const [desktopLayoutMode, setDesktopLayoutMode] = useState<"split" | "tabs">(() =>
    typeof window !== "undefined"
      ? (window.localStorage.getItem("gradme.desktopLayoutMode") as "split" | "tabs" | null) ??
        "split"
      : "split",
  );
  const [desktopTab, setDesktopTab] = useState<"library" | "reader" | "notes" | "ai">("reader");
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1280px)").matches
      : false,
  );
  const [currentProfileId, setCurrentProfileId] = useState<string>(() =>
    typeof window !== "undefined"
      ? window.localStorage.getItem("gradme.currentProfileId") ?? ""
      : "",
  );
  const [aiTab, setAiTab] = useState("summary");
  const [askText, setAskText] = useState("");
  const [savedFilter, setSavedFilter] = useState<AiArtifactRecord["kind"] | "all">("all");
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeTranslationArtifactId, setActiveTranslationArtifactId] = useState<string | null>(null);
  const [translationPageStart, setTranslationPageStart] = useState("1");
  const [translationPageEnd, setTranslationPageEnd] = useState("1");
  const [summaryStreamState, setSummaryStreamState] = useState<SummaryStreamState | null>(null);
  const [askStreamDraft, setAskStreamDraft] = useState<AskStreamDraft | null>(null);
  const [noteDraft, setNoteDraft] = useState<{
    title: string;
    contentMd: string;
    selection: SelectionDraft | null;
  } | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [desktopColumns, setDesktopColumns] = useState({ left: 320, right: 380 });
  const [resizingPane, setResizingPane] = useState<"left" | "right" | null>(null);
  const [currentReaderPage, setCurrentReaderPage] = useState(1);
  const [requestedReaderPage, setRequestedReaderPage] = useState<{
    paperId: string;
    page: number;
  } | null>(null);
  const autoSummaryKeys = useRef(new Set<string>());
  const summaryStreamRunRef = useRef(0);
  const askStreamRunRef = useRef(0);
  const desktopLayoutRef = useRef<HTMLDivElement | null>(null);
  const askConversationRef = useRef<HTMLDivElement | null>(null);

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
  const collections = workspaceQuery.data?.collections ?? EMPTY_COLLECTIONS;
  const activeProfileId =
    currentProfileId && profiles.some((profile) => profile.id === currentProfileId)
      ? currentProfileId
      : profiles[0]?.id || "";
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? null;
  const streamingEnabled = activeProfile?.streamingEnabled ?? true;
  const showDesktopLayoutToggle = isWideViewport;
  const useDesktopTabs = showDesktopLayoutToggle && desktopLayoutMode === "tabs";

  useEffect(() => {
    if (activeProfileId) {
      window.localStorage.setItem("gradme.currentProfileId", activeProfileId);
      return;
    }

    window.localStorage.removeItem("gradme.currentProfileId");
  }, [activeProfileId]);

  useEffect(() => {
    window.localStorage.setItem("gradme.desktopLayoutMode", desktopLayoutMode);
  }, [desktopLayoutMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const updateViewportState = () => {
      setIsWideViewport(mediaQuery.matches);
    };

    updateViewportState();
    mediaQuery.addEventListener("change", updateViewportState);

    return () => {
      mediaQuery.removeEventListener("change", updateViewportState);
    };
  }, []);

  useEffect(() => {
    if (!selectedPaperId && selectedPaper?.id) {
      router.replace(`/?paper=${selectedPaper.id}`);
    }
  }, [router, selectedPaper?.id, selectedPaperId]);

  useEffect(() => {
    const container = askConversationRef.current;

    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }, [activeThreadId, askStreamDraft, selectedPaper?.askThreads]);

  useEffect(() => {
    const element = desktopLayoutRef.current;

    if (!element) {
      return;
    }

    const updateWidths = () => {
      setDesktopColumns((current) => clampDesktopColumns(element.clientWidth, current));
    };

    updateWidths();
    const observer = new ResizeObserver(updateWidths);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!resizingPane) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const element = desktopLayoutRef.current;

      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      setDesktopColumns((current) => {
        if (resizingPane === "left") {
          return clampDesktopColumns(rect.width, {
            ...current,
            left: event.clientX - rect.left,
          });
        }

        return clampDesktopColumns(rect.width, {
          ...current,
          right: rect.right - event.clientX,
        });
      });
    }

    function handleMouseUp() {
      setResizingPane(null);
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingPane]);

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
      streamingEnabled: boolean;
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

  const createCollectionMutation = useMutation({
    mutationFn: (name: string) => postJson<CollectionRecord>("/api/collections", { name }),
    onSuccess: async (collection) => {
      setStatusMessage(`폴더를 만들었습니다: ${collection.name}`);
      setLibraryCollectionFilter(collection.id);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "폴더 생성에 실패했습니다."),
  });

  const deleteCollectionMutation = useMutation({
    mutationFn: (collectionId: string) => deleteJson<{ id: string }>(`/api/collections/${collectionId}`),
    onSuccess: async (result) => {
      setStatusMessage("폴더를 삭제했습니다.");
      setLibraryCollectionFilter((current) => (current === result.id ? "all" : current));
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "폴더 삭제에 실패했습니다."),
  });

  const setPaperCollectionsMutation = useMutation({
    mutationFn: (payload: { paperId: string; collectionIds: string[] }) =>
      postJson<{ paperId: string; collectionIds: string[] }>(
        `/api/papers/${payload.paperId}/collections`,
        {
          collectionIds: payload.collectionIds,
        },
      ),
    onSuccess: async () => {
      setStatusMessage("논문 폴더 분류를 저장했습니다.");
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "폴더 분류 저장에 실패했습니다."),
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
    mutationFn: ({
      force = false,
      pageStart,
      pageEnd,
    }: {
      force?: boolean;
      pageStart?: number;
      pageEnd?: number;
    } = {}) =>
      postJson<AiArtifactRecord>(`/api/papers/${effectivePaperId}/ai/translate`, {
        profileId: activeProfileId,
        force,
        pageStart,
        pageEnd,
      }),
    onSuccess: async (artifact) => {
      setAiTab("translate");
      setActiveTranslationArtifactId(artifact.id);
      if (useDesktopTabs) {
        setDesktopTab("ai");
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "번역 생성에 실패했습니다."),
  });

  const createThreadMutation = useMutation({
    mutationFn: (payload?: { title?: string }) =>
      postJson<AskThreadRecord>(`/api/papers/${effectivePaperId}/threads`, payload ?? {}),
    onSuccess: async (thread) => {
      setAiTab("ask");
      setActiveThreadId(thread.id);
      setAskText("");
      setSelectionDraft(null);
      if (useDesktopTabs) {
        setDesktopTab("ai");
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "스레드 생성 실패"),
  });

  const openMarkdownFolderMutation = useMutation({
    mutationFn: () =>
      postJson<{ path: string }>(`/api/papers/${effectivePaperId}/markdown/open`, {}),
    onSuccess: (result) => {
      setStatusMessage(`Markdown 폴더를 열었습니다: ${result.path}`);
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "폴더 열기 실패"),
  });

  const askMutation = useMutation({
    mutationFn: (payload: {
      question: string;
      selectionRef?: SelectionDraft | null;
      focusKind?: FocusKind;
    }) =>
      postJson<AskResponsePayload>(
        `/api/papers/${effectivePaperId}/ai/ask`,
        buildAskRequestPayload(payload),
      ),
    onSuccess: async (result) => {
      setAiTab("ask");
      setActiveThreadId(result.thread.id);
      setAskText("");
      setSelectionDraft(null);
      if (useDesktopTabs) {
        setDesktopTab("ai");
      }
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "질의응답 생성 실패"),
  });

  const deleteAnnotationMutation = useMutation({
    mutationFn: ({ paperId, annotationId }: { paperId: string; annotationId: string }) =>
      deleteJson<{ id: string }>(`/api/papers/${paperId}/annotations/${annotationId}`),
    onSuccess: async () => {
      setStatusMessage("주석을 삭제했습니다.");
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "주석 삭제 실패"),
  });

  const deleteNoteMutation = useMutation({
    mutationFn: ({ paperId, noteId }: { paperId: string; noteId: string }) =>
      deleteJson<{ id: string }>(`/api/papers/${paperId}/notes/${noteId}`),
    onSuccess: async () => {
      setStatusMessage("메모를 삭제했습니다.");
      await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
    },
    onError: (error) =>
      setStatusMessage(error instanceof Error ? error.message : "메모 삭제 실패"),
  });

  function buildAskRequestPayload(payload: {
    question: string;
    selectionRef?: SelectionDraft | null;
    focusKind?: FocusKind;
  }) {
    return {
      profileId: activeProfileId,
      question: payload.question,
      threadId: resolvedThreadId,
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
    };
  }

  async function invalidateSelectedPaper() {
    await queryClient.invalidateQueries({ queryKey: ["workspace", effectivePaperId] });
  }

  function getRequestedTranslationRange() {
    const pageStart = Number(translationPageStart.trim());
    const pageEnd = Number(translationPageEnd.trim());

    if (!Number.isInteger(pageStart) || !Number.isInteger(pageEnd)) {
      setStatusMessage("번역할 페이지 범위는 정수로 입력해야 합니다.");
      return null;
    }

    if (pageStart < 1 || pageEnd < 1) {
      setStatusMessage("페이지 번호는 1 이상이어야 합니다.");
      return null;
    }

    if (pageStart > pageEnd) {
      setStatusMessage("시작 페이지는 끝 페이지보다 클 수 없습니다.");
      return null;
    }

    if (selectedPaper?.pageCount && pageEnd > selectedPaper.pageCount) {
      setStatusMessage(`이 논문은 ${selectedPaper.pageCount}페이지까지 있습니다.`);
      return null;
    }

    return {
      pageStart,
      pageEnd,
    };
  }

  function openSavedMarkdown(file: PaperMarkdownFileRecord) {
    if (useDesktopTabs) {
      setDesktopTab("ai");
    }

    if (file.kind === "thread") {
      setAiTab("ask");
      setActiveThreadId(file.targetId);
      return;
    }

    const artifact = artifactById.get(file.targetId);

    if (artifact?.profileId) {
      setCurrentProfileId(artifact.profileId);
    }

    setAiTab("translate");
    setActiveTranslationArtifactId(file.targetId);
  }

  async function startSummaryStream({ force = false }: { force?: boolean } = {}) {
    if (!selectedPaper || !activeProfileId) {
      return;
    }

    const runId = ++summaryStreamRunRef.current;
    setSummaryStreamState({
      paperId: selectedPaper.id,
      profileId: activeProfileId,
      contentMd: "",
      status: "streaming",
    });

    let failedMessage: string | null = null;

    try {
      await postEventStream(
        `/api/papers/${selectedPaper.id}/ai/summary/stream`,
        {
          profileId: activeProfileId,
          force,
        },
        {
          onEvent: (event, data) => {
            if (runId !== summaryStreamRunRef.current || !selectedPaper) {
              return;
            }

            if (event === "delta") {
              const delta = (data as { delta?: string }).delta ?? "";
              setSummaryStreamState((current) =>
                current &&
                current.paperId === selectedPaper.id &&
                current.profileId === activeProfileId
                  ? {
                      ...current,
                      contentMd: current.contentMd + delta,
                    }
                  : current,
              );
              return;
            }

            if (event === "done") {
              setSummaryStreamState(null);
              return;
            }

            if (event === "error") {
              const payload = data as { message?: string; artifact?: AiArtifactRecord };
              failedMessage = payload.message ?? "요약 생성 실패";
              setSummaryStreamState({
                paperId: selectedPaper.id,
                profileId: activeProfileId,
                contentMd: payload.artifact?.contentMd ?? "",
                status: "failed",
              });
            }
          },
        },
      );
    } catch (error) {
      failedMessage = error instanceof Error ? error.message : "요약 생성 실패";
      if (runId === summaryStreamRunRef.current) {
        setSummaryStreamState({
          paperId: selectedPaper.id,
          profileId: activeProfileId,
          contentMd: "",
          status: "failed",
        });
      }
    } finally {
      if (runId === summaryStreamRunRef.current) {
        await invalidateSelectedPaper();
        setSummaryStreamState(null);
        if (failedMessage) {
          setStatusMessage(failedMessage);
        }
      }
    }
  }

  async function startAskStream(payload: {
    question: string;
    selectionRef?: SelectionDraft | null;
    focusKind?: FocusKind;
  }) {
    if (!selectedPaper || !activeProfileId) {
      return;
    }

    const question = payload.question;
    const runId = ++askStreamRunRef.current;
    setAiTab("ask");
    setAskText("");
    setSelectionDraft(null);
    setAskStreamDraft({
      paperId: selectedPaper.id,
      profileId: activeProfileId,
      threadId: resolvedThreadId,
      question,
      answerMd: "",
      selection: payload.selectionRef ?? null,
      status: "streaming",
    });

    let failedMessage: string | null = null;

    try {
      await postEventStream(
        `/api/papers/${selectedPaper.id}/ai/ask/stream`,
        buildAskRequestPayload(payload),
        {
          onEvent: (event, data) => {
            if (runId !== askStreamRunRef.current || !selectedPaper) {
              return;
            }

            if (event === "start") {
              const payloadData = data as { thread?: AskThreadRecord };
              if (payloadData.thread?.id) {
                setActiveThreadId(payloadData.thread.id);
                setAskStreamDraft((current) =>
                  current &&
                  current.paperId === selectedPaper.id &&
                  current.profileId === activeProfileId
                    ? {
                        ...current,
                        threadId: payloadData.thread?.id ?? current.threadId,
                      }
                    : current,
                );
              }
              return;
            }

            if (event === "delta") {
              const delta = (data as { delta?: string }).delta ?? "";
              setAskStreamDraft((current) =>
                current &&
                current.paperId === selectedPaper.id &&
                current.profileId === activeProfileId
                  ? {
                      ...current,
                      answerMd: current.answerMd + delta,
                    }
                  : current,
              );
              return;
            }

            if (event === "done") {
              const payloadData = data as AskResponsePayload;
              setActiveThreadId(payloadData.thread.id);
              setAskStreamDraft(null);
              return;
            }

            if (event === "error") {
              const payloadData = data as {
                message?: string;
                result?: AskResponsePayload;
              };
              failedMessage = payloadData.message ?? "질의응답 생성 실패";
              if (payloadData.result?.thread?.id) {
                setActiveThreadId(payloadData.result.thread.id);
              }
              setAskStreamDraft((current) =>
                current &&
                current.paperId === selectedPaper.id &&
                current.profileId === activeProfileId
                  ? {
                      ...current,
                      answerMd: `${current.answerMd}\n\n## 오류\n${failedMessage}`.trim(),
                      status: "failed",
                    }
                  : current,
              );
            }
          },
        },
      );
    } catch (error) {
      failedMessage = error instanceof Error ? error.message : "질의응답 생성 실패";
      if (runId === askStreamRunRef.current) {
        setAskStreamDraft((current) =>
          current &&
          current.paperId === selectedPaper.id &&
          current.profileId === activeProfileId
            ? {
                ...current,
                answerMd: `${current.answerMd}\n\n## 오류\n${failedMessage}`.trim(),
                status: "failed",
              }
            : current,
        );
      }
    } finally {
      if (runId === askStreamRunRef.current) {
        await invalidateSelectedPaper();
        setAskStreamDraft(null);
        if (failedMessage) {
          setStatusMessage(failedMessage);
        }
      }
    }
  }

  const filteredPapers = useMemo(() => {
    const papers = workspaceQuery.data?.papers ?? [];
    const query = libraryQuery.trim().toLowerCase();

    return papers.filter((paper) => {
      const matchesCollection =
        libraryCollectionFilter === "all"
          ? true
          : libraryCollectionFilter === "uncategorized"
            ? paper.collections.length === 0
            : paper.collections.some((collection) => collection.id === libraryCollectionFilter);

      if (!matchesCollection) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchText = [
        paper.title,
        paper.authors.join(" "),
        paper.venue ?? "",
        paper.doi ?? "",
        paper.arxivId ?? "",
        paper.collections.map((collection) => collection.name).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(query);
    });
  }, [libraryCollectionFilter, libraryQuery, workspaceQuery.data?.papers]);
  const collectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let uncategorized = 0;

    for (const collection of collections) {
      counts.set(collection.id, 0);
    }

    for (const paper of workspaceQuery.data?.papers ?? []) {
      if (paper.collections.length === 0) {
        uncategorized += 1;
      }

      for (const collection of paper.collections) {
        counts.set(collection.id, (counts.get(collection.id) ?? 0) + 1);
      }
    }

    return {
      byId: counts,
      uncategorized,
    };
  }, [collections, workspaceQuery.data?.papers]);

  const summaryArtifact = selectedPaper
    ? latestArtifact(selectedPaper.artifacts, "summary", activeProfileId, PROMPT_VERSIONS.summary)
    : null;
  const translationArtifacts = useMemo(
    () =>
      selectedPaper
        ? selectedPaper.artifacts.filter(
            (artifact) =>
              (artifact.kind === "translation" || artifact.kind === "translation-range") &&
              artifact.profileId === activeProfileId &&
              artifact.promptVersion === PROMPT_VERSIONS.translation,
          )
        : [],
    [activeProfileId, selectedPaper],
  );
  const fullTranslationArtifact =
    translationArtifacts.find((artifact) => artifact.kind === "translation") ?? null;
  const savedArtifacts = useMemo(() => {
    if (!selectedPaper) {
      return [];
    }

    if (savedFilter === "all") {
      return selectedPaper.artifacts;
    }

    return selectedPaper.artifacts.filter((artifact) => artifact.kind === savedFilter);
  }, [savedFilter, selectedPaper]);
  const askThreads = useMemo(() => selectedPaper?.askThreads ?? [], [selectedPaper?.askThreads]);
  const resolvedThreadId =
    activeThreadId &&
    (askThreads.some((thread) => thread.id === activeThreadId) ||
      askStreamDraft?.threadId === activeThreadId)
      ? activeThreadId
      : askThreads[0]?.id ?? null;
  const activeThread =
    askThreads.find((thread) => thread.id === resolvedThreadId) ?? askThreads[0] ?? null;
  const summaryStreamContent =
    summaryStreamState &&
    summaryStreamState.paperId === selectedPaper?.id &&
    summaryStreamState.profileId === activeProfileId
      ? summaryStreamState
      : null;
  const askStreamContent =
    askStreamDraft &&
    askStreamDraft.paperId === selectedPaper?.id &&
    askStreamDraft.profileId === activeProfileId &&
    askStreamDraft.threadId === resolvedThreadId
      ? askStreamDraft
      : null;
  const summaryBusy = summaryMutation.isPending || summaryStreamContent?.status === "streaming";
  const askBusy = askMutation.isPending || askStreamDraft?.status === "streaming";
  const activeTranslationArtifact =
    translationArtifacts.find((artifact) => artifact.id === activeTranslationArtifactId) ??
    fullTranslationArtifact ??
    translationArtifacts[0] ??
    null;
  const translationSections = useMemo(
    () => parseTranslationDocument(activeTranslationArtifact?.contentMd ?? ""),
    [activeTranslationArtifact?.contentMd],
  );
  const activeTranslationSection = useMemo(
    () => findTranslationSectionForPage(translationSections, currentReaderPage),
    [currentReaderPage, translationSections],
  );
  const markdownFiles = selectedPaper?.markdownFiles ?? [];
  const selectedPaperReadingPage = selectedPaper?.readingState?.currentPage ?? 1;
  const selectedPaperCollectionIds = useMemo(
    () => new Set((selectedPaper?.collections ?? []).map((collection) => collection.id)),
    [selectedPaper?.collections],
  );

  const annotationById = useMemo(
    () =>
      new Map(
        (selectedPaper?.annotations ?? []).map((annotation) => [annotation.id, annotation] as const),
      ),
    [selectedPaper?.annotations],
  );
  const artifactById = useMemo(
    () => new Map((selectedPaper?.artifacts ?? []).map((artifact) => [artifact.id, artifact] as const)),
    [selectedPaper?.artifacts],
  );
  const threadById = useMemo(
    () => new Map(askThreads.map((thread) => [thread.id, thread] as const)),
    [askThreads],
  );

  const autoGenerateSummary = useEffectEvent(() => {
    if (streamingEnabled) {
      void startSummaryStream({ force: false });
      return;
    }

    summaryMutation.mutate({ force: false });
  });

  useEffect(() => {
    if (!selectedPaper) {
      setActiveTranslationArtifactId(null);
      return;
    }

    setActiveTranslationArtifactId((current) =>
      current && translationArtifacts.some((artifact) => artifact.id === current)
        ? current
        : fullTranslationArtifact?.id ?? translationArtifacts[0]?.id ?? null,
    );
  }, [fullTranslationArtifact?.id, selectedPaper, translationArtifacts]);

  useEffect(() => {
    const initialPage = String(selectedPaperReadingPage);
    setTranslationPageStart(initialPage);
    setTranslationPageEnd(initialPage);
  }, [selectedPaper?.id, selectedPaperReadingPage]);

  useEffect(() => {
    if (!selectedPaper || !activeProfileId) {
      return;
    }

    const cacheKey = `${selectedPaper.id}:${activeProfileId}`;
    if (summaryArtifact || summaryBusy || autoSummaryKeys.current.has(cacheKey)) {
      return;
    }

    autoSummaryKeys.current.add(cacheKey);
    autoGenerateSummary();
  }, [
    activeProfileId,
    selectedPaper,
    summaryArtifact,
    summaryBusy,
    streamingEnabled,
  ]);

  useEffect(() => {
    if (
      libraryCollectionFilter !== "all" &&
      libraryCollectionFilter !== "uncategorized" &&
      !collections.some((collection) => collection.id === libraryCollectionFilter)
    ) {
      setLibraryCollectionFilter("all");
    }
  }, [collections, libraryCollectionFilter]);

  function openPaper(paperId: string) {
    router.replace(`/?paper=${paperId}`);
    setMobilePane("reader");
    if (useDesktopTabs) {
      setDesktopTab("reader");
    }
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
    if (useDesktopTabs) {
      setDesktopTab("notes");
    }
  }

  function moveReaderToPage(page: number, revealReaderOnMobile = false) {
    if (selectedPaper) {
      setRequestedReaderPage({
        paperId: selectedPaper.id,
        page,
      });
    }

    if (
      revealReaderOnMobile &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1279px)").matches
    ) {
      setMobilePane("reader");
    } else if (revealReaderOnMobile && useDesktopTabs) {
      setDesktopTab("reader");
    }
  }

  function handleReaderPageChange(page: number) {
    setCurrentReaderPage(page);
    setRequestedReaderPage((current) =>
      current && current.paperId === selectedPaper?.id && current.page === page ? null : current,
    );
  }

  function toggleSelectedPaperCollection(collectionId: string) {
    if (!selectedPaper) {
      return;
    }

    const nextCollectionIds = new Set(selectedPaperCollectionIds);

    if (nextCollectionIds.has(collectionId)) {
      nextCollectionIds.delete(collectionId);
    } else {
      nextCollectionIds.add(collectionId);
    }

    setPaperCollectionsMutation.mutate({
      paperId: selectedPaper.id,
      collectionIds: [...nextCollectionIds],
    });
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
          requestedPage={
            requestedReaderPage?.paperId === selectedPaper.id ? requestedReaderPage.page : null
          }
          onPageChange={handleReaderPageChange}
          onCreateAnnotation={(payload) =>
            annotationMutation.mutate({
              paperId: selectedPaper.id,
              ...payload,
            })
          }
          onDeleteAnnotation={(annotationId) =>
            deleteAnnotationMutation.mutate({
              paperId: selectedPaper.id,
              annotationId,
            })
          }
          onSendSelectionToAi={(selection) => {
            setSelectionDraft(selection);
            setAiTab("ask");
            if (useDesktopTabs) {
              setDesktopTab("ai");
            } else {
              setMobilePane("ai");
            }
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
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{note.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      {note.annotationId && annotationById.get(note.annotationId) ? (
                        <Badge className="bg-transparent">
                          p.{annotationById.get(note.annotationId)?.page}
                        </Badge>
                      ) : null}
                      <span>{formatDateTime(note.updatedAt)}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-xl px-2 text-[#a43a2c] hover:bg-[rgba(164,58,44,0.08)]"
                    disabled={
                      deleteNoteMutation.isPending &&
                      deleteNoteMutation.variables?.noteId === note.id
                    }
                    onClick={() =>
                      deleteNoteMutation.mutate({
                        paperId: selectedPaper.id,
                        noteId: note.id,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                    삭제
                  </Button>
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

  function renderLibraryPanel(className?: string) {
    const selectedPaperCollectionUpdatePending =
      setPaperCollectionsMutation.isPending &&
      setPaperCollectionsMutation.variables?.paperId === selectedPaper?.id;

    return (
      <Card className={cn("overflow-hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col", className)}>
        <div className="border-b border-[var(--line)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="heading-display text-xl font-semibold">Library</p>
              <p className="text-sm text-[var(--muted)]">
                PDF, DOI, arXiv 기반 논문 수집
              </p>
            </div>
            <div className="flex items-center gap-2">
              <CollectionManagerDialog
                collections={collections}
                collectionCounts={collectionCounts.byId}
                creating={createCollectionMutation.isPending}
                deletingCollectionId={
                  deleteCollectionMutation.isPending
                    ? (deleteCollectionMutation.variables ?? null)
                    : null
                }
                onCreate={(name) => createCollectionMutation.mutate(name)}
                onDelete={(collectionId) => deleteCollectionMutation.mutate(collectionId)}
              />
              <Badge>{workspaceQuery.data?.papers.length ?? 0} papers</Badge>
            </div>
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
          <div className="mt-4 space-y-3">
            <div className="paper-scroll overflow-x-auto pb-1">
              <div className="flex min-w-max gap-2 pr-1">
                <Button
                  size="sm"
                  variant={libraryCollectionFilter === "all" ? "secondary" : "outline"}
                  onClick={() => setLibraryCollectionFilter("all")}
                >
                  전체
                  <span className="text-xs opacity-75">{workspaceQuery.data?.papers.length ?? 0}</span>
                </Button>
                <Button
                  size="sm"
                  variant={libraryCollectionFilter === "uncategorized" ? "secondary" : "outline"}
                  onClick={() => setLibraryCollectionFilter("uncategorized")}
                >
                  미분류
                  <span className="text-xs opacity-75">{collectionCounts.uncategorized}</span>
                </Button>
                {collections.map((collection) => (
                  <Button
                    key={collection.id}
                    size="sm"
                    variant={libraryCollectionFilter === collection.id ? "secondary" : "outline"}
                    onClick={() => setLibraryCollectionFilter(collection.id)}
                  >
                    {collection.name}
                    <span className="text-xs opacity-75">
                      {collectionCounts.byId.get(collection.id) ?? 0}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            {selectedPaper ? (
              <div className="rounded-[22px] border border-[var(--line)] bg-white/65 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">현재 논문 폴더</p>
                    <p className="text-sm text-[var(--muted)]">
                      선택한 논문을 하나 이상의 폴더에 배정할 수 있습니다.
                    </p>
                  </div>
                  <Badge className="bg-transparent">
                    {selectedPaper.collections.length} assigned
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {collections.map((collection) => (
                    <Button
                      key={collection.id}
                      size="sm"
                      variant={
                        selectedPaperCollectionIds.has(collection.id) ? "secondary" : "outline"
                      }
                      disabled={selectedPaperCollectionUpdatePending}
                      onClick={() => toggleSelectedPaperCollection(collection.id)}
                    >
                      {collection.name}
                    </Button>
                  ))}
                  {collections.length === 0 ? (
                    <p className="text-sm text-[var(--muted)]">
                      폴더를 먼저 만들면 여기서 바로 배정할 수 있습니다.
                    </p>
                  ) : null}
                </div>
                {selectedPaper.collections.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">
                    아직 어떤 폴더에도 배정되지 않았습니다.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="paper-scroll min-h-0 flex-1 overflow-auto p-4">
          <div className="space-y-3">
            {filteredPapers.map((paper) => (
              <button
                key={paper.id}
                className={cn(
                  "w-full rounded-[24px] border border-[var(--line)] bg-white/70 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white",
                  selectedPaper?.id === paper.id && "border-[var(--accent)] shadow-md",
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
                    {paper.collections.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {paper.collections.map((collection) => (
                          <Badge key={collection.id} className="bg-transparent">
                            {collection.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--muted)]">미분류</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {filteredPapers.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/50 px-4 py-10 text-center text-sm text-[var(--muted)]">
                {workspaceQuery.data?.papers.length
                  ? "조건에 맞는 논문이 없습니다."
                  : "등록된 논문이 없습니다."}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    );
  }

  function renderAiPanel(className?: string) {
    return (
      <Card className={cn("overflow-hidden xl:flex xl:min-h-0 xl:flex-col", className)}>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-[var(--muted)]">
                    {streamingEnabled
                      ? "현재 프로필은 요약을 실시간으로 표시합니다."
                      : "현재 프로필은 요약이 끝난 뒤 한 번에 표시합니다."}
                  </p>
                  <Button
                    variant="outline"
                    disabled={!selectedPaper || !activeProfileId || summaryBusy}
                    onClick={() =>
                      streamingEnabled
                        ? void startSummaryStream({ force: true })
                        : summaryMutation.mutate({ force: true })
                    }
                  >
                    {summaryBusy ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {summaryBusy ? "요약 중..." : "요약 재생성"}
                  </Button>
                </div>
                <div className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll">
                  {summaryStreamContent ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                        <LoaderCircle
                          className={cn("h-4 w-4", summaryStreamContent.status === "streaming" && "animate-spin")}
                        />
                        <span>
                          {summaryStreamContent.status === "streaming"
                            ? "실시간으로 요약을 생성하는 중입니다."
                            : "스트리밍 요약이 오류와 함께 종료되었습니다."}
                        </span>
                      </div>
                      <MarkdownRenderer
                        content={
                          summaryStreamContent.contentMd ||
                          "## 한줄 요약\n응답을 기다리는 중입니다."
                        }
                      />
                    </div>
                  ) : summaryArtifact ? (
                    <MarkdownRenderer content={summaryArtifact.contentMd} />
                  ) : (
                    <p className="text-sm text-[var(--muted)]">
                      논문을 열면 기본 요약이 자동 생성됩니다.
                    </p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ask" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)_auto] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                <div className="space-y-3">
                  <div>
                    <p className="font-semibold">대화 스레드</p>
                    <p className="text-sm text-[var(--muted)]">
                      스레드는 Markdown 페이지로 저장되고, 현재 프로필 설정에 따라 실시간 또는 완료 후 표시됩니다.
                    </p>
                  </div>
                  <div className="paper-scroll overflow-x-auto pb-1">
                    <div className="flex min-w-max gap-3 pr-1">
                      {askThreads.map((thread) => (
                        <button
                          key={thread.id}
                          type="button"
                          className={cn(
                            "w-[220px] rounded-[22px] border px-4 py-3 text-left transition",
                            activeThread?.id === thread.id
                              ? "border-[var(--accent-strong)] bg-[rgba(15,91,102,0.08)]"
                              : "border-[var(--line)] bg-white/70 hover:bg-white",
                          )}
                          onClick={() => setActiveThreadId(thread.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-semibold">{thread.title}</p>
                            <Badge className="bg-transparent">{thread.messages.length}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            {formatDateTime(thread.updatedAt)}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                            {threadPreview(thread)}
                          </p>
                        </button>
                      ))}
                      {askThreads.length === 0 ? (
                        <div className="w-[240px] rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-6 text-sm text-[var(--muted)]">
                          아직 스레드가 없습니다. 질문을 보내면 자동으로 새 스레드가 만들어집니다.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div
                  ref={askConversationRef}
                  className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll"
                >
                  {activeThread || askStreamContent ? (
                    activeThread?.messages.length || askStreamContent ? (
                      <div className="space-y-4">
                        {(activeThread?.messages ?? []).map((message) => (
                          <div
                            key={message.id}
                            className={cn(
                              "max-w-[94%] rounded-[24px] border px-4 py-4",
                              message.role === "user"
                                ? "ml-auto border-[var(--accent)] bg-[#fff3ea]"
                                : "border-[var(--line)] bg-white",
                            )}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <Badge className={message.role === "user" ? "" : "bg-transparent"}>
                                {message.role === "user" ? "질문" : "답변"}
                              </Badge>
                              <span className="text-xs text-[var(--muted)]">
                                {formatDateTime(message.createdAt)}
                              </span>
                            </div>
                            {message.selectionRef ? (
                              <button
                                type="button"
                                className="mb-3 rounded-2xl border border-[var(--line)] bg-[#f7f1e8] px-3 py-2 text-left text-sm text-[var(--muted)]"
                                onClick={() =>
                                  moveReaderToPage(message.selectionRef?.page ?? 1, true)
                                }
                              >
                                {describeThreadSelection(message.selectionRef)}
                              </button>
                            ) : null}
                            {message.role === "assistant" ? (
                              <MarkdownRenderer content={message.contentMd} />
                            ) : (
                              <p className="whitespace-pre-wrap text-sm leading-7">
                                {message.contentMd}
                              </p>
                            )}
                          </div>
                        ))}
                        {askStreamContent ? (
                          <>
                            <div className="ml-auto max-w-[94%] rounded-[24px] border border-[var(--accent)] bg-[#fff3ea] px-4 py-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <Badge>질문</Badge>
                                <span className="text-xs text-[var(--muted)]">지금 전송됨</span>
                              </div>
                              {askStreamContent.selection ? (
                                <button
                                  type="button"
                                  className="mb-3 rounded-2xl border border-[var(--line)] bg-white/60 px-3 py-2 text-left text-sm text-[var(--muted)]"
                                  onClick={() =>
                                    moveReaderToPage(askStreamContent.selection?.page ?? 1, true)
                                  }
                                >
                                  {describeThreadSelection(askStreamContent.selection)}
                                </button>
                              ) : null}
                              <p className="whitespace-pre-wrap text-sm leading-7">
                                {askStreamContent.question}
                              </p>
                            </div>
                            <div className="max-w-[94%] rounded-[24px] border border-[var(--line)] bg-white px-4 py-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <Badge className="bg-transparent">답변</Badge>
                                <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                                  {askStreamContent.status === "streaming" ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                  ) : null}
                                  {askStreamContent.status === "streaming"
                                    ? "실시간 생성 중"
                                    : "오류와 함께 종료됨"}
                                </span>
                              </div>
                              <MarkdownRenderer
                                content={askStreamContent.answerMd || "## 답변\n응답을 기다리는 중입니다."}
                              />
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/50 px-5 py-10 text-center text-sm text-[var(--muted)]">
                        현재 스레드는 비어 있습니다. 질문을 보내면 사용자 질문과 AI 답변이 함께 누적됩니다.
                      </div>
                    )
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/50 px-5 py-10 text-center text-sm text-[var(--muted)]">
                      질문을 보내면 새 스레드가 자동으로 생성됩니다.
                    </div>
                  )}
                </div>

                <div className="shrink-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge>{activeThread?.title ?? askStreamContent?.question ?? "새 스레드"}</Badge>
                    <Badge className="bg-transparent">현재 PDF p.{currentReaderPage}</Badge>
                    {selectionDraft ? (
                      <Badge className="bg-transparent">
                        연결 선택 p.{selectionDraft.page}
                      </Badge>
                    ) : null}
                  </div>
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
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[#f7f1e8] px-3 py-2 text-sm">
                      <span>
                        선택 연결됨: {describeThreadSelection(selectionDraft)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-xl px-2"
                        onClick={() => moveReaderToPage(selectionDraft.page, true)}
                      >
                        PDF 보기
                      </Button>
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
                          streamingEnabled
                            ? void startAskStream({
                                question: label,
                                focusKind: kind,
                              })
                            : askMutation.mutate({
                                question: label,
                                focusKind: kind,
                              })
                        }
                        disabled={!selectedPaper || !activeProfileId || askBusy}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button
                      variant="outline"
                      className="mr-auto"
                      disabled={!selectedPaper || createThreadMutation.isPending}
                      onClick={() => createThreadMutation.mutate(undefined)}
                    >
                      <MessageSquarePlus className="h-4 w-4" />
                      새 스레드
                    </Button>
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
                        askBusy ||
                        (selectionDraft?.type === "area" && !activeProfile?.supportsVision)
                      }
                      onClick={() =>
                        streamingEnabled
                          ? void startAskStream({
                              question: askText,
                              selectionRef: selectionDraft,
                            })
                          : askMutation.mutate({
                              question: askText,
                              selectionRef: selectionDraft,
                            })
                      }
                    >
                      {askBusy
                        ? streamingEnabled
                          ? "답변 중..."
                          : "질문 중..."
                        : "질문 보내기"}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="translate" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>현재 PDF p.{currentReaderPage}</Badge>
                      {activeTranslationSection ? (
                        <Badge className="bg-transparent">
                          연결 번역 {formatTranslationPageRange(
                            activeTranslationSection.pageStart,
                            activeTranslationSection.pageEnd,
                          )}
                        </Badge>
                      ) : null}
                    </div>
                    {translationArtifacts.length > 0 ? (
                      <Select
                        value={activeTranslationArtifact?.id ?? ""}
                        onValueChange={setActiveTranslationArtifactId}
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue placeholder="번역 결과 선택" />
                        </SelectTrigger>
                        <SelectContent>
                          {translationArtifacts.map((artifact) => (
                            <SelectItem key={artifact.id} value={artifact.id}>
                              {translationArtifactLabel(artifact)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-3">
                    <div className="space-y-1">
                      <Label htmlFor="translation-page-start">시작 페이지</Label>
                      <Input
                        id="translation-page-start"
                        className="w-28"
                        type="number"
                        min="1"
                        value={translationPageStart}
                        onChange={(event) => setTranslationPageStart(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="translation-page-end">끝 페이지</Label>
                      <Input
                        id="translation-page-end"
                        className="w-28"
                        type="number"
                        min="1"
                        value={translationPageEnd}
                        onChange={(event) => setTranslationPageEnd(event.target.value)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      disabled={!selectedPaper || !activeProfileId || translateMutation.isPending}
                      onClick={() =>
                        translateMutation.mutate({
                          pageStart: currentReaderPage,
                          pageEnd: currentReaderPage,
                        })
                      }
                    >
                      현재 페이지 번역
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!selectedPaper || !activeProfileId || translateMutation.isPending}
                      onClick={() => {
                        const range = getRequestedTranslationRange();

                        if (!range) {
                          return;
                        }

                        translateMutation.mutate(range);
                      }}
                    >
                      범위 번역
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!selectedPaper || !activeProfileId || translateMutation.isPending}
                      onClick={() =>
                        translateMutation.mutate({
                          force: Boolean(fullTranslationArtifact),
                        })
                      }
                    >
                      {translateMutation.isPending ? "번역 중..." : fullTranslationArtifact ? "전체 번역 재생성" : "전체 번역"}
                    </Button>
                  </div>
                  <p className="text-sm text-[var(--muted)]">
                    번역 카드의 페이지 버튼을 누르면 PDF가 해당 위치로 이동합니다.
                  </p>
                </div>
                <div className="paper-scroll min-h-0 rounded-[24px] border border-[var(--line)] bg-white/70 p-4 xl:overflow-y-scroll">
                  {translationSections.length > 0 ? (
                    <div className="space-y-3">
                      {translationSections.map((section) => {
                        const isActive =
                          currentReaderPage >= section.pageStart &&
                          currentReaderPage <= section.pageEnd;

                        return (
                          <div
                            key={`${section.pageStart}-${section.pageEnd}-${section.chunkIndex}`}
                            className={cn(
                              "rounded-[22px] border px-4 py-4 transition",
                              isActive
                                ? "border-[var(--accent-strong)] bg-[rgba(15,91,102,0.08)]"
                                : "border-[var(--line)] bg-white",
                            )}
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  variant={isActive ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-8 rounded-xl px-3"
                                  onClick={() => moveReaderToPage(section.pageStart, true)}
                                >
                                  {formatTranslationPageRange(section.pageStart, section.pageEnd)}
                                </Button>
                                {section.heading ? (
                                  <span className="text-sm text-[var(--muted)]">
                                    {section.heading}
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-xs text-[var(--muted)]">
                                {isActive ? "현재 보고 있는 PDF 범위" : "PDF와 연결 가능"}
                              </span>
                            </div>
                            <MarkdownRenderer content={section.contentMd} />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <MarkdownRenderer
                      content={
                        activeTranslationArtifact?.contentMd ??
                        "## 전문 번역\n전체 번역 또는 선택한 페이지 범위 번역을 생성하면 여기에서 바로 확인할 수 있습니다."
                      }
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="saved" className="space-y-4 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-4 xl:space-y-0 xl:overflow-hidden">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
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
                        <SelectItem value="translation">Translate</SelectItem>
                        <SelectItem value="translation-range">Translate Range</SelectItem>
                        <SelectItem value="qa">Q&A</SelectItem>
                        <SelectItem value="focus-methodology">방법론</SelectItem>
                        <SelectItem value="focus-experimental-setup">실험 설정</SelectItem>
                        <SelectItem value="focus-results">결과</SelectItem>
                        <SelectItem value="focus-contribution">기여</SelectItem>
                        <SelectItem value="focus-limitations">한계</SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge>{savedArtifacts.length}</Badge>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!selectedPaper || openMarkdownFolderMutation.isPending}
                    onClick={() => openMarkdownFolderMutation.mutate()}
                  >
                    <FolderOpen className="h-4 w-4" />
                    Markdown 폴더
                  </Button>
                </div>
                <div className="paper-scroll min-h-0 space-y-3 overflow-y-auto pr-1">
                  <div className="rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">Markdown 파일</p>
                        <p className="text-sm text-[var(--muted)]">
                          스레드와 번역 결과가 논문별 Markdown 파일로 저장됩니다.
                        </p>
                      </div>
                      <Badge className="bg-transparent">{markdownFiles.length}</Badge>
                    </div>
                    {markdownFiles.length > 0 ? (
                      <div className="space-y-3">
                        {markdownFiles.map((file) => (
                          <div
                            key={file.id}
                            className="rounded-[18px] border border-[var(--line)] bg-white px-4 py-4"
                          >
                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge>{file.kind}</Badge>
                                  <p className="truncate font-semibold">{file.title}</p>
                                </div>
                                <p className="mt-1 text-xs text-[var(--muted)]">{file.fileName}</p>
                                <p className="mt-1 text-xs text-[var(--muted)]">
                                  {formatDateTime(file.updatedAt)}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-xl px-3"
                                onClick={() => openSavedMarkdown(file)}
                              >
                                열기
                              </Button>
                            </div>
                            <MarkdownRenderer
                              content={truncate(
                                resolveMarkdownFileContent(file, {
                                  artifactById,
                                  threadById,
                                }),
                                1200,
                              )}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-white/50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                        아직 생성된 Markdown 파일이 없습니다.
                      </div>
                    )}
                  </div>
                  {savedArtifacts.map((artifact) => (
                    <div
                      key={artifact.id}
                      className="rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-4"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <Badge>{artifact.kind}</Badge>
                        <span className="text-xs text-[var(--muted)]">
                          {formatDateTime(artifact.createdAt)}
                        </span>
                      </div>
                      <MarkdownRenderer content={truncate(artifact.contentMd, 1400)} />
                    </div>
                  ))}
                  {savedArtifacts.length === 0 ? (
                    <div className="rounded-[24px] border border-dashed border-[var(--line)] bg-white/55 px-5 py-10 text-center text-sm text-[var(--muted)]">
                      아직 저장된 응답이 없습니다.
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="h-[100dvh] overflow-hidden px-3 py-3 text-[var(--foreground)] md:px-4">
      <div className="mx-auto flex h-full max-w-[2200px] flex-col gap-3 overflow-hidden">
        <Card className="shrink-0 overflow-hidden px-4 py-3 md:px-5">
          <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[200px_minmax(0,1fr)_auto] xl:items-center xl:gap-4">
            <div>
              <p className="heading-display text-2xl font-semibold md:text-3xl">GradMe</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                로컬에서 동작하는 AI 논문 읽기 · 관리 스튜디오
              </p>
            </div>
            <div className="min-w-0">
              {selectedPaper ? (
                <div className="rounded-[20px] border border-[var(--line)] bg-white/70 px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="heading-display truncate text-base font-semibold leading-tight">
                        {selectedPaper.title}
                      </p>
                      <p className="mt-1 truncate text-sm text-[var(--muted)]">
                        {formatAuthors(selectedPaper.authors)}
                        {selectedPaper.venue ? ` · ${selectedPaper.venue}` : ""}
                        {selectedPaper.year ? ` · ${selectedPaper.year}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Badge>{selectedPaper.pageCount} pages</Badge>
                      {selectedPaper.doi ? <Badge>DOI</Badge> : null}
                      {selectedPaper.arxivId ? <Badge>arXiv</Badge> : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="hidden rounded-[20px] border border-dashed border-[var(--line)] bg-white/55 px-4 py-2.5 text-sm text-[var(--muted)] xl:block">
                  읽을 논문을 선택하면 현재 논문 정보가 여기에 표시됩니다.
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showDesktopLayoutToggle ? (
                <div className="hidden items-center gap-2 xl:flex">
                  <Button
                    variant={desktopLayoutMode === "split" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setDesktopLayoutMode("split")}
                  >
                    분할 레이아웃
                  </Button>
                  <Button
                    variant={desktopLayoutMode === "tabs" ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setDesktopLayoutMode("tabs")}
                  >
                    탭 레이아웃
                  </Button>
                </div>
              ) : null}
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
            <div className="mt-3 rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm">
              {statusMessage}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2 xl:hidden">
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

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:hidden">
          {mobilePane === "library" ? renderLibraryPanel("min-h-0") : null}
          {mobilePane === "reader" ? (
            selectedPaper ? (
              <>
                <Card className="overflow-hidden px-4 py-3">
                  <div className="space-y-2">
                    <p className="heading-display text-xl font-semibold leading-tight">
                      {selectedPaper.title}
                    </p>
                    <p className="text-sm text-[var(--muted)]">
                      {formatAuthors(selectedPaper.authors)}
                      {selectedPaper.venue ? ` · ${selectedPaper.venue}` : ""}
                      {selectedPaper.year ? ` · ${selectedPaper.year}` : ""}
                    </p>
                  </div>
                </Card>
                <div className="min-h-0 flex-1">{renderReaderPanel("h-full")}</div>
                {renderNotesPanel()}
              </>
            ) : (
              <Card className="flex min-h-[320px] flex-1 items-center justify-center px-6 py-12 text-center">
                <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-6 py-12 text-center">
                  <p className="heading-display text-2xl font-semibold">논문을 먼저 등록하세요</p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    등록 후 자동 요약, 주석, 번역, AI 질의를 사용할 수 있습니다.
                  </p>
                </div>
              </Card>
            )
          ) : null}
          {mobilePane === "ai" ? renderAiPanel("min-h-0") : null}
        </div>

        {useDesktopTabs ? (
          <Card className="hidden min-h-0 flex-1 overflow-hidden xl:flex">
            <Tabs
              value={desktopTab}
              onValueChange={(value) =>
                setDesktopTab(value as "library" | "reader" | "notes" | "ai")
              }
              className="flex min-h-0 flex-1 flex-col p-5"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="library">Library</TabsTrigger>
                  <TabsTrigger value="reader">Reader</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="ai">AI</TabsTrigger>
                </TabsList>
                {selectedPaper ? (
                  <Badge className="bg-transparent">현재 PDF p.{currentReaderPage}</Badge>
                ) : null}
              </div>

              <TabsContent value="library" className="min-h-0 flex-1">
                {renderLibraryPanel("h-full")}
              </TabsContent>

              <TabsContent value="reader" className="min-h-0 flex-1">
                {selectedPaper ? (
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <Card className="shrink-0 overflow-hidden px-4 py-3">
                      <div className="space-y-2">
                        <p className="heading-display text-xl font-semibold leading-tight">
                          {selectedPaper.title}
                        </p>
                        <p className="text-sm text-[var(--muted)]">
                          {formatAuthors(selectedPaper.authors)}
                          {selectedPaper.venue ? ` · ${selectedPaper.venue}` : ""}
                          {selectedPaper.year ? ` · ${selectedPaper.year}` : ""}
                        </p>
                      </div>
                    </Card>
                    <div className="min-h-0 flex-1">{renderReaderPanel("h-full")}</div>
                  </div>
                ) : (
                  <Card className="flex min-h-[360px] h-full items-center justify-center px-6 py-12 text-center">
                    <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-6 py-12 text-center">
                      <p className="heading-display text-2xl font-semibold">논문을 먼저 등록하세요</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        등록 후 자동 요약, 주석, 번역, AI 질의를 사용할 수 있습니다.
                      </p>
                    </div>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="notes" className="min-h-0 flex-1">
                {selectedPaper ? (
                  renderNotesPanel("h-full")
                ) : (
                  <Card className="flex min-h-[360px] h-full items-center justify-center px-6 py-12 text-center">
                    <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-6 py-12 text-center">
                      <p className="heading-display text-2xl font-semibold">논문을 먼저 등록하세요</p>
                      <p className="mt-2 text-sm text-[var(--muted)]">
                        등록 후 메모와 연결 주석을 사용할 수 있습니다.
                      </p>
                    </div>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="ai" className="min-h-0 flex-1">
                {renderAiPanel("h-full")}
              </TabsContent>
            </Tabs>
          </Card>
        ) : (
          <div
            ref={desktopLayoutRef}
            className="relative hidden min-h-0 flex-1 overflow-hidden xl:grid xl:gap-3"
            style={{
              gridTemplateColumns: `${desktopColumns.left}px ${DESKTOP_HANDLE_WIDTH}px minmax(0,1fr) ${DESKTOP_HANDLE_WIDTH}px ${desktopColumns.right}px`,
            }}
          >
            <div className="min-h-0 flex flex-col gap-3">
              {renderLibraryPanel("min-h-0 flex-[1.08]")}
              {selectedPaper ? (
                <div className="min-h-0 flex-[0.92]">
                  {renderNotesPanel("h-full")}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              aria-label="왼쪽 패널 너비 조절"
              className="group flex min-h-0 cursor-col-resize items-stretch"
              onMouseDown={() => setResizingPane("left")}
            >
              <span className="mx-auto my-2 w-1.5 rounded-full bg-[rgba(23,34,47,0.14)] transition group-hover:bg-[rgba(194,100,45,0.45)] group-active:bg-[rgba(194,100,45,0.7)]" />
            </button>

            <div className="min-h-0 flex flex-col">
              {selectedPaper ? (
                <div className="min-h-0 flex-1">{renderReaderPanel("h-full")}</div>
              ) : (
                <Card className="flex min-h-[360px] flex-1 items-center justify-center px-6 py-12 text-center">
                  <div className="rounded-[22px] border border-dashed border-[var(--line)] bg-white/55 px-6 py-12 text-center">
                    <p className="heading-display text-2xl font-semibold">논문을 먼저 등록하세요</p>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      등록 후 자동 요약, 주석, 번역, AI 질의를 사용할 수 있습니다.
                    </p>
                  </div>
                </Card>
              )}
            </div>

            <button
              type="button"
              aria-label="오른쪽 패널 너비 조절"
              className="group flex min-h-0 cursor-col-resize items-stretch"
              onMouseDown={() => setResizingPane("right")}
            >
              <span className="mx-auto my-2 w-1.5 rounded-full bg-[rgba(23,34,47,0.14)] transition group-hover:bg-[rgba(194,100,45,0.45)] group-active:bg-[rgba(194,100,45,0.7)]" />
            </button>

            {renderAiPanel("min-h-0")}
          </div>
        )}
      </div>
    </div>
  );
}
