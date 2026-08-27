import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

type VsCodeMcpConfig = {
  servers: Record<string, { args: string[]; command: string; type: string }>;
};

describe("VS Code MCP example", () => {
  it("uses the documented stdio schema and this server command", async () => {
    const raw = await readFile("docs/examples/vscode-mcp.json", "utf8");
    const parsed = JSON.parse(raw) as VsCodeMcpConfig;
    const server = parsed.servers["inkscape-mcp"];

    expect(server).toEqual({
      args: [
        "C:\\ruta\\a\\InKscape-MCP\\dist\\cli.js",
        "--workspace-root",
        "${workspaceFolder}",
      ],
      command: "node",
      type: "stdio",
    });
  });
});
