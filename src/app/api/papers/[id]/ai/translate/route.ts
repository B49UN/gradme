import { generateTranslation } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";
import { profileSelectionSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = profileSelectionSchema.parse(await request.json());
    return generateTranslation(id, body.profileId, body.force);
  });
}
