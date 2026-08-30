import type { ExportBatchMode } from "./batch.js";
import type { ExportPreset, ExportSpec } from "./spec.js";

export type ExportBatchManifest = {
  commitMarker?: string;
  durationMs: number;
  failures: readonly { index: number; message: string }[];
  inkscapeVersion?: string;
  mode: ExportBatchMode;
  presetMetadata?: ExportPreset["metadata"];
  publication: "file_commit_batch" | "file_commit_each" | "manifest_commit";
  source: ExportSpec["source"];
  variants: readonly {
    format: ExportSpec["format"];
    index: number;
    outputPath: string;
    revision: string;
  }[];
};

/** Creates a portable, response-safe record of a finished export batch. */
export function createExportBatchManifest(
  request: ExportBatchManifest,
): ExportBatchManifest {
  if (!Number.isInteger(request.durationMs) || request.durationMs < 0)
    throw new Error("Export batch manifest duration is invalid");
  if (
    request.inkscapeVersion !== undefined &&
    !/^\d+(?:\.\d+){1,3}(?:\s*\([^\r\n)]*\))?$/u.test(request.inkscapeVersion)
  )
    throw new Error("Export batch manifest Inkscape version is invalid");
  return {
    ...(request.commitMarker === undefined
      ? {}
      : { commitMarker: request.commitMarker }),
    durationMs: request.durationMs,
    failures: request.failures.map((failure) => ({ ...failure })),
    ...(request.inkscapeVersion === undefined
      ? {}
      : { inkscapeVersion: request.inkscapeVersion }),
    mode: request.mode,
    ...(request.presetMetadata === undefined
      ? {}
      : { presetMetadata: { ...request.presetMetadata } }),
    publication: request.publication,
    source: { ...request.source },
    variants: request.variants.map((variant) => ({ ...variant })),
  };
}
