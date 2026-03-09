import { deleteNote } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;

  return withRouteError(() => deleteNote(id, noteId));
}
