import { describe, expect, it } from "vitest";
import {
  applySvgFilter,
  createSvgBlurFilter,
  createSvgFilter,
  deleteSvgFilter,
  releaseSvgFilter,
  updateSvgFilter,
} from "../../src/documents/index.js";

describe("typed SVG filters", () => {
  it("creates a local Gaussian blur filter", () => {
    expect(
      createSvgBlurFilter('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        id: "soft",
        stdDeviation: 2,
      }),
    ).toContain(
      '<filter id="soft"><feGaussianBlur stdDeviation="2"/></filter>',
    );
  });
  it("applies a local filter by explicit element ID", () => {
    const source = createSvgBlurFilter(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target"/></svg>',
      { id: "soft", stdDeviation: 2 },
    );
    expect(applySvgFilter(source, "soft", ["target"])).toContain(
      'filter="url(#soft)"',
    );
  });
  it("creates all supported typed primitives", () => {
    let source = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    source = createSvgFilter(source, {
      id: "shadow",
      kind: "drop_shadow",
      dx: 2,
      dy: 3,
      stdDeviation: 1,
    });
    source = createSvgFilter(source, {
      id: "mix",
      kind: "blend",
      mode: "multiply",
    });
    source = createSvgFilter(source, {
      id: "tint",
      kind: "color_matrix",
      values: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    });
    expect(source).toContain('<feDropShadow dx="2" dy="3" stdDeviation="1"/>');
    expect(source).toContain(
      '<feBlend in="SourceGraphic" in2="BackgroundImage" mode="multiply"/>',
    );
    expect(source).toContain(
      '<feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"/>',
    );
  });
  it("updates, releases and protects live references on delete", () => {
    const source = applySvgFilter(
      createSvgBlurFilter(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target"/></svg>',
        { id: "soft", stdDeviation: 2 },
      ),
      "soft",
      ["target"],
    );
    expect(() => deleteSvgFilter(source, "soft")).toThrow(
      /break an SVG reference/u,
    );
    const updated = updateSvgFilter(source, {
      id: "soft",
      kind: "blur",
      stdDeviation: 5,
    });
    const released = releaseSvgFilter(updated, ["target"]);
    expect(released).not.toContain('filter="url(#soft)"');
    expect(deleteSvgFilter(released, "soft")).not.toContain('id="soft"');
  });
});
