export type PhysicalUnit = "cm" | "in" | "mm" | "pc" | "pt" | "q";
export type PhysicalLength = { unit: PhysicalUnit; value: number };
export type CssPixelLength = { unit: "px"; value: number };
export type ViewportLength = CssPixelLength | PhysicalLength;
export type PageSize = { height: ViewportLength; width: ViewportLength };
export type UserRect = { height: number; width: number; x: number; y: number };

const MM_PER_UNIT: Record<PhysicalUnit, number> = {
  cm: 10,
  in: 25.4,
  mm: 1,
  pc: 25.4 / 6,
  pt: 25.4 / 72,
  q: 0.25,
};
export const CSS_PIXELS_PER_INCH = 96;

export function toMillimeters(length: ViewportLength): number {
  assertPositive(length.value);
  return length.unit === "px"
    ? (length.value * 25.4) / CSS_PIXELS_PER_INCH
    : length.value * MM_PER_UNIT[length.unit];
}
export function toCssPixels(length: ViewportLength): number {
  return (toMillimeters(length) * CSS_PIXELS_PER_INCH) / 25.4;
}
export function convertPhysical(
  length: PhysicalLength,
  unit: PhysicalUnit,
): PhysicalLength {
  return { unit, value: toMillimeters(length) / MM_PER_UNIT[unit] };
}
export function assertPositive(value: number): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Length must be finite and positive");
}
