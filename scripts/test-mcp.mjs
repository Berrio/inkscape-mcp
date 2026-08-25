import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const server = {
  args: ["dist/cli.js"],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};

for (const versionNegotiation of [
  { mode: { pin: "2026-07-28" } },
  { mode: "legacy" },
]) {
  const client = new Client(
    { name: "inkscape-mcp-test-client", version: "0.0.0" },
    { versionNegotiation },
  );
  const transport = new StdioClientTransport(server);
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    if (!tools.some((tool) => tool.name === "inkscape_status")) {
      throw new Error("inkscape_status is not listed");
    }
    const result = await client.callTool({
      arguments: {},
      name: "inkscape_status",
    });
    if (result.isError || result.structuredContent === undefined) {
      throw new Error("inkscape_status did not return structured content");
    }
  } finally {
    await client.close();
  }
}

process.stderr.write("MCP modern and legacy stdio checks passed.\n");
