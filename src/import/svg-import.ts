import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { sanitizeSvg, type SanitizeMode } from "../svg/index.js";

export type SvgImportFormat = "svg" | "svgz";
export type SanitizedSvgImport = {
  format: SvgImportFormat;
  inputBytes: number;
  removed: readonly string[];
  sourceSha256: string;
  svg: string;
};

/**
 * Decodes a workspace-local SVG/SVGZ under a hard output limit and sanitizes
 * it before it can become an editable document. It never resolves resources.
 */
export function importSanitizedSvg(
  input: Buffer,
  options: {
    format: SvgImportFormat;
    maxInputBytes: number;
    maximumMode: SanitizeMode;
    mode: SanitizeMode;
  },
): SanitizedSvgImport {
  if (!Number.isSafeInteger(options.maxInputBytes) || options.maxInputBytes < 1)
    throw new Error("SVG import size limit is invalid");
  if (input.length > options.maxInputBytes)
    throw new Error("SVG import exceeds the configured size limit");
  const decoded =
    options.format === "svg"
      ? input
      : decompressSvgz(input, options.maxInputBytes);
  if (decoded.length > options.maxInputBytes)
    throw new Error("SVG import exceeds the configured size limit");
  const sanitized = sanitizeSvg(decoded.toString("utf8"), {
    maxElements: 100_000,
    maxInputBytes: options.maxInputBytes,
    maximumMode: options.maximumMode,
    mode: options.mode,
  });
  return {
    format: options.format,
    inputBytes: input.length,
    removed: sanitized.removed,
    sourceSha256: createHash("sha256").update(input).digest("hex"),
    svg: sanitized.svg,
  };
}

function decompressSvgz(input: Buffer, maxOutputBytes: number): Buffer {
  if (input.length < 2 || input[0] !== 0x1f || input[1] !== 0x8b)
    throw new Error("SVGZ input is not a gzip stream");
  try {
    return gunzipSync(input, { maxOutputLength: maxOutputBytes });
  } catch (error) {
    if (isOutputLimitError(error))
      throw new Error(
        "SVGZ decompressed input exceeds the configured size limit",
        { cause: error },
      );
    throw new Error("SVGZ input cannot be decompressed", { cause: error });
  }
}

function isOutputLimitError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_BUFFER_TOO_LARGE"
  );
}
