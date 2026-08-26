import { describe, expect, it } from "vitest";
import {
  addSvgPage,
  adjustPageMarginsSvg,
  expandPdfMarginsSvg,
  arrangeSvgShapes,
  createSvgDocument,
  changePageOrientationSvg,
  createSvgShapes,
  groupSvgShapes,
  fitPageToBoundsSvg,
  deleteSvgPage,
  deleteSvgShapes,
  inspectSvgSettings,
  inspectDocumentDisplaySettings,
  inspectSvgInventory,
  listSvgPages,
  pageSizeFromPreset,
  querySvgElements,
  querySvgElementTargets,
  reorderSvgPages,
  resizePageOnlySvg,
  resizeContentSvg,
  updateSvgPage,
  updateDocumentDisplaySettings,
  transformSvgShapes,
  updateSvgShapes,
  validateSvgPageLayout,
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
      ambiguousViewport: false,
      width: "210mm",
      height: "297mm",
      normalization: {
        height: { raw: "297mm", source: "explicit" },
        viewBox: "explicit",
        width: { raw: "210mm", source: "explicit" },
      },
      viewBox: { x: 0, y: 0, width: 210, height: 297 },
      warnings: [],
    });
  });
  it("normalizes missing dimensions and viewBox with explicit warnings", () => {
    expect(inspectSvgSettings('<svg viewBox="-5 2 40 30"/>')).toEqual({
      ambiguousViewport: false,
      height: "150px",
      normalization: {
        height: { source: "defaulted" },
        viewBox: "explicit",
        width: { source: "defaulted" },
      },
      viewBox: { x: -5, y: 2, width: 40, height: 30 },
      warnings: ["VIEWPORT_WIDTH_DEFAULTED", "VIEWPORT_HEIGHT_DEFAULTED"],
      width: "300px",
    });
    const inferred = inspectSvgSettings('<svg width="25.4mm" height="96"/>');
    expect(inferred).toMatchObject({
      ambiguousViewport: false,
      height: "96px",
      normalization: {
        height: { raw: "96", source: "explicit" },
        viewBox: "inferred_from_viewport",
        width: { raw: "25.4mm", source: "explicit" },
      },
      width: "25.4mm",
    });
    expect(inferred.viewBox).toMatchObject({ x: 0, y: 0 });
    expect(inferred.viewBox.width).toBeCloseTo(96);
    expect(inferred.viewBox.height).toBeCloseTo(96);
    expect(inferred.warnings).toEqual([
      "VIEWPORT_HEIGHT_UNITLESS_NORMALIZED",
      "VIEWBOX_MISSING_INFERRED_FROM_VIEWPORT",
    ]);
  });
  it("reports percentage viewport dimensions as ambiguous and refuses resize", () => {
    const source = '<svg width="100%" height="50%" viewBox="0 0 20 10"/>';
    expect(inspectSvgSettings(source)).toMatchObject({
      ambiguousViewport: true,
      height: "150px",
      normalization: {
        height: { raw: "50%", source: "percentage_fallback" },
        width: { raw: "100%", source: "percentage_fallback" },
      },
      width: "300px",
    });
    expect(preflightSvg(source).issues.map((issue) => issue.code)).toEqual([
      "VIEWPORT_WIDTH_PERCENTAGE_UNRESOLVED",
      "VIEWPORT_HEIGHT_PERCENTAGE_UNRESOLVED",
    ]);
    expect(() =>
      resizePageOnlySvg(
        source,
        {
          width: { unit: "px", value: 300 },
          height: { unit: "px", value: 150 },
        },
        {
          width: { unit: "px", value: 200 },
          height: { unit: "px", value: 100 },
        },
      ),
    ).toThrow("percentages require explicit normalization");
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
  it("fits a page to visual bounds with independent margins without moving objects", () => {
    const source =
      '<svg width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="keep" x="10" y="5" width="30" height="20"/></svg>';
    const fitted = fitPageToBoundsSvg(
      source,
      { width: mm(100), height: mm(50) },
      { x: 10, y: 5, width: 30, height: 20 },
      {
        bottom: mm(3),
        left: mm(5),
        right: mm(5),
        top: mm(2),
      },
      "mm",
    );
    expect(fitted.page.width).toMatchObject({ unit: "mm" });
    expect(fitted.page.width.value).toBeCloseTo(40);
    expect(fitted.page.height).toMatchObject({ unit: "mm" });
    expect(fitted.page.height.value).toBeCloseTo(25);
    const fittedViewBox = inspectSvgSettings(fitted.svg).viewBox;
    expect(fittedViewBox.x).toBeCloseTo(5);
    expect(fittedViewBox.y).toBeCloseTo(3);
    expect(fittedViewBox.width).toBeCloseTo(40);
    expect(fittedViewBox.height).toBeCloseTo(25);
    expect(fitted.svg).toContain('id="keep" x="10" y="5" width="30"');
    expect(fitted.warnings).toContain("FIT_USED_VISUAL_BOUNDS");
  });
  it("crops, expands and swaps orientation without transforming objects", () => {
    const source =
      '<svg width="100px" height="100px" viewBox="0 0 100 100"><rect id="keep" x="10" y="10" width="20" height="20"/></svg>';
    const margins = {
      bottom: { unit: "px" as const, value: 5 },
      left: { unit: "px" as const, value: 10 },
      right: { unit: "px" as const, value: 20 },
      top: { unit: "px" as const, value: 5 },
    };
    const cropped = adjustPageMarginsSvg(
      source,
      { width: { unit: "px", value: 100 }, height: { unit: "px", value: 100 } },
      margins,
      "crop",
    );
    expect(cropped.page).toEqual({
      width: { unit: "px", value: 70 },
      height: { unit: "px", value: 90 },
    });
    expect(inspectSvgSettings(cropped.svg).viewBox).toEqual({
      x: 10,
      y: 5,
      width: 70,
      height: 90,
    });
    expect(cropped.warnings).toContain("PAGE_CROPPED");
    const expanded = adjustPageMarginsSvg(
      source,
      { width: { unit: "px", value: 100 }, height: { unit: "px", value: 100 } },
      margins,
      "expand",
    );
    expect(inspectSvgSettings(expanded.svg).viewBox).toEqual({
      x: -10,
      y: -5,
      width: 130,
      height: 110,
    });
    const oriented = changePageOrientationSvg(
      '<svg width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="keep"/></svg>',
      { width: mm(100), height: mm(50) },
    );
    expect(oriented.page).toEqual({ width: mm(50), height: mm(100) });
    expect(inspectSvgSettings(oriented.svg).viewBox).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(oriented.svg).toContain('id="keep"');
    expect(oriented.warnings).toContain("PAGE_ORIENTATION_CHANGED");
  });
  it("expands PDF margins only in an export copy", () => {
    const source =
      '<svg width="100mm" height="50mm" viewBox="0 0 100 50"><rect id="keep" x="10" y="10" width="20" height="20"/></svg>';
    const result = expandPdfMarginsSvg(source, {
      bottom: mm(4),
      left: mm(5),
      right: mm(6),
      top: mm(3),
    });
    const viewBox = inspectSvgSettings(result.svg).viewBox;
    expect(viewBox.width).toBeCloseTo(111);
    expect(viewBox.height).toBeCloseTo(57);
    expect(viewBox.x).toBeCloseTo(-5);
    expect(viewBox.y).toBeCloseTo(-3);
    expect(result.svg).toContain('id="keep" x="10" y="10"');
    expect(result.warnings).toEqual(["PDF_MARGIN_EXPANDED_TEMPORARY"]);
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
      "SVG_MISSING_DESCRIPTION",
      "WEB_IMAGE_ACCESSIBLE_NAME_MISSING",
      "WEB_EXTERNAL_REFERENCE",
    ]);
    expect(result.profile).toBe("web");
    expect(result.issues.every((issue) => issue.remediation.length > 0)).toBe(
      true,
    );
  });
  it("reports four-sided print bleed, conservative DPI, fonts, filters and color limits", () => {
    const result = preflightSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><defs><filter id="blur"><feGaussianBlur/></filter></defs><text style="font-family: Forte">Label</text><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" width="100" height="100" filter="url(#blur)"/></svg>',
      "print",
      {
        bleed: {
          behavior: "expand-temporary-page",
          bottom: mm(2),
          left: mm(4),
          right: mm(3),
          top: mm(1),
        },
      },
    );
    expect(result.print).toEqual({
      bleed: {
        behavior: "expand-temporary-page",
        missingMm: { bottom: 2, left: 4, right: 3, top: 1 },
        presentMm: { bottom: 0, left: 0, right: 0, top: 0 },
        requiredMm: { bottom: 2, left: 4, right: 3, top: 1 },
      },
      images: { lowDpiCount: 1, measuredCount: 1, unavailableCount: 0 },
    });
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "SVG_EXTERNAL_RESOURCE",
      "PRINT_FONT_RESOLUTION_UNAVAILABLE",
      "PRINT_FILTER_RASTERIZATION_RISK",
      "PRINT_IMAGE_LOW_EFFECTIVE_DPI",
      "PRINT_COLOR_MANAGEMENT_UNVERIFIED",
    ]);
    expect(
      preflightSvg('<svg width="1px" height="1px"/>', "print").issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRINT_PHYSICAL_SIZE_UNSPECIFIED" }),
        expect.objectContaining({ code: "PRINT_BLEED_SPEC_REQUIRED" }),
      ]),
    );
    expect(
      preflightSvg('<svg width="1mm" height="1mm"/>', "print", {
        bleed: {
          behavior: "metadata-only",
          bottom: mm(0),
          left: mm(0),
          right: mm(0),
          top: mm(0),
        },
      }).print?.bleed?.requiredMm,
    ).toEqual({ bottom: 0, left: 0, right: 0, top: 0 });
  });
  it("detects Inkscape interchange features without opening external resources", () => {
    const result = preflightSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10mm" height="10mm" viewBox="0 0 10 10"><flowRoot/><path inkscape:path-effect="#effect"/><inkscape:path-effect id="effect"/><image href="https://example.test/image.png"/><meshgradient/></svg>',
      "interchange",
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "SVG_EXTERNAL_RESOURCE",
      "SVG_INKSCAPE_FEATURES",
      "INTERCHANGE_FLOW_TEXT",
      "INTERCHANGE_LIVE_PATH_EFFECT",
      "INTERCHANGE_EXTERNAL_REFERENCE",
      "INTERCHANGE_ADVANCED_SVG_FEATURE",
    ]);
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
      fontWarnings: ["FONT_RESOLUTION_UNAVAILABLE"],
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
      {
        display: {},
        intrinsic: { status: "unavailable" },
        kind: "embedded",
      },
      {
        display: {},
        intrinsic: { status: "unavailable" },
        kind: "external",
      },
    ]);
    expect(inventory.layers).toEqual([
      { id: "layer", label: "Layer", locked: true, visibility: "hidden" },
    ]);
  });
  it("inventories paint definitions and redacted image metadata without claiming font availability", () => {
    const inventory = inspectSvgInventory(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.title { font-family: Forte, serif; }</style><defs><linearGradient id="linear"><stop/><stop/></linearGradient><radialGradient id="radial"><stop/></radialGradient><pattern id="dots" width="4" height="5"/><filter id="soft"><feGaussianBlur/></filter></defs><rect fill="url(#linear)" stroke="url(#dots)" filter="url(#soft)" style="opacity: 0.4"/><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" width="20" height="10"/><image href="private/assets/secret.png" width="12"/></svg>',
    );
    expect(inventory.definitions).toEqual({
      filters: [{ id: "soft", primitiveCount: 1 }],
      gradients: [
        { id: "linear", kind: "linear", stopCount: 2 },
        { id: "radial", kind: "radial", stopCount: 1 },
      ],
      patterns: [{ id: "dots", width: "4", height: "5" }],
    });
    expect(inventory.fontFamilies).toEqual(["Forte", "serif"]);
    expect(inventory.fontWarnings).toEqual(["FONT_RESOLUTION_UNAVAILABLE"]);
    expect(inventory.images).toEqual([
      {
        display: { height: "10", width: "20" },
        intrinsic: { height: 1, status: "available", width: 1 },
        kind: "embedded",
      },
      {
        display: { width: "12" },
        intrinsic: { status: "unavailable" },
        kind: "linked",
      },
    ]);
    expect(JSON.stringify(inventory)).not.toContain(
      "private/assets/secret.png",
    );
  });
  it("paginates and filters inventory details with a bounded next offset", () => {
    const inventory = inspectSvgInventory(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="one"/><circle id="skip"/><rect id="two"/><rect id="three"/></svg>',
      { detailLimit: 2, kinds: ["rect"], offset: 1 },
    );
    expect(inventory).toMatchObject({
      elementCount: 3,
      ids: ["two", "three"],
      offset: 1,
      totalElementCount: 3,
      truncated: false,
      typeCounts: { rect: 3 },
    });
    expect(inventory.nextOffset).toBeUndefined();
    const firstPage = inspectSvgInventory(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="one"/><circle id="skip"/><rect id="two"/><rect id="three"/></svg>',
      { detailLimit: 2, kinds: ["rect"] },
    );
    expect(firstPage.nextOffset).toBe(2);
    expect(firstPage.truncated).toBe(true);
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
  it("reports overlapping and empty pages plus objects outside every page", () => {
    expect(
      validateSvgPageLayout(
        [
          { height: 20, id: "page-a", width: 20, x: 0, y: 0 },
          { height: 20, id: "page-b", width: 20, x: 10, y: 0 },
          { height: 10, id: "page-empty", width: 10, x: 40, y: 0 },
        ],
        [
          { height: 5, id: "inside", width: 5, x: 1, y: 1 },
          { height: 5, id: "outside", width: 5, x: 70, y: 1 },
        ],
      ),
    ).toEqual({
      emptyPageIds: ["page-b", "page-empty"],
      outsideObjectIds: ["outside"],
      overlaps: [
        {
          area: { height: 20, width: 10, x: 10, y: 0 },
          pageIds: ["page-a", "page-b"],
        },
      ],
    });
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

  it("creates a bounded standard SVG spiral path", () => {
    const source = createSvgDocument({
      page: { width: mm(20), height: mm(20) },
    });
    const result = createSvgShapes(source, [
      { cx: 10, cy: 10, id: "spiral_1", kind: "spiral", r: 8, turns: 2 },
    ]);
    expect(result.ids).toEqual(["spiral_1"]);
    expect(result.svg).toContain('id="spiral_1"');
    expect(result.svg).toContain('d="M 10 10 L');
    expect(result.svg).not.toContain("NaN");
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

  it("queries a strict CSS compound selector without accepting selector programs", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><g id="layer"><rect id="accent" class="card accent" x="1" y="2" width="3" height="4"/><rect id="plain" class="card"/></g></svg>';
    expect(
      querySvgElements(source, {
        limit: 10,
        offset: 0,
        selector: "rect.card.accent",
      }),
    ).toEqual({
      elements: [
        {
          attributes: {
            class: "card accent",
            height: "4",
            width: "3",
            x: "1",
            y: "2",
          },
          id: "accent",
          kind: "rect",
          parentId: "layer",
        },
      ],
      missingIds: [],
      total: 1,
    });
    expect(
      querySvgElements(source, {
        limit: 10,
        offset: 0,
        selector: "#missing",
      }),
    ).toEqual({ elements: [], missingIds: ["missing"], total: 0 });
    expect(() =>
      querySvgElements(source, {
        limit: 10,
        offset: 0,
        selector: "g .accent",
      }),
    ).toThrow("safe compound selector");
    expect(() =>
      querySvgElements(source, {
        limit: 10,
        offset: 0,
        selector: ".a.b.c.d.e.f.g.h.i",
      }),
    ).toThrow("class limit");
  });

  it("reports a cascade-aware computed style and declares unsupported CSS", () => {
    const result = querySvgElements(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>rect.card { fill: blue; stroke: #111; } #item { fill: green !important; } .outer .deep { opacity: 0; }</style><g fill="orange" font-family="Forte" font-weight="bold"><rect id="item" class="card" style="fill: purple; opacity: 0.4"/></g></svg>',
      { ids: ["item"], includeComputedStyle: true, limit: 10, offset: 0 },
    );
    expect(result.elements[0]?.computedStyle).toEqual({
      fidelity: "partial",
      limitations: ["CSS_SELECTOR_UNSUPPORTED"],
      properties: {
        fill: "green",
        "font-family": "Forte",
        "font-weight": "bold",
        opacity: "0.4",
        stroke: "#111",
      },
    });
  });

  it("bounds selector resource use before pagination", () => {
    const many = Array.from(
      { length: 10_001 },
      (_, index) => `<rect id="r_${index}" class="card"/>`,
    ).join("");
    expect(() =>
      querySvgElements(
        `<svg xmlns="http://www.w3.org/2000/svg">${many}</svg>`,
        {
          limit: 1,
          offset: 0,
          selector: ".card",
        },
      ),
    ).toThrow("match limit");

    const nested = "<g>".repeat(128) + "<rect/>" + "</g>".repeat(128);
    expect(() =>
      querySvgElements(
        `<svg xmlns="http://www.w3.org/2000/svg">${nested}</svg>`,
        { limit: 1, offset: 0, selector: "rect" },
      ),
    ).toThrow("depth limit");
  });

  it("retains an unsafe source ID only for native correlation", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="unsafe id,ñ" width="1" height="2"/></svg>';
    expect(
      querySvgElementTargets(source, {
        kinds: ["rect"],
        limit: 1,
        offset: 0,
      }),
    ).toEqual({
      elements: [
        {
          nativeId: "unsafe id,ñ",
          summary: {
            attributes: { height: "2", width: "1" },
            kind: "rect",
          },
        },
      ],
      missingIds: [],
      total: 1,
    });
  });
});
