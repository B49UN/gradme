import { createAnnotation } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { annotationSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  return withRouteError(async () => {
    const body = annotationSchema.parse(await request.json());
    return createAnnotation({
      paperId: id,
      ...body,
    });
  });
}
