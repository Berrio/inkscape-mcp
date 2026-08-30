export const DXF_EXPORT_ADAPTER = "inkscape-dxf/v1" as const;

export type DxfMetadata = {
  byteLength: number;
  sectionCount: number;
};

/** Validates the bounded ASCII DXF structure required before publication. */
export function inspectDxf(bytes: Uint8Array): DxfMetadata {
  if (
    bytes.length === 0 ||
    [...bytes].some((byte) => byte === 0 || byte > 0x7f)
  ) {
    throw new Error("DXF output is not ASCII");
  }
  const lines = Buffer.from(bytes)
    .toString("ascii")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  let sectionCount = 0;
  let hasEof = false;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (lines[index] !== "0") continue;
    if (lines[index + 1] === "SECTION") sectionCount += 1;
    if (lines[index + 1] === "EOF") hasEof = true;
  }
  if (sectionCount === 0 || !hasEof)
    throw new Error("DXF output is missing SECTION or EOF");
  return { byteLength: bytes.length, sectionCount };
}
