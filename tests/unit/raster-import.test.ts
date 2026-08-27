import { describe, expect, it } from "vitest";

import {
  createRasterImportSvg,
  inspectRasterImport,
  sniffRasterMime,
} from "../../src/import/raster-import.js";

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

describe("raster import", () => {
  it("sniffs and bounds PNG dimensions without trusting the filename", () => {
    const bytes = png(3, 2);
    expect(sniffRasterMime(bytes)).toBe("image/png");
    expect(inspectRasterImport(bytes, 1)).toEqual({
      height: 2,
      mime: "image/png",
      width: 3,
    });
    expect(() => inspectRasterImport(png(2_000, 2_000), 1)).toThrow(
      "megapixel",
    );
  });

  it("recognizes JPEG, GIF and WebP intrinsic dimensions", () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x05, 0x00, 0x04, 0x01,
      0x11, 0x00, 0x00,
    ]);
    const gif = Buffer.from("GIF89a\u0004\u0000\u0005\u0000", "binary");
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp[24] = 5;
    webp[27] = 6;
    expect(inspectRasterImport(jpeg, 1)).toMatchObject({
      height: 5,
      mime: "image/jpeg",
      width: 4,
    });
    expect(inspectRasterImport(gif, 1)).toMatchObject({
      height: 5,
      mime: "image/gif",
      width: 4,
    });
    expect(inspectRasterImport(webp, 1)).toMatchObject({
      height: 7,
      mime: "image/webp",
      width: 6,
    });
  });

  it("produces a self-contained XML-safe SVG wrapper", () => {
    const svg = createRasterImportSvg("data:image/png;base64,AA==", {
      height: 2,
      width: 3,
    });
    expect(svg).toContain('viewBox="0 0 3 2"');
    expect(svg).toContain('href="data:image/png;base64,AA=="');
  });
});
