import type { PaperRecord } from "@/lib/types";

function bibtexSafe(text: string | null | undefined) {
  return (text ?? "").replace(/[{}]/g, "").trim();
}

function buildBibtexKey(paper: PaperRecord) {
  const firstAuthor = paper.authors[0]?.split(" ").at(-1)?.toLowerCase() ?? "paper";
  const year = paper.year ?? "nd";
  return `${firstAuthor}${year}`;
}

export function paperToBibtex(paper: PaperRecord) {
  const lines = [
    `@article{${buildBibtexKey(paper)},`,
    `  title = {${bibtexSafe(paper.title)}},`,
    `  author = {${paper.authors.map((author) => bibtexSafe(author)).join(" and ")}},`,
  ];

  if (paper.venue) {
    lines.push(`  journal = {${bibtexSafe(paper.venue)}},`);
  }

  if (paper.year) {
    lines.push(`  year = {${paper.year}},`);
  }

  if (paper.doi) {
    lines.push(`  doi = {${paper.doi}},`);
  }

  if (paper.arxivId) {
    lines.push(`  eprint = {${paper.arxivId}},`);
    lines.push(`  archivePrefix = {arXiv},`);
  }

  lines.push("}");
  return lines.join("\n");
}

export function exportBibtex(papers: PaperRecord[]) {
  return papers.map((paper) => paperToBibtex(paper)).join("\n\n");
}
