import { describe, expect, it } from "vitest";

import {
  applySvgGradient,
  createSvgGradient,
  deleteSvgGradient,
  updateSvgGradient,
} from "../../src/documents/index.js";

describe("SVG gradient definitions", () => {
  const base =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect id="card" width="10" height="5"/></svg>';
  const linear = {
    id: "sunset",
    kind: "linear" as const,
    stops: [
      { color: "#ff0000", offset: 0 },
      { color: "#0000ff", offset: 1, opacity: 0.5 },
    ],
    x1: 0,
    x2: 1,
  };

  it("creates, applies, updates and protects referenced gradients", () => {
    const created = createSvgGradient(base, linear);
    expect(created).toContain('<linearGradient id="sunset" x1="0" x2="1">');
    const applied = applySvgGradient(created, "sunset", ["card"], "fill");
    expect(applied).toContain('fill="url(#sunset)"');
    expect(() => deleteSvgGradient(applied, "sunset")).toThrow(
      "break an SVG reference",
    );
    const updated = updateSvgGradient(created, {
      ...linear,
      kind: "radial",
      r: 1,
      transform: [1, 0, 0, 1, 2, 3],
    });
    expect(updated).toContain('<radialGradient id="sunset"');
    expect(deleteSvgGradient(updated, "sunset")).not.toContain("sunset");
  });

  it("rejects unsafe IDs, paint and stop ordering", () => {
    expect(() => createSvgGradient(base, { ...linear, id: "bad id" })).toThrow(
      "ID is invalid",
    );
    expect(() =>
      createSvgGradient(base, {
        ...linear,
        stops: [
          { color: "red", offset: 0 },
          { color: "#000000", offset: 1 },
        ],
      }),
    ).toThrow("#rrggbb");
    expect(() =>
      createSvgGradient(base, {
        ...linear,
        stops: [
          { color: "#000000", offset: 1 },
          { color: "#ffffff", offset: 0 },
        ],
      }),
    ).toThrow("sorted");
  });
});
