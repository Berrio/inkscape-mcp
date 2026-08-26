import { inspectSvgSettings, parseViewportLength } from "./basic.js";
import { inspectSvgInventory } from "./inventory.js";

export type PreflightProfile = "basic" | "interchange" | "print" | "web";
export type PreflightIssue = {
  code: string;
  message: string;
  remediation: string;
  severity: "error" | "warning";
};
export function preflightSvg(
  source: string,
  profile: PreflightProfile = "basic",
): {
  issues: readonly PreflightIssue[];
  profile: PreflightProfile;
  settings?: ReturnType<typeof inspectSvgSettings>;
} {
  const issues: PreflightIssue[] = [];
  if (/<script\b|\son[a-z]+\s*=/iu.test(source))
    issues.push({
      code: "SVG_ACTIVE_CONTENT",
      message: "Scripts or event handlers are present",
      remediation: "Remove scripts and event handler attributes before export.",
      severity: "error",
    });
  if (/<foreignObject\b/iu.test(source))
    issues.push({
      code: "SVG_FOREIGN_OBJECT",
      message: "foreignObject may not render consistently",
      remediation:
        "Replace foreignObject with portable SVG content if possible.",
      severity: "warning",
    });
  if (
    /(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|data:|\/\/)/iu.test(source)
  )
    issues.push({
      code: "SVG_EXTERNAL_RESOURCE",
      message: "External resource reference is present",
      remediation:
        "Embed or remove remote, file, data, and protocol-relative resources.",
      severity: "warning",
    });
  try {
    const settings = inspectSvgSettings(source);
    const inventory = inspectSvgInventory(source);
    if (inventory.duplicateIds.length > 0)
      issues.push({
        code: "SVG_DUPLICATE_ID",
        message: "Duplicate IDs are present",
        remediation: "Assign distinct IDs and update references.",
        severity: "error",
      });
    if (inventory.unresolvedReferences.length > 0)
      issues.push({
        code: "SVG_UNRESOLVED_REFERENCE",
        message: "Fragment references have no matching ID",
        remediation:
          "Create the referenced IDs or remove the broken references.",
        severity: "warning",
      });
    if (profile === "web" && !/<title\b/iu.test(source))
      issues.push({
        code: "SVG_MISSING_TITLE",
        message: "SVG has no title for basic accessibility",
        remediation: "Add a concise title element.",
        severity: "warning",
      });
    if (profile === "print") {
      const width = parseViewportLength(settings.width);
      const height = parseViewportLength(settings.height);
      if (width.unit === "px" || height.unit === "px")
        issues.push({
          code: "PRINT_PHYSICAL_SIZE_UNSPECIFIED",
          message: "Print profile uses a CSS pixel viewport",
          remediation: "Set physical page dimensions such as mm or in.",
          severity: "warning",
        });
    }
    if (profile === "interchange" && /\sinkscape:/iu.test(source))
      issues.push({
        code: "SVG_INKSCAPE_FEATURES",
        message: "Inkscape-specific attributes are present",
        remediation:
          "Export plain SVG before interchange if the target lacks Inkscape support.",
        severity: "warning",
      });
    return { issues, profile, settings };
  } catch (error: unknown) {
    issues.push({
      code: "SVG_INVALID_DOCUMENT",
      message:
        error instanceof Error ? error.message : "SVG could not be inspected",
      remediation: "Repair the SVG dimensions, viewBox, and XML structure.",
      severity: "error",
    });
    return { issues, profile };
  }
}
