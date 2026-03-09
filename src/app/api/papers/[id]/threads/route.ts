import { createAskThread } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";
import { threadCreateSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = threadCreateSchema.parse(await request.json().catch(() => ({})));
    return createAskThread(id, body.title);
  });
}
