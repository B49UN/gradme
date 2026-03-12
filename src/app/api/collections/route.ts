import { createCollection } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { collectionCreateSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRouteError(async () => {
    const body = collectionCreateSchema.parse(await request.json());
    return createCollection(body.name);
  });
}
