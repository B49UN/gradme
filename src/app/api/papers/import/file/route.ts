import { importPaperFromFile } from "@/lib/papers/service";
import { jsonError, withRouteError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return jsonError("PDF 파일이 필요합니다.");
  }

  return withRouteError(() => importPaperFromFile(file));
}
