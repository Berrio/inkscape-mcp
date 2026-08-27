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
});
