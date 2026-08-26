import { describe, expect, it } from "vitest";

import {
  parseSvgPathData,
  serializeSvgPathData,
} from "../../src/documents/index.js";

describe("SVG path AST", () => {
  it("parses all SVG command families and preserves relative commands", () => {
    const segments = parseSvgPathData(
      "m 1 2 3 4 l 5 6 H 8 v 9 C 1 2 3 4 5 6 s 1 2 3 4 Q 1 2 3 4 t 5 6 A 2 3 45 0 1 9 10 z M 20 30",
    );
    expect(segments.map((segment) => segment.command)).toEqual([
      "m",
      "l",
      "l",
      "H",
      "v",
      "C",
      "s",
      "Q",
      "t",
      "A",
      "z",
      "M",
    ]);
    expect(serializeSvgPathData(segments)).toContain(
      "A 2 3 45 0 1 9 10 z M 20 30",
    );
  });

  it("rejects malformed commands, arities and arc flags", () => {
    expect(() => parseSvgPathData("L 1 2")).toThrow("start with a moveto");
    expect(() => parseSvgPathData("M 1")).toThrow("incomplete");
    expect(() => parseSvgPathData("M 0 0 A 1 1 0 2 0 1 1")).toThrow(
      "arc flags",
    );
    expect(() => parseSvgPathData("M 0 0 R 1 2")).toThrow("invalid syntax");
  });
});
