import type { Artifact } from "../storage/index.js";
import type { ExportSpec } from "./spec.js";

export type ExportManifest = {
  artifacts: readonly Artifact[];
  durationMs: number;
  inkscapeVersion: string;
  normalizedRequest: ExportSpec;
  strategy: "directory_rename" | "manifest_commit" | "single_file";
  warnings: readonly string[];
};

export function createExportManifest(request: {
  artifacts: readonly Artifact[];
  durationMs: number;
  inkscapeVersion: string;
  normalizedRequest: ExportSpec;
  strategy: ExportManifest["strategy"];
  warnings?: readonly string[] | undefined;
}): ExportManifest {
  if (!Number.isInteger(request.durationMs) || request.durationMs < 0)
    throw new Error("Export manifest duration is invalid");
  if (
    !/^\d+\.\d+(?:\.\d+)?(?:[-+][A-Za-z0-9.-]+)?$/u.test(
      request.inkscapeVersion,
    )
  )
    throw new Error("Export manifest Inkscape version is invalid");
  return {
    artifacts: [...request.artifacts],
    durationMs: request.durationMs,
    inkscapeVersion: request.inkscapeVersion,
    normalizedRequest: request.normalizedRequest,
    strategy: request.strategy,
    warnings: [...(request.warnings ?? [])].sort(),
  };
}
