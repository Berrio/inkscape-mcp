import type { ServerConfig } from "./schema.js";

export type RedactedConfig = {
  backupPolicy: ServerConfig["backupPolicy"];
  externalResources: ServerConfig["externalResources"];
  http: ServerConfig["http"];
  inkscapeBin: "auto" | "configured";
  limits: {
    maxArtifactBytes: number;
    maxConcurrency: number;
    maxDecodedRasterBytes: number;
    maxInlineBytes: number;
    maxInputBytes: number;
    maxOperationsPerCall: number;
    maxRasterMegapixels: number;
    maxResourceReadBytes: number;
    maxStderrBytes: number;
    maxStdoutBytes: number;
    processTimeoutMs: number;
  };
  maximumSanitizeMode: ServerConfig["maximumSanitizeMode"];
  nativeInputPolicy: ServerConfig["nativeInputPolicy"];
  overwriteDefault: false;
  scratchRoot: "auto" | "configured";
  transport: ServerConfig["transport"];
  workspaceRootCount: number;
  workspaceReady: boolean;
};

export function redactConfig(config: ServerConfig): RedactedConfig {
  return {
    backupPolicy: config.backupPolicy,
    externalResources: config.externalResources,
    http: config.http,
    inkscapeBin: config.inkscapeBin === "auto" ? "auto" : "configured",
    limits: {
      maxArtifactBytes: config.maxArtifactBytes,
      maxConcurrency: config.maxConcurrency,
      maxDecodedRasterBytes: config.maxDecodedRasterBytes,
      maxInlineBytes: config.maxInlineBytes,
      maxInputBytes: config.maxInputBytes,
      maxOperationsPerCall: config.maxOperationsPerCall,
      maxRasterMegapixels: config.maxRasterMegapixels,
      maxResourceReadBytes: config.maxResourceReadBytes,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      processTimeoutMs: config.processTimeoutMs,
    },
    maximumSanitizeMode: config.maximumSanitizeMode,
    nativeInputPolicy: config.nativeInputPolicy,
    overwriteDefault: false,
    scratchRoot: config.scratchRoot === "auto" ? "auto" : "configured",
    transport: config.transport,
    workspaceRootCount: config.workspaceRoots.length,
    workspaceReady: config.workspaceRoots.length > 0,
  };
}
