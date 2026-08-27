import { redactDiagnostic } from "../config/index.js";

export type StdioLogEvent = "stdio_error" | "stdio_listening";

/** Writes bounded structured diagnostics without ever touching MCP stdout. */
export function writeStdioLog(
  event: StdioLogEvent,
  options: {
    error?: string;
    write?: (line: string) => void;
  } = {},
): void {
  const record = {
    component: "inkscape-mcp",
    ...(options.error === undefined
      ? {}
      : { error: redactDiagnostic(options.error).slice(0, 4_096) }),
    event,
    transport: "stdio",
  };
  (options.write ?? process.stderr.write.bind(process.stderr))(
    `${JSON.stringify(record)}\n`,
  );
}
