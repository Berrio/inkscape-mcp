import { describe, expect, it } from "vitest";

import {
  parseSvgPathData,
  moveAbsoluteSvgPathNode,
  editAbsoluteLinearSvgPathNode,
  reverseLinearSvgPathData,
  serializeSvgPathData,
  splitSvgPathSubpaths,
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

  it("splits compound paths and reverses supported linear subpaths", () => {
    const compound = parseSvgPathData("M 0 0 L 4 0 L 4 3 Z M 8 0 H 10 V 2");
    expect(splitSvgPathSubpaths(compound)).toHaveLength(2);
    expect(reverseLinearSvgPathData("M 0 0 L 4 0 L 4 3 Z M 8 0 H 10 V 2")).toBe(
      "M 0 0 L 4 3 L 4 0 Z M 10 2 L 10 0 L 8 0",
    );
    expect(() => reverseLinearSvgPathData("M 0 0 C 1 2 3 4 5 6")).toThrow(
      "only moveto, lineto, horizontal, vertical and close",
    );
  });

  it("moves only explicit supported absolute endpoints", () => {
    expect(
      moveAbsoluteSvgPathNode("M 0 0 L 4 2 T 8 1", 1, { x: 5, y: 3 }),
    ).toBe("M 0 0 L 5 3 T 8 1");
    expect(() =>
      moveAbsoluteSvgPathNode("M 0 0 l 4 2", 1, { x: 5, y: 3 }),
    ).toThrow("currently supports");
    expect(
      moveAbsoluteSvgPathNode("M 0 0 C 1 2 3 4 5 6 A 2 3 0 0 1 8 9", 1, {
        x: 7,
        y: 8,
      }),
    ).toBe("M 0 0 C 1 2 3 4 7 8 A 2 3 0 0 1 8 9");
    expect(moveAbsoluteSvgPathNode("M 0 0 H 4 V 5", 1, { x: 7, y: 9 })).toBe(
      "M 0 0 H 7 V 5",
    );
    expect(moveAbsoluteSvgPathNode("M 0 0 H 4 V 5", 2, { x: 7, y: 9 })).toBe(
      "M 0 0 H 4 V 9",
    );
  });

  it("inserts, removes, and retags safe linear path nodes", () => {
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 L 4 2", {
        action: "insert",
        index: 1,
        point: { x: 2, y: 1 },
      }),
    ).toBe("M 0 0 L 2 1 L 4 2");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 L 2 1 L 4 2", {
        action: "delete",
        index: 1,
      }),
    ).toBe("M 0 0 L 4 2");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 L 4 2", {
        action: "set_command",
        command: "T",
        index: 1,
      }),
    ).toBe("M 0 0 T 4 2");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 L 4 2 M 8 0 L 9 1", {
        action: "close_subpath",
        index: 1,
      }),
    ).toBe("M 0 0 L 4 2 Z M 8 0 L 9 1");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 L 4 2 Z", {
        action: "open_subpath",
        index: 2,
      }),
    ).toBe("M 0 0 L 4 2");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 Q 1 2 3 4 C 5 6 7 8 9 10", {
        action: "set_quadratic_handle",
        control: { x: 2, y: 3 },
        index: 1,
      }),
    ).toBe("M 0 0 Q 2 3 3 4 C 5 6 7 8 9 10");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 C 1 2 3 4 5 6", {
        action: "set_cubic_handles",
        control1: { x: 2, y: 3 },
        control2: { x: 4, y: 5 },
        index: 1,
      }),
    ).toBe("M 0 0 C 2 3 4 5 5 6");
    expect(
      editAbsoluteLinearSvgPathNode("M 0 0 A 2 3 0 0 1 8 9", {
        action: "set_arc_parameters",
        index: 1,
        largeArc: true,
        rotation: 45,
        rx: 4,
        ry: 5,
        sweep: false,
      }),
    ).toBe("M 0 0 A 4 5 45 1 0 8 9");
  });
});
