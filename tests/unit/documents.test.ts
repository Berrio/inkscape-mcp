import { describe, expect, it } from "vitest";
import {
  addSvgPage,
  arrangeSvgShapes,
  createSvgDocument,
  createSvgShapes,
  groupSvgShapes,
  deleteSvgPage,
  deleteSvgShapes,
  inspectSvgSettings,
  inspectDocumentDisplaySettings,
  inspectSvgInventory,
  listSvgPages,
  pageSizeFromPreset,
  querySvgElements,
  reorderSvgPages,
  resizePageOnlySvg,
  resizeContentSvg,
  updateSvgPage,
  updateDocumentDisplaySettings,
  transformSvgShapes,
  updateSvgShapes,
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
  it("refuses to resize SVG that needs sanitization", () => {
    expect(() =>
      resizePageOnlySvg(
        '<svg width="1px" height="1px" viewBox="0 0 1 1"><script/></svg>',
        { width: { unit: "px", value: 1 }, height: { unit: "px", value: 1 } },
        { width: { unit: "px", value: 2 }, height: { unit: "px", value: 2 } },
      ),
    ).toThrow("SVG must be sanitized before resizing");
  });
  it("wraps only renderable root content for contain and preserves defs", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800px" height="600px" viewBox="0 0 800 600"><defs><linearGradient id="keep"/></defs><rect id="shape" width="800" height="600"/></svg>';
    const result = resizeContentSvg(
      source,
      { width: { unit: "px", value: 800 }, height: { unit: "px", value: 600 } },
      {
        width: { unit: "px", value: 1080 },
        height: { unit: "px", value: 1080 },
      },
      "scale_content_contain",
    );
    expect(result.svg).toContain('<defs><linearGradient id="keep"/></defs>');
    expect(result.svg).toContain('transform="matrix(1.35 0 0 1.35 0 135)"');
    expect(result.svg).toContain(
      '<g transform="matrix(1.35 0 0 1.35 0 135)"><rect id="shape"',
    );
    expect(
      resizeContentSvg(
        source,
        {
          width: { unit: "px", value: 800 },
          height: { unit: "px", value: 600 },
        },
        {
          width: { unit: "px", value: 1080 },
          height: { unit: "px", value: 1080 },
        },
        "scale_content_cover",
      ).warnings,
    ).toContain("CONTENT_MAY_BE_CROPPED");
    const stretched = resizeContentSvg(
      source,
      {
        width: { unit: "px", value: 800 },
        height: { unit: "px", value: 600 },
      },
      {
        width: { unit: "px", value: 1080 },
        height: { unit: "px", value: 1080 },
      },
      "scale_content_stretch",
    );
    expect(stretched.svg).toContain("matrix(1.35 0 0 1.8 0 0)");
    expect(stretched.warnings).toContain("NON_UNIFORM_CONTENT_SCALE");
  });
  it("reports active content and external resources without mutating SVG", () => {
    const result = preflightSvg(
      '<svg width="1mm" height="1mm" viewBox="0 0 1 1"><script/><image href="https://example.test/a.png"/></svg>',
      "web",
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "SVG_ACTIVE_CONTENT",
      "SVG_EXTERNAL_RESOURCE",
      "SVG_MISSING_TITLE",
    ]);
    expect(result.profile).toBe("web");
    expect(result.issues.every((issue) => issue.remediation.length > 0)).toBe(
      true,
    );
  });
  it("summarizes IDs, layers, images and unresolved references without paths", () => {
    const inventory = inspectSvgInventory(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:custom="urn:custom" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"><defs><linearGradient id="gradient"/></defs><g id="layer" inkscape:groupmode="layer" inkscape:label="Layer" sodipodi:insensitive="true" style="display:none"><rect id="same" fill="url(#gradient)" stroke="#000000" opacity="0.5" filter="url(#blur)" style="font-family: Arial, NotoSans"/><use href="#missing"/></g><image href="data:image/png;base64,AA=="/><image href="https://example.test/image.png"/><circle id="same"/></svg>',
    );
    expect(inventory).toMatchObject({
      duplicateIds: ["same"],
      externalResourceCount: 2,
      fontFamilies: ["Arial", "NotoSans"],
      fontResolution: "unavailable",
      ids: ["gradient", "layer", "same", "same"],
      unknownNamespaces: ["urn:custom"],
      unresolvedReferences: ["missing"],
      paintUsage: {
        fills: 1,
        filters: 1,
        gradients: 1,
        opacities: 1,
        patterns: 0,
        strokes: 1,
      },
    });
    expect(inventory.images).toEqual([
      { kind: "embedded" },
      { kind: "external" },
    ]);
    expect(inventory.layers).toEqual([
      { id: "layer", label: "Layer", locked: true, visibility: "hidden" },
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
  it("creates a bounded batch of typed basic SVG shapes", () => {
    const source = createSvgDocument({
      page: { width: mm(210), height: mm(297) },
    });
    const created = createSvgShapes(source, [
      { id: "layer_main", kind: "layer", label: "Main" },
      {
        height: 20,
        id: "rect_1",
        kind: "rect",
        parentId: "layer_main",
        style: { fill: "#ff0000", stroke: "#000000", strokeWidth: 2 },
        width: 30,
        x: 10,
        y: 15,
      },
      {
        cx: 50,
        cy: 60,
        id: "circle_1",
        kind: "circle",
        parentId: "layer_main",
        r: 10,
      },
      {
        cx: 40,
        cy: 40,
        id: "star_1",
        kind: "star",
        points: 5,
        r1: 10,
        r2: 5,
      },
      {
        d: "M 0 0 L 10 20 A 5 5 0 0 1 20 20 Z",
        id: "path_1",
        kind: "path",
      },
      {
        id: "text_1",
        kind: "text",
        parentId: "layer_main",
        style: { fontFamily: "Arial", fontSize: 12, fontWeight: "bold" },
        spans: [{ dx: 2, text: " World" }],
        text: "Hello SVG",
        x: 5,
        y: 100,
      },
      {
        id: "polyline_1",
        kind: "polyline",
        parentId: "layer_main",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
      },
    ]);
    expect(created.ids).toEqual([
      "layer_main",
      "rect_1",
      "circle_1",
      "star_1",
      "path_1",
      "text_1",
      "polyline_1",
    ]);
    expect(created.svg).toContain('id="rect_1" fill="#ff0000"');
    expect(created.svg).toContain('points="0,0 10,20"');
    expect(created.svg).toContain('id="star_1"');
    expect(created.svg).toContain('d="M 0 0 L 10 20 A 5 5 0 0 1 20 20 Z"');
    expect(created.svg).toContain('font-family="Arial"');
    expect(created.svg).toContain(
      '>Hello SVG<tspan dx="2"> World</tspan></text>',
    );
    expect(created.svg).toContain('inkscape:groupmode="layer"');
    expect(() =>
      createSvgShapes(created.svg, [
        { height: 1, id: "rect_1", kind: "rect", width: 1, x: 0, y: 0 },
      ]),
    ).toThrow("already exists");
    expect(deleteSvgShapes(created.svg, ["circle_1"]).deletedIds).toEqual([
      "circle_1",
    ]);
    expect(() =>
      deleteSvgShapes(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect id="shape"/><use href="#shape"/></svg>',
        ["shape"],
      ),
    ).toThrow("would break an SVG reference");
    const transformed = transformSvgShapes(created.svg, ["rect_1"], {
      kind: "translate",
      x: 4,
      y: -2,
    });
    expect(transformed.svg).toContain('transform="translate(4 -2)"');
    expect(() =>
      transformSvgShapes(created.svg, ["rect_1"], {
        a: 1,
        b: 0,
        c: 0,
        d: 0,
        e: 0,
        f: 0,
        kind: "matrix",
      }),
    ).toThrow("invertible");
    const updated = updateSvgShapes(created.svg, [
      {
        geometry: { kind: "rect", width: 35, x: 12 },
        id: "rect_1",
        style: { fill: "#00ff00", opacity: 0.5 },
      },
      {
        geometry: { kind: "text", y: 105 },
        id: "text_1",
        text: "Updated SVG",
      },
      { id: "layer_main", label: "Updated Main" },
    ]);
    expect(updated.svg).toContain('x="12"');
    expect(updated.svg).toContain('width="35"');
    expect(updated.svg).toContain('fill="#00ff00"');
    expect(updated.svg).toContain('opacity="0.5"');
    expect(updated.svg).toContain('y="105"');
    expect(updated.svg).toContain(">Updated SVG</text>");
    expect(updated.svg).toContain('inkscape:label="Updated Main"');
    expect(() =>
      updateSvgShapes(created.svg, [{ id: "rect_1", text: "Not text" }]),
    ).toThrow("only update a text element");
    expect(() =>
      createSvgShapes(created.svg, [{ d: "M 0", kind: "path" }]),
    ).toThrow("incomplete");
    const arranged = arrangeSvgShapes(created.svg, ["rect_1"], "front");
    expect(arranged.svg.indexOf('id="polyline_1"')).toBeLessThan(
      arranged.svg.indexOf('id="rect_1"'),
    );
    expect(() =>
      arrangeSvgShapes(created.svg, ["rect_1", "circle_1"], "raise"),
    ).toThrow("exactly one ID");
    const grouped = groupSvgShapes(created.svg, {
      action: "group",
      groupId: "shape_group",
      ids: ["rect_1", "circle_1"],
    });
    expect(grouped.svg).toContain('<g id="shape_group"><rect');
    expect(
      groupSvgShapes(grouped.svg, { action: "ungroup", groupId: "shape_group" })
        .svg,
    ).not.toContain('id="shape_group"');
  });
  it("queries typed element summaries by layer, kind, and bounded offset", () => {
    const source = createSvgShapes(
      createSvgDocument({ page: { width: mm(10), height: mm(10) } }),
      [
        { id: "layer_main", kind: "layer", label: "Main" },
        {
          height: 2,
          id: "rect_1",
          kind: "rect",
          parentId: "layer_main",
          width: 3,
          x: 1,
          y: 2,
        },
      ],
    ).svg;
    expect(
      querySvgElements(source, {
        ids: ["missing", "rect_1"],
        layerId: "layer_main",
        limit: 10,
        offset: 0,
      }),
    ).toEqual({
      elements: [
        {
          attributes: { height: "2", width: "3", x: "1", y: "2" },
          id: "rect_1",
          kind: "rect",
          layerId: "layer_main",
          parentId: "layer_main",
        },
      ],
      missingIds: ["missing"],
      total: 1,
    });
  });
});
