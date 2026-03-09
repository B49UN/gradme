import {
  persistSelectionPreview,
  streamFocusAnalysis,
  streamQa,
} from "@/lib/ai/service";
import { createSseResponse } from "@/lib/server/http";
import { questionSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = questionSchema.parse(await request.json());
  let selectionRef = body.selectionRef ?? null;

  if (selectionRef?.type === "area" && body.selectionPreviewDataUrl) {
    selectionRef = {
      ...selectionRef,
      imagePath: await persistSelectionPreview(body.selectionPreviewDataUrl),
    };
  }

  return createSseResponse(async (send) => {
    const callbacks = {
      onStart: async (payload: { artifact: unknown; thread: unknown }) => {
        send("start", payload);
      },
      onDelta: async (delta: string) => {
        send("delta", { delta });
      },
      onComplete: async (payload: unknown) => {
        send("done", payload);
      },
      onError: async (payload: { message: string; result: unknown }) => {
        send("error", payload);
      },
    };

    if (body.focusKind) {
      await streamFocusAnalysis({
        paperId: id,
        profileId: body.profileId,
        kind: body.focusKind,
        threadId: body.threadId,
        callbacks,
      });
      return;
    }

    await streamQa({
      paperId: id,
      profileId: body.profileId,
      question: body.question,
      selection: selectionRef,
      threadId: body.threadId,
      callbacks,
    });
  });
}
