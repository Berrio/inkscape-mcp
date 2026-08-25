import { inspectSvgSettings } from "./basic.js";

export type PreflightIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};
export function preflightSvg(source: string): {
  issues: readonly PreflightIssue[];
  settings?: ReturnType<typeof inspectSvgSettings>;
} {
  const issues: PreflightIssue[] = [];
  if (/<script\b|\son[a-z]+\s*=/iu.test(source))
    issues.push({
      code: "SVG_ACTIVE_CONTENT",
      message: "Scripts or event handlers are present",
      severity: "error",
    });
  if (/<foreignObject\b/iu.test(source))
    issues.push({
      code: "SVG_FOREIGN_OBJECT",
      message: "foreignObject may not render consistently",
      severity: "warning",
    });
  if (
    /(?:href|xlink:href)\s*=\s*["'](?:https?:|file:|data:|\/\/)/iu.test(source)
  )
    issues.push({
      code: "SVG_EXTERNAL_RESOURCE",
      message: "External resource reference is present",
      severity: "warning",
    });
  try {
    return { issues, settings: inspectSvgSettings(source) };
  } catch (error: unknown) {
    issues.push({
      code: "SVG_INVALID_DOCUMENT",
      message:
        error instanceof Error ? error.message : "SVG could not be inspected",
      severity: "error",
    });
    return { issues };
  }
}
