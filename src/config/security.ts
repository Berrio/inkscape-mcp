import type { ServerConfig } from "./schema.js";

export type NativeSecurityPosture = {
  maximumSanitizeMode: ServerConfig["maximumSanitizeMode"];
  nativeInputPolicy: ServerConfig["nativeInputPolicy"];
  nativeParserIsolation: "none";
  residualRisks: readonly [string, string];
  securityLevel: "workspace-guarded-native-unsandboxed";
};

/**
 * Describes the boundary that is actually enforced in the current local build.
 * This deliberately does not use the word "sandbox": Job Objects, timeouts,
 * staging and SVG sanitization do not isolate native parser vulnerabilities.
 */
export function nativeSecurityPosture(
  config: ServerConfig,
): NativeSecurityPosture {
  return {
    maximumSanitizeMode: config.maximumSanitizeMode,
    nativeInputPolicy: config.nativeInputPolicy,
    nativeParserIsolation: "none",
    residualRisks: [
      "Native parsers are unsandboxed; process only trusted local inputs.",
      "A hostile local writer can still race filesystem reparse points.",
    ],
    securityLevel: "workspace-guarded-native-unsandboxed",
  };
}
