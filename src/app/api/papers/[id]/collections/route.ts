import { setPaperCollections } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { paperCollectionsSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = paperCollectionsSchema.parse(await request.json());
    return setPaperCollections(id, body.collectionIds);
  });
}
