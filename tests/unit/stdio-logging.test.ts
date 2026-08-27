import { expect, it } from "vitest";

import { writeStdioLog } from "../../src/server/stdio-logging.js";

it("writes structured redacted diagnostics only through its injected stderr sink", () => {
  const lines: string[] = [];
  writeStdioLog("stdio_error", {
    error: "token=abc123 C:\\secret\\document.svg",
    write: (line) => lines.push(line),
  });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toEqual({
    component: "inkscape-mcp",
    error: "token=<redacted> <redacted-path>",
    event: "stdio_error",
    transport: "stdio",
  });
});
