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

function bmp(width: number, height: number): Buffer {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const bytes = Buffer.alloc(54 + rowBytes * height);
  bytes.write("BM", 0, "ascii");
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(rowBytes * height, 34);
  return bytes;
}

function tiff(width: number, height: number): Buffer {
  const bitsOffset = 122;
  const pixelOffset = bitsOffset + 6;
  const pixelBytes = width * height * 3;
  const entries = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 3, bitsOffset],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, pixelOffset],
    [277, 3, 1, 3],
    [278, 4, 1, height],
    [279, 4, 1, pixelBytes],
  ];
  const bytes = Buffer.alloc(pixelOffset + pixelBytes);
  bytes.write("II", 0, "ascii");
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(entries.length, 8);
  for (const [index, [tag, type, count, value]] of entries.entries()) {
    const offset = 10 + index * 12;
    bytes.writeUInt16LE(tag, offset);
    bytes.writeUInt16LE(type, offset + 2);
    bytes.writeUInt32LE(count, offset + 4);
    if (type === 3) bytes.writeUInt16LE(value, offset + 8);
    else bytes.writeUInt32LE(value, offset + 8);
  }
  bytes.writeUInt16LE(8, bitsOffset);
  bytes.writeUInt16LE(8, bitsOffset + 2);
  bytes.writeUInt16LE(8, bitsOffset + 4);
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

  it("recognizes BMP, TIFF, JPEG, GIF and WebP intrinsic dimensions", () => {
    const bitmap = bmp(3, 2);
    const tagged = tiff(3, 2);
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
    expect(inspectRasterImport(bitmap, 1)).toMatchObject({
      height: 2,
      mime: "image/bmp",
      width: 3,
    });
    expect(inspectRasterImport(tagged, 1)).toMatchObject({
      height: 2,
      mime: "image/tiff",
      width: 3,
    });
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
    const truncated = bmp(1, 1).subarray(0, 54);
    expect(() => inspectRasterImport(truncated, 1)).toThrow("pixel data");
    const compressedTiff = tiff(1, 1);
    compressedTiff.writeUInt16LE(5, 10 + 3 * 12 + 8);
    expect(() => inspectRasterImport(compressedTiff, 1)).toThrow("compression");
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
