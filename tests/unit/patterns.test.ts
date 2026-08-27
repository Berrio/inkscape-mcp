import { describe, expect, it } from "vitest";

import {
  applySvgPattern,
  createSvgPattern,
  deleteSvgPattern,
  updateSvgPattern,
} from "../../src/documents/index.js";

describe("typed SVG patterns", () => {
  it("creates, applies, updates and protects a dots pattern", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target" width="10" height="8"/></svg>';
    const created = createSvgPattern(source, {
      background: "#ffffff",
      foreground: "#000000",
      id: "dots",
      kind: "dots",
      size: 4,
      weight: 1,
    });
    expect(created).toContain('pattern id="dots"');
    expect(created).toContain('circle cx="2" cy="2" r="1"');
    const applied = applySvgPattern(created, "dots", ["target"], "fill");
    expect(applied).toContain('fill="url(#dots)"');
    expect(() => deleteSvgPattern(applied, "dots")).toThrow(
      "would break an SVG reference",
    );
    const updated = updateSvgPattern(applied, {
      foreground: "#ff0000",
      id: "dots",
      kind: "stripes",
      size: 8,
      transform: [1, 0, 0, 1, 2, 0],
      weight: 2,
    });
    expect(updated).toContain('patternTransform="matrix(1 0 0 1 2 0)"');
  });

  it("rejects a singular pattern transform", () => {
    expect(() =>
      createSvgPattern('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        foreground: "#000000",
        id: "bad",
        kind: "dots",
        size: 4,
        transform: [1, 0, 0, 0, 0, 0],
        weight: 1,
      }),
    ).toThrow("invertible");
  });
});
