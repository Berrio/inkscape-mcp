import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

export type PdfBox = { height: number; width: number; x: number; y: number };
export type PdfMetadata = {
  byteLength: number;
  cropBoxes: readonly PdfBox[];
  hash: string;
  mediaBoxes: readonly PdfBox[];
  pageCount: number;
  version: string;
};

export async function verifyPdf(path: string): Promise<PdfMetadata> {
  const bytes = await readFile(path);
  const header = bytes.subarray(0, 16).toString("ascii");
  const match = header.match(/^%PDF-(1\.[0-9])/u);
  if (!match) throw new Error("Export output is not a PDF");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new Error("Export output is not a readable PDF");
  }
  const mediaBoxes = document.getPages().map((page) => {
    const box = page.getMediaBox();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  });
  const cropBoxes = document.getPages().map((page) => {
    const box = page.getCropBox();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  });
  if (mediaBoxes.length === 0) throw new Error("Export PDF has no pages");
  return {
    byteLength: bytes.byteLength,
    cropBoxes,
    hash: createHash("sha256").update(bytes).digest("hex"),
    mediaBoxes,
    pageCount: mediaBoxes.length,
    version: match[1]!,
  };
}
