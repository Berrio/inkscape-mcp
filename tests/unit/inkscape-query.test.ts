import { describe, expect, it } from "vitest";

import {
  parseInkscapeQueryAll,
  queryBoundsToSvgUserUnits,
} from "../../src/inkscape/index.js";

describe("Inkscape bounds query parser", () => {
  it("parses numeric bounds and preserves commas within an ID", () => {
    expect(
      parseInkscapeQueryAll("shape,with,comma,1.5,-2,3,4\nrect_1,0,0,20,10\n"),
    ).toEqual(
      new Map([
        ["shape,with,comma", { height: 4, width: 3, x: 1.5, y: -2 }],
        ["rect_1", { height: 10, width: 20, x: 0, y: 0 }],
      ]),
    );
  });

  it("does not return an ambiguous duplicate ID and rejects malformed output", () => {
    expect(
      parseInkscapeQueryAll("duplicate,0,0,1,1\nduplicate,2,2,3,3\n"),
    ).toEqual(new Map());
    expect(() => parseInkscapeQueryAll("broken\n")).toThrow("invalid record");
    expect(() => parseInkscapeQueryAll("shape,0,nope,2,3\n")).toThrow(
      "invalid bounds",
    );
  });

  it("converts rendered query pixels back to SVG user units", () => {
    expect(
      queryBoundsToSvgUserUnits(
        { height: 75.5906, width: 113.386, x: 37.7953, y: 18.8976 },
        {
          heightPx: 50 * (96 / 25.4),
          viewBox: { height: 50, width: 100, x: 0, y: 0 },
          widthPx: 100 * (96 / 25.4),
        },
      ),
    ).toMatchObject({
      height: expect.closeTo(20, 3),
      width: expect.closeTo(30, 3),
      x: expect.closeTo(10, 3),
      y: expect.closeTo(5, 3),
    });
  });
});
