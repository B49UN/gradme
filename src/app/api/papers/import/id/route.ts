import { importPaperFromIdentifier } from "@/lib/papers/service";
import { withRouteError } from "@/lib/server/http";
import { identifierImportSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRouteError(async () => {
    const body = identifierImportSchema.parse(await request.json());
    return importPaperFromIdentifier(body.identifier);
  });
}
