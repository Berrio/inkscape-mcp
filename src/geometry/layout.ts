export type LayoutBounds = {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
};
export type LayoutReference = Omit<LayoutBounds, "id">;
export type LayoutMove = { id: string; x: number; y: number };
export type Alignment =
  "bottom" | "center" | "left" | "middle" | "right" | "top";
export type DistributionAxis = "horizontal" | "vertical";
export type DistributionMode = "centers" | "edges" | "gaps";

/** Plans translation-only alignment against a native visual reference box. */
export function planAlignment(
  bounds: readonly LayoutBounds[],
  alignment: Alignment,
  reference: LayoutReference,
): readonly LayoutMove[] {
  assertBounds(bounds);
  assertReference(reference);
  const target = alignmentTarget(alignment, reference);
  return bounds.map((item) => {
    const current = alignmentTarget(alignment, item);
    return horizontalAlignment(alignment)
      ? { id: item.id, x: target - current, y: 0 }
      : { id: item.id, x: 0, y: target - current };
  });
}

/** Plans deterministic equal edge, centre or inter-item-gap distribution. */
export function planDistribution(
  bounds: readonly LayoutBounds[],
  axis: DistributionAxis,
  mode: DistributionMode,
): readonly LayoutMove[] {
  if (bounds.length < 3 || bounds.length > 100)
    throw new Error("Distribution requires between three and 100 elements");
  assertBounds(bounds);
  const horizontal = axis === "horizontal";
  const ordered = [...bounds].sort((left, right) => {
    const difference =
      coordinate(left, horizontal) - coordinate(right, horizontal);
    return difference === 0 ? left.id.localeCompare(right.id) : difference;
  });
  const first = ordered[0]!;
  const last = ordered.at(-1)!;
  const span =
    mode === "centers"
      ? centre(last, horizontal) - centre(first, horizontal)
      : mode === "edges"
        ? coordinate(last, horizontal) - coordinate(first, horizontal)
        : edge(last, horizontal) - coordinate(first, horizontal);
  const totalSize = ordered.reduce(
    (total, item) => total + size(item, horizontal),
    0,
  );
  const gap =
    mode === "gaps"
      ? (span - totalSize) / (ordered.length - 1)
      : span / (ordered.length - 1);
  let cursor =
    mode === "centers"
      ? centre(first, horizontal)
      : coordinate(first, horizontal);
  return ordered.map((item, index) => {
    const desired = cursor;
    const current =
      mode === "centers"
        ? centre(item, horizontal)
        : coordinate(item, horizontal);
    if (mode === "gaps") cursor += size(item, horizontal) + gap;
    else cursor += gap;
    const delta = index === 0 ? 0 : desired - current;
    return horizontal
      ? { id: item.id, x: delta, y: 0 }
      : { id: item.id, x: 0, y: delta };
  });
}

export function unionLayoutBounds(
  bounds: readonly LayoutBounds[],
): LayoutReference {
  assertBounds(bounds);
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { height: bottom - top, width: right - left, x: left, y: top };
}

function assertBounds(bounds: readonly LayoutBounds[]): void {
  if (bounds.length < 1 || bounds.length > 100)
    throw new Error("Layout requires between one and 100 elements");
  if (new Set(bounds.map((item) => item.id)).size !== bounds.length)
    throw new Error("Layout IDs must be unique");
  for (const item of bounds) {
    if (
      item.id.length === 0 ||
      !Number.isFinite(item.x) ||
      !Number.isFinite(item.y) ||
      !Number.isFinite(item.width) ||
      !Number.isFinite(item.height) ||
      item.width <= 0 ||
      item.height <= 0
    )
      throw new Error("Layout bounds must be finite with positive dimensions");
  }
}

function assertReference(reference: LayoutReference): void {
  if (
    !Number.isFinite(reference.x) ||
    !Number.isFinite(reference.y) ||
    !Number.isFinite(reference.width) ||
    !Number.isFinite(reference.height) ||
    reference.width < 0 ||
    reference.height < 0
  )
    throw new Error(
      "Layout reference must be finite with non-negative dimensions",
    );
}

function alignmentTarget(
  alignment: Alignment,
  bounds: LayoutReference,
): number {
  switch (alignment) {
    case "left":
      return bounds.x;
    case "center":
      return bounds.x + bounds.width / 2;
    case "right":
      return bounds.x + bounds.width;
    case "top":
      return bounds.y;
    case "middle":
      return bounds.y + bounds.height / 2;
    case "bottom":
      return bounds.y + bounds.height;
  }
}

function horizontalAlignment(alignment: Alignment): boolean {
  return (
    alignment === "left" || alignment === "center" || alignment === "right"
  );
}

function coordinate(bounds: LayoutBounds, horizontal: boolean): number {
  return horizontal ? bounds.x : bounds.y;
}

function edge(bounds: LayoutBounds, horizontal: boolean): number {
  return coordinate(bounds, horizontal) + size(bounds, horizontal);
}

function centre(bounds: LayoutBounds, horizontal: boolean): number {
  return coordinate(bounds, horizontal) + size(bounds, horizontal) / 2;
}

function size(bounds: LayoutBounds, horizontal: boolean): number {
  return horizontal ? bounds.width : bounds.height;
}
