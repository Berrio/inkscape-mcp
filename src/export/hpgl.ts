export const HPGL_EXPORT_ADAPTER = "inkscape-hpgl/v1" as const;

export type HpglMetadata = {
  byteLength: number;
  penCommandCount: number;
};

/** Validates the fixed subset emitted by Inkscape's HPGL extension. */
export function inspectHpgl(bytes: Uint8Array): HpglMetadata {
  if (
    bytes.length === 0 ||
    [...bytes].some((byte) => byte === 0 || byte > 0x7f)
  ) {
    throw new Error("HPGL output is not ASCII");
  }
  const text = Buffer.from(bytes).toString("ascii").replace(/\s+/gu, "");
  if (!text.startsWith("IN;"))
    throw new Error("HPGL output is missing initialization");
  const penCommands = text.match(/(?:PU|PD)[0-9,.-]*;/gu) ?? [];
  if (penCommands.length === 0)
    throw new Error("HPGL output is missing pen commands");
  return { byteLength: bytes.length, penCommandCount: penCommands.length };
}
