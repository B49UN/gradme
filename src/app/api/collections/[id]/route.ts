import { deleteCollection } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(() => deleteCollection(id));
}
