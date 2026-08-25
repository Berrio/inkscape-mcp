import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-mcp-test-"));
const workspaceTransport = new StdioClientTransport({
  ...server,
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
});
const workspaceClient = new Client(
  { name: "inkscape-mcp-workspace-client", version: "0.0.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
try {
  await workspaceClient.connect(workspaceTransport);
  const workspaceResult = await workspaceClient.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = workspaceResult.structuredContent?.workspaces?.[0];
  if (!workspace || typeof workspace.id !== "string") {
    throw new Error("workspace_list did not return an opaque workspace ID");
  }
  const created = await workspaceClient.callTool({
    arguments: {
      height: 297,
      outputPath: "a4.svg",
      unit: "mm",
      width: 210,
      workspaceId: workspace.id,
    },
    name: "document_create",
  });
  if (
    created.isError ||
    !(await readFile(join(workspaceRoot, "a4.svg"), "utf8")).includes(
      'width="210mm"',
    )
  ) {
    throw new Error("document_create did not publish the expected A4 SVG");
  }
  const revision = created.structuredContent?.revision;
  if (typeof revision !== "string") {
    throw new Error("document_create did not return a revision");
  }
  const resized = await workspaceClient.callTool({
    arguments: {
      expectedRevision: revision,
      height: 210,
      path: "a4.svg",
      unit: "mm",
      width: 148,
      workspaceId: workspace.id,
    },
    name: "document_resize",
  });
  if (
    resized.isError ||
    !(await readFile(join(workspaceRoot, "a4.svg"), "utf8")).includes(
      'viewBox="0 0 148 210"',
    )
  ) {
    throw new Error("document_resize did not apply page_only semantics");
  }
  const resizedRevision = resized.structuredContent?.revision;
  if (typeof resizedRevision !== "string") {
    throw new Error("document_resize did not return a revision");
  }
  const exported = await workspaceClient.callTool({
    arguments: {
      expectedRevision: resizedRevision,
      outputPath: "a4.png",
      path: "a4.svg",
      width: 400,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (exported.isError || exported.structuredContent?.width !== 400) {
    throw new Error("export_png did not publish the expected PNG");
  }
  const pdf = await workspaceClient.callTool({
    arguments: {
      expectedRevision: resizedRevision,
      outputPath: "a4.pdf",
      path: "a4.svg",
      pdfVersion: "1.5",
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  if (pdf.isError || pdf.structuredContent?.version !== "1.5") {
    throw new Error("export_pdf did not publish the expected PDF");
  }
  const plainSvg = await workspaceClient.callTool({
    arguments: {
      expectedRevision: resizedRevision,
      flavor: "plain",
      outputPath: "a4-plain.svg",
      path: "a4.svg",
      workspaceId: workspace.id,
    },
    name: "export_svg",
  });
  if (plainSvg.isError || plainSvg.structuredContent?.flavor !== "plain") {
    throw new Error("export_svg did not publish the expected plain SVG");
  }
} finally {
  await workspaceClient.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("MCP modern and legacy stdio checks passed.\n");
