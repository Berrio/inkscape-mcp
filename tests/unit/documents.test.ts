import { describe, expect, it } from "vitest";
import {
  createSvgDocument,
  inspectSvgSettings,
  resizePageOnlySvg,
} from "../../src/documents/index.js";
import { preflightSvg } from "../../src/documents/index.js";
const mm = (value: number) => ({ unit: "mm" as const, value });
describe("basic SVG documents", () => {
  it("creates an A4 SVG with a coherent viewBox", () => {
    const svg = createSvgDocument({
      page: { width: mm(210), height: mm(297) },
    });
    expect(inspectSvgSettings(svg)).toEqual({
      width: "210mm",
      height: "297mm",
      viewBox: { x: 0, y: 0, width: 210, height: 297 },
    });
  });
  it("changes page/viewBox without transforming document elements", () => {
    const source = `${createSvgDocument({ page: { width: mm(210), height: mm(297) } }).replace("</svg>", '<rect id="keep" x="10" y="20" width="30" height="40"/></svg>')}`;
    const result = resizePageOnlySvg(
      source,
      { width: mm(210), height: mm(297) },
      { width: mm(148), height: mm(210) },
    );
    expect(result.svg).toContain(
      'id="keep" x="10" y="20" width="30" height="40"',
    );
    expect(inspectSvgSettings(result.svg).viewBox).toEqual({
      x: 0,
      y: 0,
      width: 148,
      height: 210,
    });
  });
  it("reports active content and external resources without mutating SVG", () => {
    const result = preflightSvg(
      '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><script/><image href="https://example.test/a.png"/></svg>',
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "SVG_ACTIVE_CONTENT",
      "SVG_EXTERNAL_RESOURCE",
    ]);
  });
});
