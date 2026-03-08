import { listProfiles, saveProfile } from "@/lib/ai/service";
import { withRouteError } from "@/lib/server/http";
import { modelProfileSchema } from "@/lib/server/schemas";

export const runtime = "nodejs";

export async function GET() {
  return withRouteError(() => listProfiles());
}

export async function POST(request: Request) {
  return withRouteError(async () => {
    const body = modelProfileSchema.parse(await request.json());
    return saveProfile(body);
  });
}
