import { deleteAnnotation } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; annotationId: string }> },
) {
  const { id, annotationId } = await params;

  return withRouteError(() => deleteAnnotation(id, annotationId));
}
