import { describe, expect, it } from "vitest";
import { inspectSvgAccessibility } from "../../src/documents/index.js";

describe("SVG accessibility heuristics", () => {
  it("reports direct low-contrast text and document order", () => {
    expect(
      inspectSvgAccessibility(
        '<svg xmlns="http://www.w3.org/2000/svg"><text id="first" fill="#777777">First</text><text id="second" fill="#000000">Second</text></svg>',
      ),
    ).toMatchObject({
      readingOrder: ["first", "second"],
      lowContrastText: [{ id: "first", ratio: 4.48 }],
    });
  });

  it("uses an explicit opaque Inkscape page color when available", () => {
    expect(
      inspectSvgAccessibility(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><sodipodi:namedview pagecolor="#000000" inkscape:pageopacity="1"/><text id="label" fill="#777777">Label</text></svg>',
      ),
    ).toMatchObject({
      background: { color: "#000000", source: "opaque-page" },
      lowContrastText: [],
    });
  });
});
