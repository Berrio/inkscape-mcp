import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-png-backgrounds-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 10 10"><rect x="2" y="2" width="6" height="6" fill="#ff0000"/></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pixel(png, x, y) {
  return [
    ...png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x + 1) * 4),
  ];
}

function requirePixel(actual, expected, label, tolerance = 0) {
  if (
    actual.some(
      (channel, index) => Math.abs(channel - expected[index]) > tolerance,
    )
  )
    throw new Error(`${label} has unexpected RGBA ${actual.join(",")}`);
}

function requireExport(result, background) {
  if (
    result.isError ||
    result.structuredContent?.background !== background ||
    result.structuredContent?.width !== 10 ||
    result.structuredContent?.height !== 10
  )
    throw new Error(`${background} PNG export did not return exact dimensions`);
}

const client = new Client(
  {
    name: "inkscape-mcp-f05-png-backgrounds",
    version: packageMetadata.version,
  },
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

  const path = "f05-png-backgrounds.svg";
  await writeFile(join(workspaceRoot, path), source, "utf8");
  const expectedRevision = revision(await readFile(join(workspaceRoot, path)));
  const transparent = await client.callTool({
    arguments: {
      area: "page",
      background: "transparent",
      expectedRevision,
      outputPath: "transparent.png",
      path,
      width: 10,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  requireExport(transparent, "transparent");
  const transparentPng = decodePngRgba(
    await readFile(join(workspaceRoot, "transparent.png")),
  );
  if (pixel(transparentPng, 0, 0)[3] !== 0)
    throw new Error("transparent PNG corner has visible alpha");
  requirePixel(
    pixel(transparentPng, 5, 5),
    [255, 0, 0, 255],
    "transparent foreground",
  );

  const solid = await client.callTool({
    arguments: {
      area: "page",
      background: "solid",
      backgroundColor: "#123456",
      backgroundOpacity: 0.5,
      expectedRevision,
      outputPath: "solid.png",
      path,
      width: 10,
      workspaceId: workspace.id,
    },
    name: "export_png",
  });
  requireExport(solid, "solid");
  const solidPng = decodePngRgba(
    await readFile(join(workspaceRoot, "solid.png")),
  );
  requirePixel(
    pixel(solidPng, 0, 0),
    [0x12, 0x34, 0x56, 128],
    "solid background",
    1,
  );
  requirePixel(pixel(solidPng, 5, 5), [255, 0, 0, 255], "solid foreground");
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("PNG export modified its SVG source");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 PNG background MCP checks passed.\n");
