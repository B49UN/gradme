import { describe, expect, it } from "vitest";
import { exportBibtex, paperToBibtex } from "@/lib/papers/bibtex";
import type { PaperRecord } from "@/lib/types";

const basePaper: PaperRecord = {
  id: "paper-1",
  title: "AIAA-style Guidance Paper",
  authors: ["Jane Doe", "John Roe"],
  venue: "Journal of Guidance",
  year: 2025,
  doi: "10.2514/1.J057395",
  arxivId: null,
  abstract: null,
  status: "new",
  favorite: false,
  hash: "hash",
  storagePath: "/tmp/paper.pdf",
  thumbnailPath: null,
  fullText: "",
  pageCount: 12,
  createdAt: "2026-03-08T00:00:00.000Z",
  updatedAt: "2026-03-08T00:00:00.000Z",
};

describe("bibtex export", () => {
  it("formats a paper as a bibtex article", () => {
    const output = paperToBibtex(basePaper);
    expect(output).toContain("@article{doe2025,");
    expect(output).toContain("title = {AIAA-style Guidance Paper}");
    expect(output).toContain("doi = {10.2514/1.J057395}");
  });

  it("exports multiple records with spacing", () => {
    const output = exportBibtex([basePaper, { ...basePaper, id: "paper-2", title: "Second" }]);
    expect(output.split("@article").length - 1).toBe(2);
    expect(output).toContain("Second");
  });
});
