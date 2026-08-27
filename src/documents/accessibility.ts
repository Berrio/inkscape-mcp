import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type SvgAccessibilityInspection = {
  lowContrastText: readonly { id?: string; ratio: number }[];
  readingOrder: readonly string[];
  warnings: readonly string[];
};

export function inspectSvgAccessibility(
  source: string,
): SvgAccessibilityInspection {
  sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  const root = new DOMParser().parseFromString(
    source,
    "image/svg+xml",
  ).documentElement;
  if (!root || root.localName !== "svg") throw new Error("SVG root is missing");
  const order: string[] = [];
  const lowContrastText: { id?: string; ratio: number }[] = [];
  for (const element of walk(root)) {
    if (element.localName === "text" && element.getAttribute("id"))
      order.push(element.getAttribute("id")!);
    if (element.localName !== "text") continue;
    const color = paintColor(element);
    if (color === undefined) continue;
    const ratio = contrastRatio(color, [255, 255, 255]);
    if (ratio < 4.5)
      lowContrastText.push({
        ...(element.getAttribute("id") === null
          ? {}
          : { id: element.getAttribute("id")! }),
        ratio: round(ratio),
      });
  }
  return {
    lowContrastText,
    readingOrder: order,
    warnings: [
      "CONTRAST_ASSUMES_WHITE_BACKGROUND_AND_DIRECT_FILL_ONLY",
      "READING_ORDER_IS_DOCUMENT_ORDER_HEURISTIC",
    ],
  };
}

function paintColor(element: XmlElement): [number, number, number] | undefined {
  const style = element.getAttribute("style") ?? "";
  const value =
    element.getAttribute("fill") ??
    /(?:^|;)\s*fill\s*:\s*(#[0-9a-f]{6})/iu.exec(style)?.[1];
  const match =
    value === undefined ? undefined : /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) return undefined;
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function contrastRatio(
  left: readonly number[],
  right: readonly number[],
): number {
  const luminance = (color: readonly number[]) =>
    0.2126 * channel(color[0]!) +
    0.7152 * channel(color[1]!) +
    0.0722 * channel(color[2]!);
  const [a, b] = [luminance(left), luminance(right)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function* walk(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (let node = root.firstChild; node; node = node.nextSibling)
    if (node.nodeType === 1) yield* walk(node as XmlElement);
}
