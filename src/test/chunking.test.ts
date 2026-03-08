import { describe, expect, it } from "vitest";
import { detectDoi, splitIntoChunks } from "@/lib/papers/chunking";

describe("paper chunking", () => {
  it("detects DOI tokens from extracted text", () => {
    expect(
      detectDoi("This work extends prior art. DOI: 10.2514/1.J057395 and related references."),
    ).toBe("10.2514/1.J057395");
  });

  it("splits sections by likely headings", () => {
    const chunks = splitIntoChunks([
      {
        pageNumber: 1,
        text: "Abstract\n\nThis is the abstract.\n\n1 Introduction\n\nIntro body.",
      },
      {
        pageNumber: 2,
        text: "2 Methodology\n\nMethod body.\n\n3 Results\n\nResults body.",
      },
    ]);

    expect(chunks).toHaveLength(4);
    expect(chunks[0]?.heading).toBe("Abstract");
    expect(chunks[1]?.heading).toBe("1 Introduction");
    expect(chunks[2]?.heading).toBe("2 Methodology");
    expect(chunks[3]?.heading).toBe("3 Results");
  });
});
