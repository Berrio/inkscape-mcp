export type InkscapeBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

/** Parses the allowlisted `--query-all` output without treating IDs as CSV fields. */
export function parseInkscapeQueryAll(
  output: string,
): ReadonlyMap<string, InkscapeBounds> {
  const bounds = new Map<string, InkscapeBounds>();
  const duplicates = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const columns = line.split(",");
    if (columns.length < 5)
      throw new Error("Inkscape query output has an invalid record");
    const id = columns.slice(0, -4).join(",");
    const values = columns.slice(-4).map(Number);
    if (
      id.length === 0 ||
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value))
    )
      throw new Error("Inkscape query output has invalid bounds");
    if (bounds.has(id)) {
      bounds.delete(id);
      duplicates.add(id);
      continue;
    }
    if (duplicates.has(id)) continue;
    bounds.set(id, {
      height: values[3]!,
      width: values[2]!,
      x: values[0]!,
      y: values[1]!,
    });
  }
  return bounds;
}
