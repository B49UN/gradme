import { jsonError, jsonOk } from "@/lib/server/http";
import { getPaperDetail, readPaperAsset } from "@/lib/papers/service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get("asset");

  if (asset === "pdf" || asset === "thumbnail") {
    const file = await readPaperAsset(id, asset);

    if (!file) {
      return jsonError("문서 자산을 찾지 못했습니다.", 404);
    }

    return new Response(file.buffer, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${file.fileName}"`,
      },
    });
  }

  try {
    const detail = await getPaperDetail(id);

    if (!detail) {
      return jsonError("논문을 찾지 못했습니다.", 404);
    }

    return jsonOk(detail);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "논문 정보를 불러오지 못했습니다.",
      400,
    );
  }
}
