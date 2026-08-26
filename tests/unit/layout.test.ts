import { describe, expect, it } from "vitest";

import {
  planAlignment,
  planDistribution,
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
});
