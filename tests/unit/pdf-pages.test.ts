import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { listSvgPages } from "../../src/documents/index.js";
import { pruneSvgPagesForPdf } from "../../src/export/index.js";

const fixture = readFileSync(
  resolve(process.cwd(), "tests", "fixtures", "pdf-multipage.svg"),
  "utf8",
);

describe("PDF page pruning", () => {
  it("keeps only requested page IDs in the requested order", () => {
    const result = pruneSvgPagesForPdf(fixture, ["page_extra", "page_back"]);
    expect(result.pageIds).toEqual(["page_extra", "page_back"]);
    expect(listSvgPages(result.svg).map((page) => page.id)).toEqual([
      "page_extra",
      "page_back",
    ]);
  });

  it("rejects invalid, duplicate and missing page IDs", () => {
    expect(() => pruneSvgPagesForPdf(fixture, ["missing"])).toThrow(
      "does not exist",
    );
    expect(() =>
      pruneSvgPagesForPdf(fixture, ["page_back", "page_back"]),
    ).toThrow("invalid");
  });
});
