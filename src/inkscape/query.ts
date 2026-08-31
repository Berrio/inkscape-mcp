export type InkscapeBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type InkscapeQueryViewport = {
  heightPx: number;
  viewBox: { height: number; width: number; x: number; y: number };
  widthPx: number;
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

/**
 * Inkscape 1.4 reports `--query-all` coordinates in rendered CSS pixels,
 * while document operations use SVG viewBox user units. Convert the result
 * back into the source coordinate system before it reaches the domain layer.
 */
export function queryBoundsToSvgUserUnits(
  bounds: InkscapeBounds,
  viewport: InkscapeQueryViewport,
): InkscapeBounds {
  const scaleX = viewport.widthPx / viewport.viewBox.width;
  const scaleY = viewport.heightPx / viewport.viewBox.height;
  if (
    !Number.isFinite(scaleX) ||
    !Number.isFinite(scaleY) ||
    scaleX <= 0 ||
    scaleY <= 0
  )
    throw new Error("Inkscape query viewport has an invalid scale");
  return {
    height: bounds.height / scaleY,
    width: bounds.width / scaleX,
    x: bounds.x / scaleX + viewport.viewBox.x,
    y: bounds.y / scaleY + viewport.viewBox.y,
  };
}
