import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";

import { comparePngVisual, decodePngRgba } from "../../src/export/index.js";

function png(rgba: readonly number[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from([0, 0, 0, data.length]),
      Buffer.from(type),
      data,
      Buffer.alloc(4),
    ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, ...rgba]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

it("decodes RGBA PNG pixels and reports tolerant visual differences", () => {
  const expected = decodePngRgba(png([255, 0, 0, 255, 0, 0, 255, 255]));
  const actual = decodePngRgba(png([254, 0, 0, 255, 0, 0, 255, 255]));
  expect(comparePngVisual(actual, expected)).toMatchObject({
    differingPixels: 1,
    maxChannelDelta: 1,
    totalPixels: 2,
  });
  expect(comparePngVisual(actual, expected, 1).differingPixels).toBe(0);
});
