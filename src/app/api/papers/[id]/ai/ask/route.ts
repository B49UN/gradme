import { generateFocusAnalysis, generateQa, persistSelectionPreview } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";
import { questionSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = questionSchema.parse(await request.json());
    let selectionRef = body.selectionRef ?? null;

    if (
      selectionRef?.type === "area" &&
      body.selectionPreviewDataUrl
    ) {
      selectionRef = {
        ...selectionRef,
        imagePath: await persistSelectionPreview(body.selectionPreviewDataUrl),
      };
    }

    if (body.focusKind) {
      return generateFocusAnalysis({
        paperId: id,
        profileId: body.profileId,
        kind: body.focusKind,
        force: body.force,
      });
    }

    return generateQa({
      paperId: id,
      profileId: body.profileId,
      question: body.question,
      selection: selectionRef,
      force: body.force,
    });
  });
}
