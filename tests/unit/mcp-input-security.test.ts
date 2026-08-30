import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const forbiddenProperties = new Set([
  "argv",
  "args",
  "executable",
  "extraArgs",
  "flags",
  "inkscapeBin",
  "rawActions",
]);

type JsonSchema = {
  enum?: unknown;
  items?: JsonSchema | readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  properties?: Readonly<Record<string, JsonSchema>>;
};

describe("MCP public input security", () => {
  it("rejects executable-like fields and exposes only typed command enums", async () => {
    const client = new Client(
      { name: "mcp-input-security-test", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(
      new StdioClientTransport({
        args: ["dist/cli.js"],
        command: process.execPath,
        cwd: process.cwd(),
        stderr: "pipe",
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(60);
      const forbidden: string[] = [];
      const commands: JsonSchema[] = [];
      for (const tool of tools)
        collectPublicProperties(
          tool.inputSchema as JsonSchema,
          forbidden,
          commands,
        );
      expect(forbidden).toEqual([]);
      expect(commands).toEqual([{ enum: ["L", "T"] }]);

      const rejected = await client.callTool({
        arguments: {
          args: ["--malicious"],
          argv: ["--malicious"],
          executable: "malicious.exe",
          extraArgs: ["--malicious"],
          flags: ["--malicious"],
          inkscapeBin: "malicious.exe",
          rawActions: "malicious",
        },
        name: "inkscape_status",
      });
      expect(rejected.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});

function collectPublicProperties(
  schema: JsonSchema,
  forbidden: string[],
  commands: JsonSchema[],
): void {
  if (schema.properties !== undefined)
    for (const [property, nested] of Object.entries(schema.properties)) {
      if (forbiddenProperties.has(property)) forbidden.push(property);
      if (property === "command") commands.push({ enum: nested.enum });
      collectPublicProperties(nested, forbidden, commands);
    }
  if (Array.isArray(schema.items))
    for (const item of schema.items)
      collectPublicProperties(item, forbidden, commands);
  else if (schema.items !== undefined)
    collectPublicProperties(schema.items, forbidden, commands);
  for (const member of schema.oneOf ?? [])
    collectPublicProperties(member, forbidden, commands);
}
