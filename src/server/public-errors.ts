import { ProtocolError } from "@modelcontextprotocol/server";

import { redactDiagnostic } from "../config/index.js";

const MAX_PUBLIC_ERROR_LENGTH = 4_096;

/** Stable, path-free descriptions for Node.js system errors. */
const SYSTEM_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  EACCES: "File system access was denied",
  EBUSY: "File is locked by another program",
  EEXIST: "File system entry already exists",
  EISDIR: "Expected a file but found a directory",
  EMFILE: "Too many open files",
  ENAMETOOLONG: "File system path is too long",
  ENOENT: "File system entry is unavailable",
  ENOSPC: "Not enough disk space",
  ENOTDIR: "Expected a directory but found a file",
  ENOTEMPTY: "Directory is not empty",
  EPERM: "File system operation is not permitted",
  EXDEV: "Cross-device file operation is not supported",
};

/**
 * Converts any thrown value into text that is safe to return over MCP.
 * Node.js system errors embed absolute paths (`ENOENT … realpath 'C:\…'`),
 * so they are replaced by a stable description plus their error code; any
 * other message is passed through path/secret redaction.
 */
export function publicErrorMessage(error: unknown): string {
  const code = systemErrorCode(error);
  if (code !== undefined)
    return `${SYSTEM_ERROR_MESSAGES[code] ?? "File system operation failed"} (${code})`;
  const message = error instanceof Error ? error.message : String(error);
  return redactDiagnostic(message).slice(0, MAX_PUBLIC_ERROR_LENGTH);
}

/** Error thrown by wrapped handlers; it never carries the original cause. */
export class PublicToolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicToolError";
  }
}

/**
 * Wraps an MCP handler so every failure crosses the protocol boundary through
 * {@link publicErrorMessage}. Protocol errors are control flow for the SDK
 * (for example URL elicitation) and keep their identity after redaction.
 */
export function withPublicErrors<Args extends unknown[], Result>(
  handler: (...args: Args) => Promise<Result> | Result,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ProtocolError) {
        const redacted = publicErrorMessage(error);
        if (redacted === error.message) throw error;
        throw new ProtocolError(error.code, redacted);
      }
      throw new PublicToolError(publicErrorMessage(error));
    }
  };
}

function systemErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const { code, errno, syscall } = error as NodeJS.ErrnoException;
  return typeof code === "string" &&
    /^E[A-Z0-9]+$/u.test(code) &&
    (syscall !== undefined || errno !== undefined)
    ? code
    : undefined;
}
