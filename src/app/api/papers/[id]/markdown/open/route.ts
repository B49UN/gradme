import { openPaperMarkdownFolder } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(() => openPaperMarkdownFolder(id));
}
