import type { ExportSpec } from "./spec.js";

export type ExportBatchMode = "all_or_nothing" | "best_effort";
export type PlannedExportVariant = {
  format: ExportSpec["format"];
  index: number;
  outputPath: string;
  spec: ExportSpec;
};

/** Validates deterministic, collision-free single-file variants before rendering. */
export function planExportBatch(
  specs: readonly ExportSpec[],
): readonly PlannedExportVariant[] {
  if (specs.length < 1 || specs.length > 50)
    throw new Error("An export batch must contain between 1 and 50 variants");
  const outputs = new Set<string>();
  return specs.map((spec, index) => {
    if (spec.target.kind !== "file")
      throw new Error(
        "Nested multi-output targets are not valid batch variants",
      );
    const key = spec.target.path.replace(/\\/gu, "/").toLocaleLowerCase();
    if (outputs.has(key)) throw new Error("Export batch output paths collide");
    outputs.add(key);
    return {
      format: spec.format,
      index,
      outputPath: spec.target.path,
      spec,
    };
  });
}
