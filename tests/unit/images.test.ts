import { describe, expect, it } from "vitest";

import {
  extractEmbeddedRaster,
  setSvgImageHref,
} from "../../src/documents/index.js";

describe("SVG image resource management", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" href="data:image/png;base64,AA=="/></svg>';

  it("relinks an image only to a safe relative resource", () => {
    expect(setSvgImageHref(source, "photo", "assets/photo.png")).toContain(
      'href="assets/photo.png"',
    );
    expect(() =>
      setSvgImageHref(source, "photo", "https://invalid.example/image.png"),
    ).toThrow(/href/u);
  });

  it("extracts a bounded embedded supported raster", () => {
    const extracted = extractEmbeddedRaster(source, "photo", 10);
    expect(extracted).toMatchObject({ mime: "image/png" });
    expect(extracted.bytes).toEqual(Buffer.from([0]));
  });
});
