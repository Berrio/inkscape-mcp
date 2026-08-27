import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPng } from "../../src/export/index.js";
const paths: string[] = [];

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, "ascii");
  data.copy(result, 8);
  result.writeUInt32BE(
    crc32(result.subarray(4, 8 + data.length)),
    8 + data.length,
  );
  return result;
}

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const physical = Buffer.alloc(9);
  physical.writeUInt32BE(11_811, 0);
  physical.writeUInt32BE(11_811, 4);
  physical[8] = 1;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("pHYs", physical),
    chunk("IDAT", Buffer.from([0x78, 0x9c])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
describe("PNG verification", () => {
  it("checks signature and IHDR dimensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-png-"));
    paths.push(root);
    const path = join(root, "result.png");
    const bytes = png(320, 200);
    await writeFile(path, bytes);
    const metadata = await verifyPng(path, { width: 320, height: 200 });
    expect(metadata).toMatchObject({
      bitDepth: 8,
      byteLength: bytes.length,
      colorType: 6,
      height: 200,
      width: 320,
    });
    expect(metadata.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(metadata.dpiX).toBeCloseTo(300);
    expect(metadata.dpiY).toBeCloseTo(300);
    await expect(verifyPng(path, { width: 1 })).rejects.toThrow("dimensions");
  });
});
