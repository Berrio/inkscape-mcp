import { describe, expect, it } from "vitest";
import { cropSvgImage } from "../../src/documents/index.js";
describe("non-destructive SVG image crop", () => {
  it("adds a user-space clipPath without changing the image href", () => {
    const result = cropSvgImage(
      '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" href="image.png" x="0" y="0" width="10" height="8"/></svg>',
      {
        clipId: "photo_crop",
        height: 4,
        imageId: "photo",
        width: 5,
        x: 1,
        y: 2,
      },
    );
    expect(result).toContain(
      '<clipPath id="photo_crop" clipPathUnits="userSpaceOnUse"><rect x="1" y="2" width="5" height="4"/></clipPath>',
    );
    expect(result).toContain('href="image.png"');
    expect(result).toContain('clip-path="url(#photo_crop)"');
  });

  it("rejects an implicit replacement of an existing clip path", () => {
    expect(() =>
      cropSvgImage(
        '<svg xmlns="http://www.w3.org/2000/svg"><image id="photo" clip-path="url(#old)" href="image.png"/></svg>',
        {
          clipId: "photo_crop",
          height: 4,
          imageId: "photo",
          width: 5,
          x: 1,
          y: 2,
        },
      ),
    ).toThrow("already has a clip path");
  });
});
