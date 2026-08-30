import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f03-page-settings-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertDocumentBackground(png) {
  for (let offset = 0; offset < png.rgba.length; offset += 4) {
    if (
      png.rgba[offset] !== 0x12 ||
      png.rgba[offset + 1] !== 0x34 ||
      png.rgba[offset + 2] !== 0x56 ||
      Math.abs(png.rgba[offset + 3] - 128) > 1
    )
      throw new Error("document PNG background did not use page settings");
  }
}

const client = new Client(
  { name: "inkscape-mcp-f03-page-settings", version: packageMetadata.version },
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

  const path = "f03-page-settings.svg";
  await writeFile(
    join(workspaceRoot, path),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 10 10"/>',
    "utf8",
  );
  const initialRevision = revision(await readFile(join(workspaceRoot, path)));
  const updated = await client.callTool({
    arguments: {
      expectedRevision: initialRevision,
      path,
      settings: {
        borderColor: "#0a0b0c",
        borderOpacity: 0.25,
        deskColor: "#f0e0d0",
        pageColor: "#123456",
        pageOpacity: 0.5,
      },
      workspaceId: workspace.id,
    },
    name: "document_settings",
  });
  const updatedRevision = updated.structuredContent?.revision;
  const expectedSettings = {
    borderColor: "#0a0b0c",
    borderOpacity: 0.25,
    deskColor: "#f0e0d0",
    pageColor: "#123456",
    pageOpacity: 0.5,
  };
  if (
    updated.isError ||
    typeof updatedRevision !== "string" ||
    JSON.stringify(updated.structuredContent?.settings) !==
      JSON.stringify(expectedSettings)
  )
    throw new Error("document_settings did not persist every typed setting");

  const readBack = await client.callTool({
    arguments: {
      expectedRevision: updatedRevision,
      path,
      workspaceId: workspace.id,
    },
    name: "document_settings",
  });
  if (
    readBack.isError ||
    readBack.structuredContent?.revision !== updatedRevision ||
    JSON.stringify(readBack.structuredContent?.settings) !==
      JSON.stringify(expectedSettings)
  )
    throw new Error("document_settings did not round-trip persisted values");

  const exported = await client.callTool({
    arguments: {
      area: "page",
      background: "document",
      expectedRevision: updatedRevision,
      outputPath: "f03-page-settings.png",
      path,
      width: 8,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  if (
    exported.isError ||
    exported.structuredContent?.background !== "document" ||
    exported.structuredContent?.width !== 8
  )
    throw new Error("export_png did not report document background mode");
  assertDocumentBackground(
    decodePngRgba(await readFile(join(workspaceRoot, "f03-page-settings.png"))),
  );
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F03 page settings MCP checks passed.\n");
