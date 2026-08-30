import { describe, expect, it } from "vitest";
import {
  createSvgConnector,
  retargetSvgConnector,
  routeSvgConnector,
  addSvgPage,
  adjustPageMarginsSvg,
  expandPdfMarginsSvg,
  arrangeSvgShapes,
  breakApartSvgPath,
  combineSvgPaths,
  createSvgDocument,
  changePageOrientationSvg,
  createSvgShapes,
  flattenSvgShapeTransforms,
  duplicateSvgShape,
  reparentSvgShapes,
  reverseSvgPath,
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
  it("creates a typed Inkscape connector with explicit endpoints", () => {
    const result = createSvgConnector(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="from"/><rect id="to"/></svg>',
      {
        fromId: "from",
        id: "connector",
        points: [
          [0, 0],
          [5, 2],
          [10, 0],
        ],
        toId: "to",
      },
    );
    expect(result).toContain(
      'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
    );
    expect(result).toContain('id="connector"');
    expect(result).toContain('inkscape:connection-start="#from"');
    expect(result).toContain('inkscape:connection-end="#to"');
  });
  it("retargets a semantic connector without changing its route", () => {
    const result = retargetSvgConnector(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect id="from"/><rect id="to"/><rect id="next"/><path id="connector" d="M 0 0 L 5 2 L 10 0" inkscape:connector-type="polyline" inkscape:connection-start="#from" inkscape:connection-end="#to"/></svg>',
      "connector",
      "next",
      "to",
    );
    expect(result).toContain('inkscape:connection-start="#next"');
    expect(result).toContain('inkscape:connection-end="#to"');
    expect(result).toContain('d="M 0 0 L 5 2 L 10 0"');
    expect(() =>
      retargetSvgConnector(result, "connector", "next", "missing"),
    ).toThrow("endpoint ID");
  });

  it("routes semantic connectors through simple endpoint centers", () => {
    const result = routeSvgConnector(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect id="from" x="0" y="0" width="10" height="8" transform="translate(10 5) scale(2)"/><ellipse id="to" cx="30" cy="20" rx="5" ry="3"/><path id="connector" d="M 0 0 L 1 1" inkscape:connector-type="polyline"/></svg>',
      { axis: "horizontal-first", fromId: "from", id: "connector", toId: "to" },
    );
    expect(result.points).toEqual([
      [20, 13],
      [25, 13],
      [25, 20],
      [30, 20],
    ]);
    expect(result.svg).toContain('d="M 20 13 L 25 13 L 25 20 L 30 20"');
    expect(() =>
      routeSvgConnector(result.svg, {
        axis: "auto",
        fromId: "missing",
        id: "connector",
        toId: "to",
      }),
    ).toThrow("endpoint ID");
  });

  it("routes a connector around explicit simple obstacles", () => {
    const result = routeSvgConnector(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect id="from" x="0" y="0" width="10" height="10"/><rect id="barrier" x="18" y="0" width="8" height="10"/><rect id="to" x="40" y="0" width="10" height="10"/><path id="connector" d="M 0 0 L 1 1" inkscape:connector-type="polyline"/></svg>',
      {
        axis: "horizontal-first",
        clearance: 2,
        fromId: "from",
        id: "connector",
        obstacleIds: ["barrier"],
        toId: "to",
      },
    );
    expect(result.avoidedObstacleIds).toEqual(["barrier"]);
    expect(result.points[0]).toEqual([5, 5]);
    expect(result.points.at(-1)).toEqual([45, 5]);
    expect(
      result.points.some((point) => point[1] === -2 || point[1] === 12),
    ).toBe(true);
    expect(result.svg).toContain('inkscape:connection-start="#from"');
  });

  it("keeps compatible connectors attached when an endpoint is transformed or resized", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><rect id="from" x="0" y="0" width="10" height="10"/><rect id="to" x="20" y="0" width="10" height="10"/><path id="connector" d="M 5 5 L 25 5" inkscape:connector-type="polyline" inkscape:connection-start="#from" inkscape:connection-end="#to"/></svg>';
    const transformed = transformSvgShapes(source, ["to"], {
      kind: "translate",
      x: 10,
      y: 0,
    });
    expect(transformed.reroutedConnectorIds).toEqual(["connector"]);
    expect(transformed.svg).toContain('d="M 5 5 L 35 5"');
    const updated = updateSvgShapes(transformed.svg, [
      { geometry: { kind: "rect", x: 30 }, id: "from" },
    ]);
    expect(updated.reroutedConnectorIds).toEqual(["connector"]);
    expect(updated.svg).toContain('d="M 35 5"');
  });
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
    for (const sourceWithReference of [
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="effect"/></defs><rect filter="url(#effect)"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="clip"/></defs><style>.item { clip-path: url(#clip); }</style><rect class="item"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title id="label"/><rect aria-labelledby="label"/></svg>',
    ])
      expect(() =>
        deleteSvgShapes(sourceWithReference, [
          sourceWithReference.includes('id="effect"')
            ? "effect"
            : sourceWithReference.includes('id="clip"')
              ? "clip"
              : "label",
        ]),
      ).toThrow("would break an SVG reference");
    const transformed = transformSvgShapes(created.svg, ["rect_1"], {
      kind: "translate",
      x: 4,
      y: -2,
    });
    expect(transformed.svg).toContain('transform="translate(4 -2)"');
    const flattened = flattenSvgShapeTransforms(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="card" x="2" y="3" width="4" height="5" rx="1" transform="translate(10 20) scale(-2 3)"/></svg>',
      ["card"],
    );
    expect(flattened.flattenedIds).toEqual(["card"]);
    expect(flattened.svg).toContain(
      '<rect id="card" x="-2" y="29" width="8" height="15" rx="2"',
    );
    expect(flattened.svg).not.toContain("transform=");
    const translatedText = flattenSvgShapeTransforms(
      '<svg xmlns="http://www.w3.org/2000/svg"><text id="label" x="2" y="3" transform="matrix(1 0 0 1 5 -1)">Hi</text></svg>',
      ["label"],
    );
    expect(translatedText.svg).toContain('x="7" y="2"');
    const mirroredImage = flattenSvgShapeTransforms(
      '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" href="data:image/png;base64,AA==" x="1" y="2" width="3" height="4" transform="scale(2 -2)"/></svg>',
      ["photo"],
    );
    expect(mirroredImage.svg).toContain(
      '<image id="photo" href="data:image/png;base64,AA==" x="2" y="-12" width="6" height="8"',
    );
    const scaledStroke = flattenSvgShapeTransforms(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="stroke" x="0" y="0" width="2" height="2" stroke="#000000" stroke-width="2" transform="scale(3)"/></svg>',
      ["stroke"],
    );
    expect(scaledStroke.svg).toContain('stroke-width="6"');
    expect(() =>
      flattenSvgShapeTransforms(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect id="nonuniform-stroke" x="0" y="0" width="2" height="2" stroke="#000000" transform="scale(2 3)"/></svg>',
        ["nonuniform-stroke"],
      ),
    ).toThrow("non-uniformly scaled stroke");
    expect(() =>
      flattenSvgShapeTransforms(
        '<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(2 0)"><rect id="nested" x="0" y="0" width="2" height="2" transform="scale(2)"/></g></svg>',
        ["nested"],
      ),
    ).toThrow("inherited transform");
    expect(() =>
      flattenSvgShapeTransforms(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect id="rotated" x="0" y="0" width="2" height="2" transform="rotate(45)"/></svg>',
        ["rotated"],
      ),
    ).toThrow("only translate, scale and axis-aligned matrix");
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
    const combinedPaths = combineSvgPaths(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="left" fill="#ff0000" d="M 0 0 L 1 0"/><path id="right" fill="#ff0000" d="M 2 0 L 3 0"/></svg>',
      ["left", "right"],
    );
    expect(combinedPaths.removedIds).toEqual(["right"]);
    expect(combinedPaths.svg).toContain(
      'id="left" fill="#ff0000" d="M 0 0 L 1 0 M 2 0 L 3 0"',
    );
    expect(() =>
      combineSvgPaths(
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="left" fill="#ff0000" d="M 0 0 L 1 0"/><path id="right" fill="#0000ff" d="M 2 0 L 3 0"/></svg>',
        ["left", "right"],
      ),
    ).toThrow("identical presentation");
    expect(() =>
      combineSvgPaths(
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="left" d="M 0 0 L 1 0"/><path id="right" d="M 2 0 L 3 0"/><use href="#right"/></svg>',
        ["left", "right"],
      ),
    ).toThrow("reference");
    const brokenPaths = breakApartSvgPath(combinedPaths.svg, "left", [
      "part_one",
      "part_two",
    ]);
    expect(brokenPaths.ids).toEqual(["part_one", "part_two"]);
    expect(brokenPaths.svg).toContain('id="part_one"');
    expect(() =>
      breakApartSvgPath(
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="compound" d="M 0 0 L 1 0 M 2 0 L 3 0"/><use href="#compound"/></svg>',
        "compound",
        ["part_one", "part_two"],
      ),
    ).toThrow("reference");
    const reversedPath = reverseSvgPath(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="line" d="M 0 0 H 2 V 3"/></svg>',
      "line",
    );
    expect(reversedPath.svg).toContain('d="M 2 3 L 2 0 L 0 0"');
    const updated = updateSvgShapes(created.svg, [
      {
        geometry: { kind: "rect", width: 35, x: 12 },
        id: "rect_1",
        style: {
          classes: ["featured", "sale"],
          fill: "#00ff00",
          fillOpacity: 0.75,
          fontStyle: "italic",
          fontWeight: 600,
          letterSpacing: 1.25,
          locked: true,
          opacity: 0.5,
          paintOrder: "stroke fill markers",
          stroke: "none",
          strokeDasharray: [2, 3],
          strokeLineCap: "round",
          strokeMiterLimit: 8,
          visibility: "visible",
          wordSpacing: 2,
        },
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
    expect(updated.svg).toContain('fill-opacity="0.75"');
    expect(updated.svg).toContain('stroke="none"');
    expect(updated.svg).toContain('stroke-dasharray="2 3"');
    expect(updated.svg).toContain('class="featured sale"');
    expect(updated.svg).toContain('font-weight="600"');
    expect(updated.svg).toContain('letter-spacing="1.25"');
    expect(updated.svg).toContain('sodipodi:insensitive="true"');
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
    const arrangedByIndex = arrangeSvgShapes(
      created.svg,
      ["rect_1", "circle_1"],
      "index",
      { index: 0 },
    );
    expect(arrangedByIndex.svg.indexOf('id="rect_1"')).toBeLessThan(
      arrangedByIndex.svg.indexOf('id="circle_1"'),
    );
    const arrangedRelative = arrangeSvgShapes(
      arrangedByIndex.svg,
      ["rect_1"],
      "after",
      { relativeTo: "circle_1" },
    );
    expect(arrangedRelative.svg.indexOf('id="circle_1"')).toBeLessThan(
      arrangedRelative.svg.indexOf('id="rect_1"'),
    );
    expect(() =>
      arrangeSvgShapes(created.svg, ["rect_1"], "before", {
        relativeTo: "rect_1",
      }),
    ).toThrow("cannot be selected");
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
    const copied = duplicateSvgShape(created.svg, {
      id: "rect_1",
      mode: "copy",
      newId: "rect_copy",
    });
    expect(copied.svg).toContain('id="rect_copy"');
    const cloned = duplicateSvgShape(copied.svg, {
      id: "rect_1",
      mode: "use",
      newId: "rect_use",
    });
    expect(cloned.svg).toContain('<use id="rect_use" href="#rect_1"/>');
    const reparented = reparentSvgShapes(created.svg, {
      ids: ["star_1"],
      parentId: "layer_main",
    });
    expect(
      querySvgElements(reparented.svg, {
        ids: ["star_1"],
        limit: 1,
        offset: 0,
      }).elements[0]?.parentId,
    ).toBe("layer_main");
    expect(() =>
      reparentSvgShapes(created.svg, {
        ids: ["layer_main"],
        parentId: "layer_main",
      }),
    ).toThrow("cycle");
  });

  it("deeply copies a bounded subtree and rewrites only its internal ID references", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="external_filter"/></defs><g id="card"><style>#body { fill: url(#gradient); }</style><title id="title">Card</title><defs><clipPath id="clip"><rect id="clip_shape" width="10" height="10"/></clipPath><linearGradient id="gradient"><stop offset="0" stop-color="#112233"/><stop offset="1" stop-color="#445566"/></linearGradient></defs><rect id="body" fill="url(#gradient)" clip-path="url(#clip)" filter="url(#external_filter)" aria-labelledby="title"/><use id="badge" href="#body"/></g></svg>';
    const copied = duplicateSvgShape(source, {
      id: "card",
      mode: "copy",
      newId: "card_copy",
    });
    const remapped = new Map(
      copied.remappedIds.map((item) => [item.from, item.to]),
    );
    expect(remapped.get("card")).toBe("card_copy");
    for (const id of [
      "title",
      "clip",
      "clip_shape",
      "gradient",
      "body",
      "badge",
    ])
      expect(remapped.get(id)).toMatch(/^card_copy_copy_\d+$/u);
    expect(copied.svg).toContain(`id="${remapped.get("body")}"`);
    expect(copied.svg).toContain(`href="#${remapped.get("body")}"`);
    expect(copied.svg).toContain(`url(#${remapped.get("gradient")})`);
    expect(copied.svg).toContain(`url(#${remapped.get("clip")})`);
    expect(copied.svg).toContain(`aria-labelledby="${remapped.get("title")}"`);
    expect(copied.svg).toContain(`#${remapped.get("body")} {`);
    expect(copied.svg).toContain('filter="url(#external_filter)"');
  });

  it("rejects ambiguous and oversized deep-copy source subtrees", () => {
    expect(() =>
      duplicateSvgShape(
        '<svg xmlns="http://www.w3.org/2000/svg"><g id="card"><rect id="shared"/></g><rect id="shared"/></svg>',
        { id: "card", mode: "copy", newId: "card_copy" },
      ),
    ).toThrow("normalize IDs first");
    const children = Array.from(
      { length: 257 },
      (_, index) => `<rect id="child_${index}"/>`,
    ).join("");
    expect(() =>
      duplicateSvgShape(
        `<svg xmlns="http://www.w3.org/2000/svg"><g id="large">${children}</g></svg>`,
        { id: "large", mode: "copy", newId: "large_copy" },
      ),
    ).toThrow("ID limit");
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
  it("creates only local or supported embedded raster image elements", () => {
    const source = createSvgDocument({
      page: { width: mm(20), height: mm(20) },
    });
    const result = createSvgShapes(source, [
      {
        height: 8,
        href: "assets/photo.png",
        id: "linked_image",
        kind: "image",
        preserveAspectRatio: "xMidYMid meet",
        width: 10,
        x: 1,
        y: 2,
      },
      {
        height: 1,
        href: "data:image/png;base64,AA==",
        id: "embedded_image",
        kind: "image",
        width: 1,
        x: 0,
        y: 0,
      },
    ]);
    expect(result.svg).toContain('href="assets/photo.png"');
    expect(result.svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(result.svg).toContain('href="data:image/png;base64,AA=="');
    expect(() =>
      createSvgShapes(source, [
        {
          height: 1,
          href: "https://example.test/image.png",
          kind: "image",
          width: 1,
          x: 0,
          y: 0,
        },
      ]),
    ).toThrow("local relative raster");
  });
  it("generates deterministic noncolliding IDs while rejecting explicit collisions", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="shape_1"/></svg>';
    const first = createSvgShapes(source, [
      { height: 1, kind: "rect", width: 1, x: 0, y: 0 },
    ]);
    const second = createSvgShapes(first.svg, [
      { height: 1, kind: "rect", width: 1, x: 1, y: 0 },
    ]);
    expect(first.ids).toEqual(["shape_2"]);
    expect(second.ids).toEqual(["shape_3"]);
    expect(() =>
      createSvgShapes(second.svg, [
        { height: 1, id: "shape_2", kind: "rect", width: 1, x: 2, y: 0 },
      ]),
    ).toThrow("already exists");
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
