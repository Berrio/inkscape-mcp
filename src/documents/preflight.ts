import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";

import { toMillimeters, type PhysicalLength } from "../geometry/index.js";
import { sanitizeSvg } from "../svg/index.js";
import { inspectSvgSettings, parseViewportLength } from "./basic.js";
import { inspectSvgInventory } from "./inventory.js";

const DEFAULT_RASTER_MEGAPIXEL_THRESHOLD = 25;
const PRINT_DPI_TARGET = 300;
const INKSCAPE_NAMESPACE = "http://www.inkscape.org/namespaces/inkscape";

export type PreflightProfile = "basic" | "interchange" | "print" | "web";
export type BleedSpec = {
  behavior: "expand-temporary-page" | "metadata-only";
  bottom: PhysicalLength;
  left: PhysicalLength;
  right: PhysicalLength;
  top: PhysicalLength;
};
export type PreflightOptions = {
  bleed?: BleedSpec | undefined;
  rasterMegapixelThreshold?: number | undefined;
};
export type PreflightIssue = {
  code: string;
  message: string;
  remediation: string;
  severity: "error" | "warning";
};
export type BleedAssessment = {
  behavior: BleedSpec["behavior"];
  missingMm: EdgeMillimeters;
  presentMm: EdgeMillimeters;
  requiredMm: EdgeMillimeters;
};
export type PrintPreflightDetails = {
  bleed?: BleedAssessment | undefined;
  images: {
    lowDpiCount: number;
    measuredCount: number;
    unavailableCount: number;
  };
};
type EdgeMillimeters = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

/**
 * Read-only, conservative preflight. It reports what is observable from SVG
 * bytes and intentionally does not open linked resources or claim font
 * availability without a platform resolver.
 */
export function preflightSvg(
  source: string,
  profile: PreflightProfile = "basic",
  options: PreflightOptions = {},
): {
  issues: readonly PreflightIssue[];
  print?: PrintPreflightDetails;
  profile: PreflightProfile;
  settings?: ReturnType<typeof inspectSvgSettings>;
} {
  const issues: PreflightIssue[] = [];
  const threshold = validateOptions(options);
  if (/<script\b|\son[a-z]+\s*=/iu.test(source))
    issue(
      issues,
      "SVG_ACTIVE_CONTENT",
      "Scripts or event handlers are present",
      "Remove scripts and event handler attributes before export.",
      "error",
    );
  if (/<foreignObject\b/iu.test(source))
    issue(
      issues,
      "SVG_FOREIGN_OBJECT",
      "foreignObject may not render consistently",
      "Replace foreignObject with portable SVG content if possible.",
      "warning",
    );
  if (hasExternalReference(source))
    issue(
      issues,
      "SVG_EXTERNAL_RESOURCE",
      "External resource reference is present",
      "Embed or remove remote, file, data, and protocol-relative resources.",
      "warning",
    );
  try {
    const settings = inspectSvgSettings(source);
    const inventory = inspectSvgInventory(source, 1_000);
    const document = parseSafeDocument(source);
    for (const warning of settings.warnings)
      issue(
        issues,
        warning,
        viewportWarningMessage(warning),
        "Set concrete width, height and viewBox values before final layout or export.",
        "warning",
      );
    if (inventory.duplicateIds.length > 0)
      issue(
        issues,
        "SVG_DUPLICATE_ID",
        "Duplicate IDs are present",
        "Assign distinct IDs and update references.",
        "error",
      );
    if (inventory.unresolvedReferences.length > 0)
      issue(
        issues,
        "SVG_UNRESOLVED_REFERENCE",
        "Fragment references have no matching ID",
        "Create the referenced IDs or remove the broken references.",
        "warning",
      );
    if (profile === "web")
      addWebIssues(issues, source, document, inventory, settings, threshold);
    const print =
      profile === "print"
        ? addPrintIssues(issues, inventory, settings, options.bleed)
        : undefined;
    if (profile === "interchange")
      addInterchangeIssues(issues, source, document);
    return {
      issues,
      ...(print === undefined ? {} : { print }),
      profile,
      settings,
    };
  } catch (error: unknown) {
    issue(
      issues,
      "SVG_INVALID_DOCUMENT",
      error instanceof Error ? error.message : "SVG could not be inspected",
      "Repair the SVG dimensions, viewBox, and XML structure.",
      "error",
    );
    return { issues, profile };
  }
}

function addWebIssues(
  issues: PreflightIssue[],
  source: string,
  document: XmlDocument,
  inventory: ReturnType<typeof inspectSvgInventory>,
  settings: ReturnType<typeof inspectSvgSettings>,
  rasterMegapixelThreshold: number,
): void {
  if (settings.normalization.viewBox !== "explicit")
    issue(
      issues,
      "WEB_MISSING_VIEWBOX",
      "Web SVG has no explicit viewBox",
      "Set an explicit viewBox so the SVG scales predictably.",
      "warning",
    );
  if (!hasElement(document, "title"))
    issue(
      issues,
      "SVG_MISSING_TITLE",
      "SVG has no title for basic accessibility",
      "Add a concise title element.",
      "warning",
    );
  if (!hasElement(document, "desc"))
    issue(
      issues,
      "SVG_MISSING_DESCRIPTION",
      "SVG has no description for basic accessibility",
      "Add a short desc element for non-visual users.",
      "warning",
    );
  const unnamedImages = elements(document, "image").filter(
    (image) =>
      image.getAttribute("aria-label") === null &&
      image.getAttribute("aria-labelledby") === null,
  ).length;
  if (unnamedImages > 0)
    issue(
      issues,
      "WEB_IMAGE_ACCESSIBLE_NAME_MISSING",
      `${unnamedImages} image element(s) lack an accessible name`,
      "Provide aria-label or aria-labelledby for meaningful images.",
      "warning",
    );
  if (inventory.fontFamilies.length > 0)
    issue(
      issues,
      "WEB_FONT_RESOLUTION_UNAVAILABLE",
      "Declared font families cannot be resolved by this preflight",
      "Use web-safe or embedded fonts and test in each target browser.",
      "warning",
    );
  const largeEmbeddedRasters = inventory.images.filter(
    (image) =>
      image.intrinsic.status === "available" &&
      image.intrinsic.width !== undefined &&
      image.intrinsic.height !== undefined &&
      image.intrinsic.width * image.intrinsic.height >=
        rasterMegapixelThreshold * 1_000_000,
  ).length;
  if (largeEmbeddedRasters > 0)
    issue(
      issues,
      "WEB_LARGE_EMBEDDED_RASTER",
      `${largeEmbeddedRasters} embedded raster image(s) exceed ${rasterMegapixelThreshold} megapixels`,
      "Resize or optimize oversized raster images before web delivery.",
      "warning",
    );
  if (hasExternalReference(source))
    issue(
      issues,
      "WEB_EXTERNAL_REFERENCE",
      "Web SVG depends on an external or embedded URL resource",
      "Embed local assets deliberately and avoid remote URL dependencies.",
      "warning",
    );
}

function addPrintIssues(
  issues: PreflightIssue[],
  inventory: ReturnType<typeof inspectSvgInventory>,
  settings: ReturnType<typeof inspectSvgSettings>,
  bleed: BleedSpec | undefined,
): PrintPreflightDetails {
  const width = parseViewportLength(settings.width);
  const height = parseViewportLength(settings.height);
  if (width.unit === "px" || height.unit === "px")
    issue(
      issues,
      "PRINT_PHYSICAL_SIZE_UNSPECIFIED",
      "Print profile uses a CSS pixel viewport",
      "Set physical page dimensions such as mm or in.",
      "warning",
    );
  if (bleed === undefined)
    issue(
      issues,
      "PRINT_BLEED_SPEC_REQUIRED",
      "No explicit four-sided BleedSpec was supplied",
      "Provide top, right, bottom and left physical bleed values; margins and crop marks are separate features.",
      "warning",
    );
  const assessed = assessBleed(bleed);
  if (inventory.fontFamilies.length > 0)
    issue(
      issues,
      "PRINT_FONT_RESOLUTION_UNAVAILABLE",
      "Declared font families cannot be resolved by this preflight",
      "Confirm installed/embedded fonts or convert approved text to paths in a separate workflow.",
      "warning",
    );
  if (inventory.paintUsage.filters > 0)
    issue(
      issues,
      "PRINT_FILTER_RASTERIZATION_RISK",
      "SVG filters may rasterize or render differently in print export",
      "Inspect the exported PDF at the intended output resolution.",
      "warning",
    );
  const imageDpi = inspectPrintImageDpi(inventory, settings);
  if (imageDpi.lowDpiCount > 0)
    issue(
      issues,
      "PRINT_IMAGE_LOW_EFFECTIVE_DPI",
      `${imageDpi.lowDpiCount} embedded image(s) measure below ${PRINT_DPI_TARGET} DPI`,
      "Use higher-resolution source imagery or reduce its physical display size.",
      "warning",
    );
  if (imageDpi.unavailableCount > 0)
    issue(
      issues,
      "PRINT_IMAGE_EFFECTIVE_DPI_UNAVAILABLE",
      `${imageDpi.unavailableCount} image(s) have unavailable intrinsic or display dimensions`,
      "Embed a supported raster format with explicit dimensions to verify effective DPI.",
      "warning",
    );
  issue(
    issues,
    "PRINT_COLOR_MANAGEMENT_UNVERIFIED",
    "This SVG preflight cannot guarantee CMYK, spot color, or output intent handling",
    "Validate color management in the target print workflow before production.",
    "warning",
  );
  return {
    ...(assessed === undefined ? {} : { bleed: assessed }),
    images: imageDpi,
  };
}

function addInterchangeIssues(
  issues: PreflightIssue[],
  source: string,
  document: XmlDocument,
): void {
  if (/\sinkscape:/iu.test(source))
    issue(
      issues,
      "SVG_INKSCAPE_FEATURES",
      "Inkscape-specific attributes are present",
      "Export plain SVG before interchange if the target lacks Inkscape support.",
      "warning",
    );
  if (hasElement(document, "flowRoot") || hasElement(document, "flowPara"))
    issue(
      issues,
      "INTERCHANGE_FLOW_TEXT",
      "Flowed text is not portable plain SVG",
      "Convert flowed text to regular text or paths after checking the target.",
      "warning",
    );
  if (
    elements(document, "*").some(
      (element) =>
        element.hasAttributeNS(INKSCAPE_NAMESPACE, "path-effect") ||
        element.localName === "path-effect",
    )
  )
    issue(
      issues,
      "INTERCHANGE_LIVE_PATH_EFFECT",
      "Live Path Effects require Inkscape-specific interpretation",
      "Apply or convert live path effects before plain-SVG interchange.",
      "warning",
    );
  if (hasExternalReference(source))
    issue(
      issues,
      "INTERCHANGE_EXTERNAL_REFERENCE",
      "External resource references reduce portable SVG interchange",
      "Embed or remove referenced assets before interchange.",
      "warning",
    );
  if (hasElement(document, "meshgradient") || hasElement(document, "hatch"))
    issue(
      issues,
      "INTERCHANGE_ADVANCED_SVG_FEATURE",
      "The document contains SVG features with variable interchange support",
      "Test the target renderer or flatten the feature in a derived copy.",
      "warning",
    );
}

function inspectPrintImageDpi(
  inventory: ReturnType<typeof inspectSvgInventory>,
  settings: ReturnType<typeof inspectSvgSettings>,
): PrintPreflightDetails["images"] {
  let lowDpiCount = 0;
  let measuredCount = 0;
  let unavailableCount = 0;
  const width = parseViewportLength(settings.width);
  const height = parseViewportLength(settings.height);
  const widthMm = width.unit === "px" ? undefined : toMillimeters(width);
  const heightMm = height.unit === "px" ? undefined : toMillimeters(height);
  for (const image of inventory.images) {
    if (
      image.intrinsic.status !== "available" ||
      image.intrinsic.width === undefined ||
      image.intrinsic.height === undefined
    ) {
      unavailableCount += 1;
      continue;
    }
    const displayWidthMm = displayLengthMm(
      image.display.width,
      widthMm,
      settings.viewBox.width,
    );
    const displayHeightMm = displayLengthMm(
      image.display.height,
      heightMm,
      settings.viewBox.height,
    );
    if (displayWidthMm === undefined || displayHeightMm === undefined) {
      unavailableCount += 1;
      continue;
    }
    const dpiX = (image.intrinsic.width * 25.4) / displayWidthMm;
    const dpiY = (image.intrinsic.height * 25.4) / displayHeightMm;
    measuredCount += 1;
    if (dpiX < PRINT_DPI_TARGET || dpiY < PRINT_DPI_TARGET) lowDpiCount += 1;
  }
  return { lowDpiCount, measuredCount, unavailableCount };
}

function displayLengthMm(
  value: string | undefined,
  viewportMm: number | undefined,
  viewBoxDimension: number,
): number | undefined {
  if (value === undefined) return undefined;
  const match = /^([0-9]+(?:\.[0-9]+)?)(mm|cm|in|pt|pc|q|px)?$/u.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const unit = match[2];
  if (unit === undefined)
    return viewportMm === undefined
      ? undefined
      : (number * viewportMm) / viewBoxDimension;
  return toMillimeters({
    unit: unit as "cm" | "in" | "mm" | "pc" | "pt" | "px" | "q",
    value: number,
  });
}

function assessBleed(
  bleed: BleedSpec | undefined,
): BleedAssessment | undefined {
  if (bleed === undefined) return undefined;
  const requiredMm = edgeMillimeters(bleed);
  // SVG has no standardized persisted bleed box. Until an export adapter
  // materializes it in a derived file, no source-side bleed is claimed.
  const presentMm: EdgeMillimeters = {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  };
  return {
    behavior: bleed.behavior,
    missingMm: requiredMm,
    presentMm,
    requiredMm,
  };
}

function edgeMillimeters(bleed: BleedSpec): EdgeMillimeters {
  return {
    bottom: physicalMillimeters(bleed.bottom),
    left: physicalMillimeters(bleed.left),
    right: physicalMillimeters(bleed.right),
    top: physicalMillimeters(bleed.top),
  };
}

function physicalMillimeters(length: PhysicalLength): number {
  return length.value === 0 ? 0 : toMillimeters(length);
}

function validateOptions(options: PreflightOptions): number {
  const threshold =
    options.rasterMegapixelThreshold ?? DEFAULT_RASTER_MEGAPIXEL_THRESHOLD;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100)
    throw new Error("Raster megapixel threshold is out of range");
  if (options.bleed !== undefined)
    for (const edge of [
      options.bleed.top,
      options.bleed.right,
      options.bleed.bottom,
      options.bleed.left,
    ])
      if (!Number.isFinite(edge.value) || edge.value < 0)
        throw new Error("Bleed values must be finite and nonnegative");
  return threshold;
}

function parseSafeDocument(source: string): XmlDocument {
  const safe = sanitizeSvg(source, {
    maxElements: 100_000,
    maxInputBytes: 50 * 1024 * 1024,
    mode: "preserve-local",
  });
  return new DOMParser().parseFromString(safe.svg, "image/svg+xml");
}

function elements(document: XmlDocument, name: string): XmlElement[] {
  return Array.from(document.getElementsByTagName(name)) as XmlElement[];
}

function hasElement(document: XmlDocument, name: string): boolean {
  return elements(document, name).length > 0;
}

function hasExternalReference(source: string): boolean {
  return /(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|data:|\/\/)/iu.test(
    source,
  );
}

function issue(
  issues: PreflightIssue[],
  code: string,
  message: string,
  remediation: string,
  severity: PreflightIssue["severity"],
): void {
  issues.push({ code, message, remediation, severity });
}

function viewportWarningMessage(
  warning: ReturnType<typeof inspectSvgSettings>["warnings"][number],
): string {
  if (warning.includes("PERCENTAGE"))
    return "Viewport percentage cannot be resolved without an embedding context";
  if (warning.includes("DEFAULTED"))
    return "Viewport dimension is absent and uses the SVG default viewport";
  if (warning.includes("UNITLESS"))
    return "Unitless viewport dimension was normalized to CSS pixels";
  return "viewBox is absent and was inferred from the effective viewport";
}
