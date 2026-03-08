import { exportLibraryBibtex } from "@/lib/papers/service";

export const runtime = "nodejs";

export async function GET() {
  const content = await exportLibraryBibtex();
  return new Response(content, {
    headers: {
      "Content-Type": "application/x-bibtex; charset=utf-8",
      "Content-Disposition": 'attachment; filename="gradme-library.bib"',
    },
  });
}
