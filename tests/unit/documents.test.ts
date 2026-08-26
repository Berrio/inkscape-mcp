import { describe, expect, it } from "vitest";
import {
  addSvgPage,
  createSvgDocument,
  deleteSvgPage,
  inspectSvgSettings,
  inspectDocumentDisplaySettings,
  listSvgPages,
  pageSizeFromPreset,
  reorderSvgPages,
  resizePageOnlySvg,
  updateSvgPage,
  updateDocumentDisplaySettings,
} from "../../src/documents/index.js";
import { preflightSvg } from "../../src/documents/index.js";
const mm = (value: number) => ({ unit: "mm" as const, value });
describe("basic SVG documents", () => {
  it("provides immutable, versioned named page sizes", () => {
    const a4 = pageSizeFromPreset("a4-portrait");
    a4.width.value = 1;
    expect(pageSizeFromPreset("a4-portrait")).toEqual({
      height: mm(297),
      width: mm(210),
    });
  });
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
  it("round-trips explicit Inkscape pages by stable ID", () => {
    const source = createSvgDocument({
      page: { width: mm(210), height: mm(297) },
    });
    const first = addSvgPage(source, {
      height: 297,
      id: "page-a",
      width: 210,
      x: 0,
      y: 0,
    });
    const second = addSvgPage(first.svg, {
      height: 210,
      id: "page-b",
      label: "Back",
      width: 148,
      x: 220,
      y: 0,
    });
    const updated = updateSvgPage(second.svg, "page-b", { x: 230 });
    expect(listSvgPages(updated.svg)).toEqual([
      { height: 297, id: "page-a", width: 210, x: 0, y: 0 },
      { height: 210, id: "page-b", label: "Back", width: 148, x: 230, y: 0 },
    ]);
    expect(
      listSvgPages(reorderSvgPages(updated.svg, ["page-b", "page-a"])).map(
        (page) => page.id,
      ),
    ).toEqual(["page-b", "page-a"]);
    expect(
      listSvgPages(deleteSvgPage(updated.svg, "page-a")).map((page) => page.id),
    ).toEqual(["page-b"]);
  });
  it("reads defaults and persists typed Inkscape document display settings", () => {
    const source = createSvgDocument({
      page: { width: mm(210), height: mm(297) },
    });
    expect(inspectDocumentDisplaySettings(source).pageColor).toBe("#ffffff");
    const changed = updateDocumentDisplaySettings(source, {
      borderColor: "#112233",
      borderOpacity: 0.25,
      deskColor: "#445566",
      pageColor: "#abcdef",
      pageOpacity: 0.5,
    });
    expect(changed.settings).toEqual({
      borderColor: "#112233",
      borderOpacity: 0.25,
      deskColor: "#445566",
      pageColor: "#abcdef",
      pageOpacity: 0.5,
    });
  });
});
