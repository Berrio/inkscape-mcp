import { inspectLegacyVectorEffects } from "./postscript.js";

export type EmfFlattenPolicy = "flatten-with-warning" | "reject";
export type EmfMetadata = {
  byteLength: number;
  frame: readonly [number, number, number, number];
  recordCount: number;
};
export type EmfPreflight = {
  filterReferenceCount: number;
  maskReferenceCount: number;
  transparencyReferenceCount: number;
  warnings: readonly string[];
};

/** Requires acknowledgement before Inkscape flattens unsupported SVG effects. */
export function preflightEmfExport(
  source: string,
  flattenPolicy: EmfFlattenPolicy,
): EmfPreflight {
  const inspection = inspectLegacyVectorEffects(source);
  const warnings = [
    ...(inspection.filterReferenceCount > 0
      ? ["EMF_FILTER_FLATTENING_REQUIRED"]
      : []),
    ...(inspection.maskReferenceCount > 0 ||
    inspection.transparencyReferenceCount > 0
      ? ["EMF_TRANSPARENCY_FLATTENING_REQUIRED"]
      : []),
  ];
  if (warnings.length > 0 && flattenPolicy === "reject")
    throw new Error(
      "EMF export requires flatten-with-warning for filters, masks, or transparency",
    );
  return { ...inspection, warnings };
}

/** Validates the fixed ENHMETAHEADER fields before an EMF is published/imported. */
export function inspectEmf(bytes: Uint8Array): EmfMetadata {
  if (bytes.length < 88) throw new Error("EMF is smaller than ENHMETAHEADER");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 1 || view.getUint32(4, true) < 88)
    throw new Error("EMF header record is invalid");
  if (String.fromCharCode(...bytes.subarray(40, 44)) !== " EMF")
    throw new Error("EMF is missing its signature");
  const declaredBytes = view.getUint32(48, true);
  const recordCount = view.getUint32(52, true);
  const frame = [
    view.getInt32(24, true),
    view.getInt32(28, true),
    view.getInt32(32, true),
    view.getInt32(36, true),
  ] as const;
  if (declaredBytes !== bytes.length || recordCount < 2)
    throw new Error("EMF declared size or record count is invalid");
  if (frame[2] <= frame[0] || frame[3] <= frame[1])
    throw new Error("EMF frame is invalid");
  return { byteLength: bytes.length, frame, recordCount };
}
