import type { NormalizedExportArea } from "./area.js";
import type { ExportSpec } from "./spec.js";

export type ExportArgvRequest = {
  area: NormalizedExportArea;
  inputPath: string;
  outputPath: string;
  spec: ExportSpec;
};

/** Builds fixed argv arrays from a validated discriminated export specification.
 * Input and output paths are resolved by infrastructure before this boundary. */
export function buildExportArgv(request: ExportArgvRequest): readonly string[] {
  const base = [
    request.inputPath,
    `--export-filename=${request.outputPath}`,
    ...request.area.args,
  ];
  if (request.spec.format === "png")
    return ["--export-type=png", ...base, ...pngArguments(request.spec)];
  if (request.spec.format === "pdf")
    return ["--export-type=pdf", ...base, ...pdfArguments(request.spec)];
  if (
    request.spec.format === "svg" ||
    request.spec.format === "plain-svg" ||
    request.spec.format === "svgz"
  )
    return [
      `--export-type=${request.spec.format === "plain-svg" ? "svg" : request.spec.format}`,
      ...base,
      ...(request.spec.format === "plain-svg" ? ["--export-plain-svg"] : []),
      ...(request.spec.text === "paths" ? ["--export-text-to-path"] : []),
    ];
  if (request.spec.format === "ps" || request.spec.format === "eps")
    return [
      `--export-type=${request.spec.format}`,
      ...base,
      `--export-ps-level=${request.spec.level}`,
      ...(request.spec.text === "paths" ? ["--export-text-to-path"] : []),
      ...(request.spec.filterRasterDpi === undefined
        ? []
        : [`--export-filter-dpi=${request.spec.filterRasterDpi}`]),
    ];
  return [`--export-type=${request.spec.format}`, ...base];
}

function pngArguments(spec: Extract<ExportSpec, { format: "png" }>): string[] {
  const argumentsList: string[] = [];
  if (spec.size?.mode === "dpi")
    argumentsList.push(`--export-dpi=${spec.size.dpi}`);
  if (spec.size?.mode === "width")
    argumentsList.push(`--export-width=${spec.size.widthPx}`);
  if (spec.size?.mode === "height")
    argumentsList.push(`--export-height=${spec.size.heightPx}`);
  if (spec.size?.mode === "exact")
    argumentsList.push(
      `--export-width=${spec.size.widthPx}`,
      `--export-height=${spec.size.heightPx}`,
    );
  if (spec.background.mode === "transparent")
    argumentsList.push("--export-background-opacity=0");
  if (spec.background.mode === "solid")
    argumentsList.push(
      `--export-background=${spec.background.color}`,
      `--export-background-opacity=${spec.background.opacity}`,
    );
  if (spec.compression !== undefined)
    argumentsList.push(`--export-png-compression=${spec.compression}`);
  if (spec.antialias !== undefined)
    argumentsList.push(`--export-png-antialias=${spec.antialias}`);
  return argumentsList;
}

function pdfArguments(spec: Extract<ExportSpec, { format: "pdf" }>): string[] {
  return [
    ...(spec.version === undefined
      ? []
      : [`--export-pdf-version=${spec.version}`]),
    ...(spec.text === "paths" ? ["--export-text-to-path"] : []),
    ...(spec.filterRasterDpi === undefined
      ? []
      : [`--export-filter-dpi=${spec.filterRasterDpi}`]),
  ];
}
