import { readFile } from "node:fs/promises";

import { verifyPdf, type PdfMetadata } from "./pdf.js";
import { inspectEmf, type EmfMetadata } from "./emf.js";
import { verifyPng, type PngMetadata } from "./png.js";
import { verifySvg } from "./svg.js";

export type PostscriptMetadata = {
  boundingBox?: readonly [number, number, number, number] | undefined;
  byteLength: number;
};

export type ExportVerification =
  | { format: "png"; metadata: PngMetadata }
  | { format: "pdf"; metadata: PdfMetadata }
  | { format: "eps" | "ps"; metadata: PostscriptMetadata }
  | { format: "emf"; metadata: EmfMetadata }
  | { format: "plain-svg" | "svg"; metadata: Record<string, never> };

/** Dispatches only to verifiers that can prove the artifact's structure. Other
 * formats remain capability-gated rather than pretending an extension proves it. */
export async function verifyExportArtifact(
  format:
    | "emf"
    | "eps"
    | "pdf"
    | "plain-svg"
    | "png"
    | "ps"
    | "svg"
    | "svgz"
    | "wmf"
    | "xaml",
  path: string,
): Promise<ExportVerification> {
  if (format === "png") return { format, metadata: await verifyPng(path) };
  if (format === "pdf") return { format, metadata: await verifyPdf(path) };
  if (format === "svg" || format === "plain-svg") {
    await verifySvg(path);
    return { format, metadata: {} };
  }
  if (format === "ps" || format === "eps")
    return { format, metadata: await verifyPostscript(path, format) };
  if (format === "emf")
    return { format, metadata: inspectEmf(await readFile(path)) };
  throw new Error(`No structural verifier is available for ${format}`);
}

async function verifyPostscript(
  path: string,
  format: "eps" | "ps",
): Promise<PostscriptMetadata> {
  const bytes = await readFile(path);
  const text = bytes.toString("latin1");
  if (!text.startsWith("%!PS-Adobe-"))
    throw new Error("PostScript output is missing its Adobe signature");
  if (!/%%EndComments\r?\n/u.test(text))
    throw new Error("PostScript output is missing its comment boundary");
  const boundingBox = parseBoundingBox(text);
  if (format === "eps" && boundingBox === undefined)
    throw new Error("EPS output is missing a concrete BoundingBox");
  return {
    ...(boundingBox === undefined ? {} : { boundingBox }),
    byteLength: bytes.length,
  };
}

function parseBoundingBox(
  text: string,
): readonly [number, number, number, number] | undefined {
  const match =
    /^%%BoundingBox:\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/mu.exec(text);
  if (!match) return undefined;
  const values = match.slice(1).map(Number);
  if (
    !values.every(Number.isFinite) ||
    values[2]! <= values[0]! ||
    values[3]! <= values[1]!
  )
    throw new Error("PostScript BoundingBox is invalid");
  return values as [number, number, number, number];
}
