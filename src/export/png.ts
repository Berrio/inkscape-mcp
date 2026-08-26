import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type PngMetadata = {
  bitDepth: 1 | 2 | 4 | 8 | 16;
  byteLength: number;
  colorType: 0 | 2 | 3 | 4 | 6;
  dpiX?: number;
  dpiY?: number;
  hash: string;
  height: number;
  width: number;
};

export async function verifyPng(
  path: string,
  expected?: Partial<PngMetadata>,
): Promise<PngMetadata> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 26);
  if (
    !header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Export output is not a PNG");
  if (header.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("PNG is missing IHDR");
  const metadata: PngMetadata = {
    bitDepth: parseBitDepth(header[24]),
    byteLength: bytes.byteLength,
    colorType: parseColorType(header[25]),
    hash: createHash("sha256").update(bytes).digest("hex"),
    width: header.readUInt32BE(16),
    height: header.readUInt32BE(20),
  };
  if (metadata.width < 1 || metadata.height < 1)
    throw new Error("PNG has invalid dimensions");
  if (
    (expected?.width !== undefined && expected.width !== metadata.width) ||
    (expected?.height !== undefined && expected.height !== metadata.height)
  )
    throw new Error("PNG dimensions do not match requested output");
  return { ...metadata, ...readPhysicalResolution(bytes) };
}

function parseBitDepth(value: number | undefined): PngMetadata["bitDepth"] {
  if (value === 1 || value === 2 || value === 4 || value === 8 || value === 16)
    return value;
  throw new Error("PNG has an unsupported bit depth");
}

function parseColorType(value: number | undefined): PngMetadata["colorType"] {
  if (value === 0 || value === 2 || value === 3 || value === 4 || value === 6)
    return value;
  throw new Error("PNG has an unsupported color type");
}

function readPhysicalResolution(bytes: Buffer): Partial<PngMetadata> {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    const next = dataOffset + length + 4;
    if (next > bytes.length) throw new Error("PNG has a truncated chunk");
    if (type === "pHYs" && length === 9 && bytes[dataOffset + 8] === 1) {
      const dpiX = bytes.readUInt32BE(dataOffset) * 0.0254;
      const dpiY = bytes.readUInt32BE(dataOffset + 4) * 0.0254;
      return { dpiX, dpiY };
    }
    if (type === "IEND") return {};
    offset = next;
  }
  return {};
}
