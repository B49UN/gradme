import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";

describe("normalizeMathDelimiters", () => {
  it("converts inline and display latex delimiters into remark-math style", () => {
    const normalized = normalizeMathDelimiters(
      "속도는 \\(v = \\frac{x}{t}\\) 이고,\n\\[F = ma\\]\n로 쓴다.",
    );

    expect(normalized).toContain("$v = \\frac{x}{t}$");
    expect(normalized).toContain("$$\nF = ma\n$$");
  });
});
