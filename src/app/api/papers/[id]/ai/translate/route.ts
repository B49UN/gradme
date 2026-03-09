import { generateTranslation } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";
import { translationRequestSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = translationRequestSchema.parse(await request.json());
    return generateTranslation({
      paperId: id,
      profileId: body.profileId,
      force: body.force,
      pageStart: body.pageStart,
      pageEnd: body.pageEnd,
    });
  });
}
