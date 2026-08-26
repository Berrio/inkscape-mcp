import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sanitizeSvg } from "../svg/index.js";
export type SvgMetadata = {
  byteLength: number;
  hash: string;
  viewBox: string;
};

export async function verifySvg(path: string): Promise<SvgMetadata> {
  const bytes = await readFile(path);
  const source = bytes.toString("utf8");
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("Exported SVG violates the SVG safety policy");
  const match = source.match(/<svg\b[^>]*\bviewBox\s*=\s*(["'])([^"']+)\1/iu);
  const viewBox = match?.[2];
  const values = viewBox?.trim().split(/[ ,]+/u).map(Number);
  if (
    viewBox === undefined ||
    values === undefined ||
    values.length !== 4 ||
    !values.every(Number.isFinite) ||
    values[2]! <= 0 ||
    values[3]! <= 0
  )
    throw new Error("Exported SVG has an invalid viewBox");
  return {
    byteLength: bytes.byteLength,
    hash: createHash("sha256").update(bytes).digest("hex"),
    viewBox,
  };
}
