import { streamSummary } from "@/lib/ai/service";
import { createSseResponse } from "@/lib/server/http";
import { profileSelectionSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = profileSelectionSchema.parse(await request.json());

  return createSseResponse(async (send) => {
    await streamSummary({
      paperId: id,
      profileId: body.profileId,
      force: body.force,
      callbacks: {
        onDelta: async (delta) => {
          send("delta", { delta });
        },
        onComplete: async (artifact) => {
          send("done", { artifact });
        },
        onError: async (message, artifact) => {
          send("error", { message, artifact });
        },
      },
    });
  });
}
