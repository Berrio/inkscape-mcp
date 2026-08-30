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
  join(tmpdir(), "inkscape-mcp-f05-svg-reopen-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100px" height="60px" viewBox="0 0 100 60"><g inkscape:groupmode="layer" inkscape:label="Artwork"><rect id="background" x="5" y="5" width="90" height="50" rx="5" fill="#123456"/><circle id="accent" cx="50" cy="30" r="15" fill="#ffcc00"/></g></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireExport(result, flavor) {
  const output = result.structuredContent;
  if (
    result.isError ||
    output?.flavor !== flavor ||
    typeof output.revision !== "string" ||
    output.viewBox !== "0 0 100 60" ||
    output.warnings?.length !== 0
  )
    throw new Error(
      `${flavor} SVG export did not return its expected metadata`,
    );
  return output.revision;
}

function requireSvgStructure(xml, flavor) {
  const document = new DOMParser().parseFromString(xml, "image/svg+xml");
  const root = document.documentElement;
  if (
    document.getElementsByTagName("parsererror").length !== 0 ||
    root?.namespaceURI !== "http://www.w3.org/2000/svg" ||
    root.getAttribute("viewBox") !== "0 0 100 60" ||
    document.getElementsByTagName("rect").length !== 1 ||
    document.getElementsByTagName("circle").length !== 1
  )
    throw new Error(`${flavor} SVG failed structural XML validation`);
  if (
    flavor === "inkscape" &&
    document
      .getElementsByTagName("g")[0]
      ?.getAttribute("inkscape:groupmode") !== "layer"
  )
    throw new Error("Inkscape SVG did not preserve its editable layer");
  if (flavor === "plain" && /\sinkscape:/u.test(xml))
    throw new Error("Plain SVG retained an Inkscape-specific attribute");
}

function requirePreview(result, label) {
  if (
    result.isError ||
    result.structuredContent?.width !== 200 ||
    result.structuredContent?.height !== 120
  )
    throw new Error(`${label} did not reopen and render at 200 x 120 px`);
}

async function render(client, workspaceId, path, expectedRevision, outputPath) {
  const rendered = await client.callTool({
    arguments: {
      area: "page",
      expectedRevision,
      height: 120,
      outputPath,
      path,
      width: 200,
      workspaceId,
    },
    name: "document_render_preview",
  });
  requirePreview(rendered, path);
  return decodePngRgba(await readFile(join(workspaceRoot, outputPath)));
}

const client = new Client(
  { name: "inkscape-mcp-f05-svg-reopen", version: packageMetadata.version },
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

  const path = "f05-svg-master.svg";
  await writeFile(join(workspaceRoot, path), source, "utf8");
  const expectedRevision = revision(await readFile(join(workspaceRoot, path)));
  const inkscapeRevision = requireExport(
    await client.callTool({
      arguments: {
        expectedRevision,
        flavor: "inkscape",
        outputPath: "f05-inkscape.svg",
        path,
        workspaceId: workspace.id,
      },
      name: "export_svg",
    }),
    "inkscape",
  );
  const plainRevision = requireExport(
    await client.callTool({
      arguments: {
        expectedRevision,
        flavor: "plain",
        outputPath: "f05-plain.svg",
        path,
        workspaceId: workspace.id,
      },
      name: "export_svg",
    }),
    "plain",
  );
  requireSvgStructure(
    await readFile(join(workspaceRoot, "f05-inkscape.svg"), "utf8"),
    "inkscape",
  );
  requireSvgStructure(
    await readFile(join(workspaceRoot, "f05-plain.svg"), "utf8"),
    "plain",
  );

  const masterPreview = await render(
    client,
    workspace.id,
    path,
    expectedRevision,
    "f05-master.png",
  );
  for (const [outputPath, outputRevision, previewPath] of [
    ["f05-inkscape.svg", inkscapeRevision, "f05-inkscape.png"],
    ["f05-plain.svg", plainRevision, "f05-plain.png"],
  ]) {
    const difference = comparePngVisual(
      await render(
        client,
        workspace.id,
        outputPath,
        outputRevision,
        previewPath,
      ),
      masterPreview,
      1,
    );
    if (difference.differingPixels !== 0)
      throw new Error(
        `${outputPath} changed visual output: ${JSON.stringify(difference)}`,
      );
  }
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("SVG exports modified their source document");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 SVG reopen MCP checks passed.\n");
