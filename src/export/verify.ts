import { readFile } from "node:fs/promises";

import { verifyPdf, type PdfMetadata } from "./pdf.js";
import { inspectDxf, type DxfMetadata } from "./dxf.js";
import { inspectHpgl, type HpglMetadata } from "./hpgl.js";
import { inspectGpl, type GplMetadata } from "./gpl.js";
import {
  inspectEmf,
  inspectWmf,
  type EmfMetadata,
  type WmfMetadata,
} from "./emf.js";
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
  | { format: "wmf"; metadata: WmfMetadata }
  | { format: "dxf"; metadata: DxfMetadata }
  | { format: "gpl"; metadata: GplMetadata }
  | { format: "hpgl"; metadata: HpglMetadata }
  | { format: "plain-svg" | "svg"; metadata: Record<string, never> };

/** Dispatches only to verifiers that can prove the artifact's structure. Other
 * formats remain capability-gated rather than pretending an extension proves it. */
export async function verifyExportArtifact(
  format:
    | "emf"
    | "dxf"
    | "eps"
    | "gpl"
    | "pdf"
    | "plain-svg"
    | "png"
    | "ps"
    | "svg"
    | "svgz"
    | "hpgl"
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
  if (format === "dxf")
    return { format, metadata: inspectDxf(await readFile(path)) };
  if (format === "gpl")
    return { format, metadata: inspectGpl(await readFile(path)) };
  if (format === "hpgl")
    return { format, metadata: inspectHpgl(await readFile(path)) };
  if (format === "wmf")
    return { format, metadata: inspectWmf(await readFile(path)) };
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
