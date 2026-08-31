import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-f08-absent-"));
const client = new Client(
  {
    name: "inkscape-mcp-f08-absent-capabilities",
    version: packageMetadata.version,
  },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport({
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
});

function requireSuccess(result, label) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${label} returned an MCP error`);
  return result.structuredContent;
}

async function requireRecoverableFailure(invocation, label) {
  try {
    const result = await invocation();
    if (!result.isError)
      throw new Error(`${label} unexpectedly returned success`);
  } catch (error) {
    if (error?.code !== -32602) throw error;
  }
}

function catalogFingerprint(tools) {
  return JSON.stringify(
    tools
      .map((tool) => ({
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
        outputSchema: tool.outputSchema,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

try {
  await client.connect(transport);
  const catalogBefore = await client.listTools();
  const beforeFingerprint = catalogFingerprint(catalogBefore.tools);
  const capabilities = requireSuccess(
    await client.callTool({
      arguments: {},
      name: "document_import_capabilities",
    }),
    "document_import_capabilities",
  );
  const blocked = capabilities.nativeImportGates?.find(
    (gate) => gate.status !== "available",
  );
  if (!blocked || typeof blocked.format !== "string")
    throw new Error(
      "The local capability report did not expose a blocked format",
    );

  const unavailableTool = `document_import_${blocked.format}`;
  if (catalogBefore.tools.some((tool) => tool.name === unavailableTool))
    throw new Error(`${unavailableTool} was unexpectedly published`);
  await requireRecoverableFailure(
    () => client.callTool({ arguments: {}, name: unavailableTool }),
    unavailableTool,
  );

  const workspaces = requireSuccess(
    await client.callTool({ arguments: {}, name: "workspace_list" }),
    "workspace_list",
  );
  const workspaceId = workspaces.workspaces?.[0]?.id;
  if (typeof workspaceId !== "string")
    throw new Error("workspace_list did not return an opaque workspace ID");
  const source = requireSuccess(
    await client.callTool({
      arguments: {
        height: 20,
        outputPath: "source.svg",
        unit: "mm",
        width: 40,
        workspaceId,
      },
      name: "document_create",
    }),
    "document_create",
  );
  const unsupportedOutput = "must-not-publish.xaml";
  await requireRecoverableFailure(
    () =>
      client.callTool({
        arguments: {
          spec: {
            area: { kind: "drawing" },
            format: "xaml",
            source: { expectedRevision: source.revision, path: "source.svg" },
            target: {
              kind: "file",
              overwrite: false,
              path: unsupportedOutput,
            },
          },
          workspaceId,
        },
        name: "document_export",
      }),
    "document_export with unannounced XAML",
  );
  if (existsSync(join(workspaceRoot, unsupportedOutput)))
    throw new Error("a rejected XAML export published an output");

  const catalogAfter = await client.listTools();
  if (catalogFingerprint(catalogAfter.tools) !== beforeFingerprint)
    throw new Error(
      "an absent capability attempt changed the MCP tool catalog",
    );
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F08 absent capability MCP checks passed.\n");
