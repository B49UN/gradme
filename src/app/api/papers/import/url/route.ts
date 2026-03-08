import { importPaperFromUrl } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { urlImportSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRouteError(async () => {
    const body = urlImportSchema.parse(await request.json());
    return importPaperFromUrl(body.url);
  });
}
