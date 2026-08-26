import { verifyPdf, type PdfMetadata } from "./pdf.js";
import { verifyPng, type PngMetadata } from "./png.js";
import { verifySvg } from "./svg.js";

export type ExportVerification =
  | { format: "png"; metadata: PngMetadata }
  | { format: "pdf"; metadata: PdfMetadata }
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
  throw new Error(`No structural verifier is available for ${format}`);
}
