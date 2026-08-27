import { describe, expect, it } from "vitest";

import {
  applySvgClipPath,
  createSvgRectClipPath,
  deleteSvgClipPath,
  releaseSvgClipPath,
} from "../../src/documents/index.js";

describe("typed SVG clip paths", () => {
  it("creates, applies, releases and deletes a rectangular local clip", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect id="target" width="10" height="8"/></svg>';
    const created = createSvgRectClipPath(source, {
      height: 4,
      id: "crop",
      width: 5,
      x: 1,
      y: 2,
    });
    expect(created).toContain('clipPath id="crop"');
    const applied = applySvgClipPath(created, "crop", ["target"]);
    expect(applied).toContain('clip-path="url(#crop)"');
    expect(() => deleteSvgClipPath(applied, "crop")).toThrow(
      "would break an SVG reference",
    );
    const released = releaseSvgClipPath(applied, ["target"]);
    expect(released).not.toContain('clip-path="url(#crop)"');
    expect(deleteSvgClipPath(released, "crop")).not.toContain('id="crop"');
  });

  it("bounds objectBoundingBox clips to their normalized coordinate space", () => {
    expect(() =>
      createSvgRectClipPath('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        height: 0.5,
        id: "crop",
        units: "objectBoundingBox",
        width: 0.5,
        x: 0.8,
        y: 0,
      }),
    ).toThrow("within zero and one");
  });
});
