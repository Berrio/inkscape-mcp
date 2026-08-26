import { DOMParser, type Element as XmlElement } from "@xmldom/xmldom";

import { sanitizeSvg } from "../svg/index.js";

export type BoundsFidelity = "approximate" | "exact" | "partial";
export type BoundsKind = "approximate" | "geometric" | "visual";
export type BoundsLimitation =
  | "CSS_CASCADE"
  | "CSS_VARIABLES_OR_CURRENT_COLOR"
  | "FILTER"
  | "GEOMETRIC_ENGINE_UNAVAILABLE"
  | "MARKER"
  | "NON_SCALING_STROKE"
  | "OBJECT_BOUNDING_BOX"
  | "PERCENTAGE_LENGTHS"
  | "STROKE"
  | "TRANSFORM";
export type BoundsDescriptor = {
  fidelity: BoundsFidelity;
  kind: BoundsKind;
  limitations: readonly BoundsLimitation[];
  source: "dom-subset" | "inkscape-query-all";
};
export type NativeVisualBoundsDescriptor = {
  fidelity: "partial";
  kind: "visual";
  limitations: readonly ["GEOMETRIC_ENGINE_UNAVAILABLE"];
  source: "inkscape-query-all";
};
export type BoundsAssessment = {
  geometric: BoundsDescriptor;
  visual: BoundsDescriptor;
};

/**
 * Documents the fidelity boundary before a numeric geometric bounds engine is
 * introduced. It never upgrades a DOM/CSS estimate to exact.
 */
export function assessSvgBounds(source: string): BoundsAssessment {
  const sanitized = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  if (sanitized.removed.length > 0)
    throw new Error("Bounds assessment requires a policy-compliant SVG");
  const document = new DOMParser().parseFromString(
    sanitized.svg,
    "image/svg+xml",
  );
  const limitations = new Set<BoundsLimitation>([
    "GEOMETRIC_ENGINE_UNAVAILABLE",
  ]);
  for (const element of Array.from(document.getElementsByTagName("*")))
    collectLimitations(element, limitations);
  const ordered = [...limitations].sort();
  return {
    geometric: {
      fidelity: "approximate",
      kind: "approximate",
      limitations: ordered,
      source: "dom-subset",
    },
    visual: nativeVisualBoundsDescriptor(),
  };
}

/**
 * Inkscape's `--query-all` is exposed as a native visual observation. It is
 * deliberately partial: callers must not use it as a geometric/CSS proof.
 */
export function nativeVisualBoundsDescriptor(): NativeVisualBoundsDescriptor {
  return {
    fidelity: "partial",
    kind: "visual",
    limitations: ["GEOMETRIC_ENGINE_UNAVAILABLE"],
    source: "inkscape-query-all",
  };
}

function collectLimitations(
  element: XmlElement,
  limitations: Set<BoundsLimitation>,
): void {
  const style = element.getAttribute("style") ?? "";
  const attributes = Array.from(element.attributes).map(
    (attribute) => `${attribute.name}=${attribute.value}`,
  );
  const values = [
    style,
    ...attributes,
    ...(element.localName === "style" ? [element.textContent] : []),
  ].join(" ");
  if (element.hasAttribute("transform")) limitations.add("TRANSFORM");
  if (
    element.hasAttribute("stroke") ||
    element.hasAttribute("stroke-width") ||
    /(?:^|[;\s])stroke(?:-width)?\s*:/iu.test(style)
  )
    limitations.add("STROKE");
  if (
    element.hasAttribute("marker-start") ||
    element.hasAttribute("marker-mid") ||
    element.hasAttribute("marker-end") ||
    /marker-(?:start|mid|end)\s*:/iu.test(style)
  )
    limitations.add("MARKER");
  if (element.hasAttribute("filter") || /filter\s*:/iu.test(style))
    limitations.add("FILTER");
  if (element.localName === "style" || element.hasAttribute("class"))
    limitations.add("CSS_CASCADE");
  if (/!important\b|\bvar\(|\bcurrentColor\b/iu.test(values))
    limitations.add("CSS_VARIABLES_OR_CURRENT_COLOR");
  if (/\b(?:width|height|x|y|cx|cy|r|rx|ry)\s*[:=]\s*[-+.0-9]+%/iu.test(values))
    limitations.add("PERCENTAGE_LENGTHS");
  if (
    /\b(?:gradientUnits|filterUnits|maskUnits|patternUnits)=objectBoundingBox\b/iu.test(
      values,
    )
  )
    limitations.add("OBJECT_BOUNDING_BOX");
  if (/\bvector-effect=(?:"|')?non-scaling-stroke\b/iu.test(values))
    limitations.add("NON_SCALING_STROKE");
}
