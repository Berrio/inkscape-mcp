import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f04-read-only-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="80px" viewBox="0 0 100 80"><title>Read-only fixture</title><desc>Safe inspection fixture</desc><rect id="shape" x="10" y="10" width="60" height="40" fill="#123456"/></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceState(path) {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  return { mtimeMs: metadata.mtimeMs, revision: revision(bytes) };
}

async function requireUnchanged(path, expected, label) {
  const actual = await sourceState(path);
  if (
    actual.revision !== expected.revision ||
    actual.mtimeMs !== expected.mtimeMs
  )
    throw new Error(`${label} modified the SVG source`);
}

const client = new Client(
  { name: "inkscape-mcp-f04-read-only", version: packageMetadata.version },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport(server);

try {
  await client.connect(transport);
  const listed = await client.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = listed.structuredContent?.workspaces?.[0];
  if (listed.isError || typeof workspace?.id !== "string")
    throw new Error("workspace_list did not return an authorized workspace");

  const path = "f04-read-only.svg";
  const absolutePath = join(workspaceRoot, path);
  await writeFile(absolutePath, source, "utf8");
  const fixedTime = new Date("2024-01-02T03:04:05.000Z");
  await utimes(absolutePath, fixedTime, fixedTime);
  const before = await sourceState(absolutePath);

  const inspection = await client.callTool({
    arguments: {
      expectedRevision: before.revision,
      includeVisualBounds: true,
      level: "deep",
      path,
      workspaceId: workspace.id,
    },
    name: "document_inspect",
  });
  if (
    inspection.isError ||
    inspection.structuredContent?.inventory === undefined
  )
    throw new Error(
      "document_inspect did not complete its read-only inspection",
    );
  await requireUnchanged(absolutePath, before, "document_inspect");

  const preflight = await client.callTool({
    arguments: {
      path,
      profile: "web",
      workspaceId: workspace.id,
    },
    name: "document_preflight",
  });
  if (preflight.isError || preflight.structuredContent?.profile !== "web")
    throw new Error(
      "document_preflight did not complete its read-only inspection",
    );
  await requireUnchanged(absolutePath, before, "document_preflight");

  const preview = await client.callTool({
    arguments: {
      expectedRevision: before.revision,
      outputPath: "f04-read-only-preview.png",
      path,
      width: 100,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (preview.isError || preview.structuredContent?.artifact === undefined)
    throw new Error("document_render_preview did not publish its derivative");
  await requireUnchanged(absolutePath, before, "document_render_preview");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F04 read-only MCP checks passed.\n");
