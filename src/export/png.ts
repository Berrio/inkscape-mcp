import { readFile } from "node:fs/promises";

export type PngMetadata = { height: number; width: number };

export async function verifyPng(
  path: string,
  expected?: Partial<PngMetadata>,
): Promise<PngMetadata> {
  const header = await readFile(path).then((value) => value.subarray(0, 24));
  if (
    !header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Export output is not a PNG");
  if (header.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("PNG is missing IHDR");
  const metadata = {
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
  return metadata;
}
