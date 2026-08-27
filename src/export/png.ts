import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_CHUNKS = 100_000;

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
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    throw new Error("Export output is not a PNG");
  const chunks = parsePngChunks(bytes);
  const header = chunks[0]!.data;
  const metadata: PngMetadata = {
    bitDepth: parseBitDepth(header[8]),
    byteLength: bytes.byteLength,
    colorType: parseColorType(header[9]),
    hash: createHash("sha256").update(bytes).digest("hex"),
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
  };
  if (metadata.width < 1 || metadata.height < 1)
    throw new Error("PNG has invalid dimensions");
  if (
    (expected?.width !== undefined && expected.width !== metadata.width) ||
    (expected?.height !== undefined && expected.height !== metadata.height)
  )
    throw new Error("PNG dimensions do not match requested output");
  return { ...metadata, ...readPhysicalResolution(chunks) };
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

type PngChunk = { data: Buffer; type: string };

function parsePngChunks(bytes: Buffer): readonly PngChunk[] {
  const chunks: PngChunk[] = [];
  let hasImageData = false;
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (chunks.length >= MAX_PNG_CHUNKS)
      throw new Error("PNG exceeds the chunk limit");
    if (offset + 12 > bytes.length)
      throw new Error("PNG has a truncated chunk");
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    const next = dataOffset + length + 4;
    if (next > bytes.length) throw new Error("PNG has a truncated chunk");
    const data = bytes.subarray(dataOffset, dataOffset + length);
    if (
      crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) !==
      bytes.readUInt32BE(dataOffset + length)
    )
      throw new Error("PNG has an invalid chunk CRC");
    if (chunks.length === 0 && (type !== "IHDR" || length !== 13))
      throw new Error("PNG is missing IHDR");
    if (type === "IDAT" && length > 0) hasImageData = true;
    chunks.push({ data, type });
    offset = next;
    if (type === "IEND") {
      if (length !== 0 || offset !== bytes.length)
        throw new Error("PNG has an invalid IEND chunk");
      if (!hasImageData) throw new Error("PNG is missing image data");
      return chunks;
    }
  }
  throw new Error("PNG is missing IEND");
}

function readPhysicalResolution(
  chunks: readonly PngChunk[],
): Partial<PngMetadata> {
  for (const chunk of chunks) {
    if (
      chunk.type === "pHYs" &&
      chunk.data.length === 9 &&
      chunk.data[8] === 1
    ) {
      const dpiX = chunk.data.readUInt32BE(0) * 0.0254;
      const dpiY = chunk.data.readUInt32BE(4) * 0.0254;
      return { dpiX, dpiY };
    }
  }
  return {};
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
