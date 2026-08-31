import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { DOMParser } from "@xmldom/xmldom";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comparePngVisual, decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-viewbox-512-"),
);
const client = new Client(
  { name: "inkscape-mcp-f05-viewbox-512", version: packageMetadata.version },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport({
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
});

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireSuccess(result, label) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${label} returned an MCP error`);
  return result.structuredContent;
}

async function render(path, expectedRevision, outputPath, workspaceId) {
  const output = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision,
        height: 256,
        outputPath,
        path,
        width: 256,
        workspaceId,
      },
      name: "document_render_preview",
    }),
    `render ${path}`,
  );
  if (output.width !== 256 || output.height !== 256)
    throw new Error(`${path} did not render at 256 by 256 px`);
  return decodePngRgba(await readFile(join(workspaceRoot, outputPath)));
}

try {
  await client.connect(transport);
  const listed = requireSuccess(
    await client.callTool({ arguments: {}, name: "workspace_list" }),
    "workspace_list",
  );
  const workspaceId = listed.workspaces?.[0]?.id;
  if (typeof workspaceId !== "string")
    throw new Error("workspace_list did not return an opaque workspace ID");

  const path = "f05-viewbox-512.svg";
  const source = await readFile(
    join(process.cwd(), "tests", "fixtures", "svg-viewbox-512.svg"),
  );
  const expectedRevision = revision(source);
  await writeFile(join(workspaceRoot, path), source);
  const exported = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision,
        flavor: "plain",
        outputPath: "f05-viewbox-512-plain.svg",
        path,
        workspaceId,
      },
      name: "export_svg",
    }),
    "export_svg",
  );
  if (
    exported.flavor !== "plain" ||
    exported.viewBox !== "0 0 512 512" ||
    typeof exported.revision !== "string" ||
    exported.warnings?.some((warning) => warning.includes("VIEWBOX"))
  )
    throw new Error(
      "export_svg did not report the expected unmodified viewBox",
    );

  const plainSvg = await readFile(
    join(workspaceRoot, "f05-viewbox-512-plain.svg"),
    "utf8",
  );
  const document = new DOMParser().parseFromString(plainSvg, "image/svg+xml");
  const root = document.documentElement;
  if (
    document.getElementsByTagName("parsererror").length !== 0 ||
    root?.namespaceURI !== "http://www.w3.org/2000/svg" ||
    root.getAttribute("viewBox") !== "0 0 512 512" ||
    root.getAttribute("width") !== "512" ||
    root.getAttribute("height") !== "512" ||
    document.getElementsByTagName("rect").length !== 1 ||
    /\sinkscape:/u.test(plainSvg)
  )
    throw new Error(
      "plain SVG did not retain the expected 512 viewport structure",
    );

  const [sourcePng, plainPng] = await Promise.all([
    render(path, expectedRevision, "f05-viewbox-512-source.png", workspaceId),
    render(
      "f05-viewbox-512-plain.svg",
      exported.revision,
      "f05-viewbox-512-plain.png",
      workspaceId,
    ),
  ]);
  const difference = comparePngVisual(sourcePng, plainPng, 1);
  if (difference.differingPixels !== 0)
    throw new Error(
      "plain SVG changed visual pixels after reopening in Inkscape",
    );
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("plain SVG export modified its source document");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 512 viewBox plain SVG MCP checks passed.\n");
