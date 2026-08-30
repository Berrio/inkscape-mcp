import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f04-preview-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="100px" viewBox="0 0 200 100"><rect id="left" x="20" y="10" width="60" height="80" fill="#ff0000"/><rect id="right" x="120" y="25" width="60" height="50" fill="#0000ff"/></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requirePreview(result, label) {
  if (result.isError || result.structuredContent?.artifact === undefined)
    throw new Error(`${label} did not return a preview`);
  return result.structuredContent;
}

function pixel(png, x, y) {
  return [
    ...png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x + 1) * 4),
  ];
}

function requirePixel(actual, expected, label) {
  if (actual.some((channel, index) => channel !== expected[index]))
    throw new Error(`${label} has unexpected RGBA ${actual.join(",")}`);
}

function requireTransparent(actual, label) {
  if (actual[3] !== 0)
    throw new Error(`${label} is not transparent: ${actual.join(",")}`);
}

const client = new Client(
  { name: "inkscape-mcp-f04-preview", version: packageMetadata.version },
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

  const path = "f04-preview.svg";
  await writeFile(join(workspaceRoot, path), source, "utf8");
  const expectedRevision = revision(await readFile(join(workspaceRoot, path)));
  const page = requirePreview(
    await client.callTool({
      arguments: {
        area: "page",
        expectedRevision,
        height: 100,
        outputPath: "page.png",
        path,
        width: 200,
        workspaceId: workspace.id,
      },
      name: "document_render_preview",
    }),
    "page preview",
  );
  if (
    page.area !== "page" ||
    page.cache !== "miss" ||
    page.height !== 100 ||
    page.width !== 200 ||
    page.inline !== true ||
    !page.artifact.uri.startsWith("inkscape://artifact/")
  )
    throw new Error("page preview did not report its exact bounded metadata");
  const pagePng = decodePngRgba(
    await readFile(join(workspaceRoot, "page.png")),
  );
  if (pagePng.width !== 200 || pagePng.height !== 100)
    throw new Error("page preview PNG dimensions are not exact");
  requireTransparent(pixel(pagePng, 0, 0), "transparent page corner");
  requirePixel(pixel(pagePng, 50, 50), [255, 0, 0, 255], "red page object");
  requirePixel(pixel(pagePng, 150, 50), [0, 0, 255, 255], "blue page object");

  const cached = requirePreview(
    await client.callTool({
      arguments: {
        area: "page",
        expectedRevision,
        height: 100,
        outputPath: "page-cached.png",
        path,
        width: 200,
        workspaceId: workspace.id,
      },
      name: "document_render_preview",
    }),
    "cached page preview",
  );
  if (
    cached.cache !== "hit" ||
    cached.revision !== page.revision ||
    !(await readFile(join(workspaceRoot, "page.png"))).equals(
      await readFile(join(workspaceRoot, "page-cached.png")),
    )
  )
    throw new Error("page preview cache did not reproduce the cached PNG");

  const drawing = requirePreview(
    await client.callTool({
      arguments: {
        area: "drawing",
        expectedRevision,
        outputPath: "drawing.png",
        path,
        width: 200,
        workspaceId: workspace.id,
      },
      name: "document_render_preview",
    }),
    "drawing preview",
  );
  if (
    drawing.area !== "drawing" ||
    drawing.width !== 200 ||
    drawing.height !== 100
  )
    throw new Error("drawing preview did not use its normalized drawing area");

  const selection = requirePreview(
    await client.callTool({
      arguments: {
        area: "selection",
        expectedRevision,
        outputPath: "selection.png",
        path,
        selectionId: "right",
        width: 120,
        workspaceId: workspace.id,
      },
      name: "document_render_preview",
    }),
    "selection preview",
  );
  if (
    selection.area !== "selection" ||
    selection.selectionId !== "right" ||
    selection.width !== 120 ||
    selection.height !== 100
  )
    throw new Error(
      "selection preview did not crop and scale the selected object",
    );
  const selectionPng = decodePngRgba(
    await readFile(join(workspaceRoot, "selection.png")),
  );
  requirePixel(
    pixel(selectionPng, 60, 50),
    [0, 0, 255, 255],
    "selection object",
  );

  const oversized = await client.callTool({
    arguments: {
      expectedRevision,
      outputPath: "oversized.png",
      path,
      width: 2049,
      workspaceId: workspace.id,
    },
    name: "document_render_preview",
  });
  if (!oversized.isError)
    throw new Error(
      "preview schema accepted a dimension above its 2048px limit",
    );
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("document_render_preview modified its SVG source");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F04 preview MCP checks passed.\n");
