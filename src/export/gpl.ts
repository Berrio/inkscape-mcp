export type GplMetadata = {
  byteLength: number;
  colorCount: number;
  name: string;
};

/** Validates the textual GIMP Palette interchange structure emitted by Inkscape. */
export function inspectGpl(bytes: Uint8Array): GplMetadata {
  if (bytes.length === 0 || [...bytes].some((byte) => byte === 0))
    throw new Error("GPL output is empty or contains NUL bytes");
  const text = Buffer.from(bytes)
    .toString("utf8")
    .replace(/^\uFEFF/u, "");
  const lines = text.split(/\r?\n/u);
  if (lines[0]?.trim() !== "GIMP Palette")
    throw new Error("GPL output is missing its GIMP Palette signature");
  const nameLine = lines.find((line) => line.startsWith("Name:"));
  const name = nameLine?.slice("Name:".length).trim();
  if (!name || name.length > 256)
    throw new Error("GPL output is missing a bounded palette name");
  const columnsLine = lines.find((line) => line.startsWith("Columns:"));
  const columns = Number(columnsLine?.slice("Columns:".length).trim());
  if (!Number.isInteger(columns) || columns < 1 || columns > 32)
    throw new Error("GPL output has invalid palette columns");
  const colorCount = lines.filter((line) => {
    const match = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+.*)?$/u.exec(
      line.trim(),
    );
    return (
      match !== null &&
      match.slice(1, 4).every((component) => Number(component) <= 255)
    );
  }).length;
  if (colorCount === 0) throw new Error("GPL output has no palette colors");
  return { byteLength: bytes.length, colorCount, name };
}
