import { describe, expect, it } from "vitest";

import {
  planAlignment,
  planDistribution,
  planRemoveOverlaps,
  unionLayoutBounds,
} from "../../src/geometry/index.js";

describe("layout plans", () => {
  const bounds = [
    { height: 10, id: "a", width: 10, x: 0, y: 5 },
    { height: 20, id: "b", width: 20, x: 30, y: 40 },
    { height: 30, id: "c", width: 30, x: 90, y: 80 },
  ];

  it("aligns an axis against a supplied page or object box", () => {
    expect(
      planAlignment(bounds, "center", { height: 100, width: 200, x: 0, y: 0 }),
    ).toEqual([
      { id: "a", x: 95, y: 0 },
      { id: "b", x: 60, y: 0 },
      { id: "c", x: -5, y: 0 },
    ]);
    expect(
      planAlignment(bounds, "bottom", { height: 100, width: 200, x: 0, y: 0 }),
    ).toEqual([
      { id: "a", x: 0, y: 85 },
      { id: "b", x: 0, y: 40 },
      { id: "c", x: 0, y: -10 },
    ]);
  });

  it("distributes centres, edges and gaps while preserving both extrema", () => {
    expect(planDistribution(bounds, "horizontal", "centers")).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 15, y: 0 },
      { id: "c", x: 0, y: 0 },
    ]);
    expect(planDistribution(bounds, "horizontal", "edges")).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 15, y: 0 },
      { id: "c", x: 0, y: 0 },
    ]);
    expect(planDistribution(bounds, "horizontal", "gaps")).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
      { id: "c", x: 0, y: 0 },
    ]);
  });

  it("unions a selection and rejects invalid input", () => {
    expect(unionLayoutBounds(bounds)).toEqual({
      height: 105,
      width: 120,
      x: 0,
      y: 5,
    });
    expect(() =>
      planDistribution(bounds.slice(0, 2), "vertical", "gaps"),
    ).toThrow("between three and 100");
  });

  it("removes only real visual overlaps in a stable forward direction", () => {
    const overlapping = [
      { height: 10, id: "a", width: 10, x: 0, y: 0 },
      { height: 10, id: "b", width: 10, x: 5, y: 0 },
      { height: 10, id: "c", width: 10, x: 6, y: 20 },
      { height: 3, id: "d", width: 4, x: 7, y: 2 },
    ];
    expect(planRemoveOverlaps(overlapping, "horizontal")).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 5, y: 0 },
      { id: "c", x: 0, y: 0 },
      { id: "d", x: 13, y: 0 },
    ]);
    expect(
      planRemoveOverlaps(overlapping.slice(0, 2), "horizontal", 2),
    ).toEqual([
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 7, y: 0 },
    ]);
  });

  it("bounds remove-overlaps input and rejects invalid gaps", () => {
    expect(() => planRemoveOverlaps(bounds.slice(0, 1), "horizontal")).toThrow(
      "between two and 100",
    );
    expect(() =>
      planRemoveOverlaps(bounds.slice(0, 2), "horizontal", -1),
    ).toThrow("gap");
  });
});
