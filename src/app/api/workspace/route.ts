import { getWorkspaceSnapshot } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const paperId = searchParams.get("paper");

  return withRouteError(() => getWorkspaceSnapshot(paperId));
}
