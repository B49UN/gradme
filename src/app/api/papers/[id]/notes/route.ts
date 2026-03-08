import { createNote } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { noteSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = noteSchema.parse(await request.json());
    return createNote({
      paperId: id,
      ...body,
    });
  });
}
