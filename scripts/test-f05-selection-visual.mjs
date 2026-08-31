import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { comparePngVisual, decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-selection-visual-"),
);
const client = new Client(
  {
    name: "inkscape-mcp-f05-selection-visual",
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

const fixtures = [
  {
    expectedWarning: "SELECTION_CSS_FLATTENED_SUPPORTED",
    id: "supported-card",
    path: "selection-supported.svg",
    source:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><style>.card { fill: url(#paint); stroke: #123456; stroke-width: 2; }</style><defs><linearGradient id="paint" x1="0" x2="1"><stop offset="0" stop-color="#ff0044"/><stop offset="1" stop-color="#0044ff"/></linearGradient><linearGradient id="unused"><stop stop-color="#000"/></linearGradient></defs><g id="supported-card" class="card"><rect width="100" height="60" rx="8"/></g><circle id="foreign-object" cx="50" cy="30" r="24" opacity="0"/></svg>',
    selectedIds: ["supported-card"],
    shouldFlattenStyles: true,
  },
  {
    expectedWarning: "SELECTION_STYLESHEET_PRESERVED_PARTIAL",
    id: "card",
    path: "selection-contextual.svg",
    source:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><style>#card .title { fill: url(#paint); stroke: #202020; stroke-width: 2; }</style><defs><linearGradient id="paint" x1="0" x2="1"><stop offset="0" stop-color="#00a86b"/><stop offset="1" stop-color="#0057b8"/></linearGradient><linearGradient id="unused"><stop stop-color="#000"/></linearGradient></defs><g id="card" transform="translate(0 0)"><rect id="contextual-card" class="title" width="100" height="60"/></g><circle id="foreign-object" cx="50" cy="30" r="24" opacity="0"/></svg>',
    selectedIds: ["contextual-card"],
    shouldFlattenStyles: false,
  },
];

function requireSuccess(result, label) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${label} returned an MCP error`);
  return result.structuredContent;
}

async function render(path, expectedRevision, outputPath, workspaceId) {
  const rendered = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision,
        height: 144,
        outputPath,
        path,
        width: 240,
        workspaceId,
      },
      name: "document_render_preview",
    }),
    `preview ${path}`,
  );
  if (rendered.width !== 240 || rendered.height !== 144)
    throw new Error(`${path} did not render at the requested dimensions`);
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

  for (const fixture of fixtures) {
    await writeFile(join(workspaceRoot, fixture.path), fixture.source, "utf8");
    const sourceInspection = requireSuccess(
      await client.callTool({
        arguments: { level: "deep", path: fixture.path, workspaceId },
        name: "document_inspect",
      }),
      `inspect ${fixture.path}`,
    );
    if (typeof sourceInspection.revision !== "string")
      throw new Error(`${fixture.path} did not return a source revision`);
    const outputPath = fixture.path.replace(/\.svg$/u, "-output.svg");
    const extracted = requireSuccess(
      await client.callTool({
        arguments: {
          expectedRevision: sourceInspection.revision,
          flavor: "plain",
          outputPath,
          path: fixture.path,
          selectionIds: fixture.selectedIds,
          workspaceId,
        },
        name: "export_svg",
      }),
      `export selection ${fixture.path}`,
    );
    if (!extracted.warnings?.includes(fixture.expectedWarning))
      throw new Error(`${fixture.path} did not declare its CSS fidelity`);
    const outputSvg = await readFile(join(workspaceRoot, outputPath), "utf8");
    if (
      !outputSvg.includes('id="paint"') ||
      !outputSvg.includes(`id="${fixture.id}"`) ||
      outputSvg.includes('id="foreign-object"') ||
      outputSvg.includes('id="unused"')
    )
      throw new Error(`${fixture.path} did not retain only its local closure`);
    if (fixture.shouldFlattenStyles === outputSvg.includes("<style"))
      throw new Error(`${fixture.path} did not apply the expected CSS policy`);

    const derivedInspection = requireSuccess(
      await client.callTool({
        arguments: { level: "deep", path: outputPath, workspaceId },
        name: "document_inspect",
      }),
      `inspect extracted ${fixture.path}`,
    );
    if (
      typeof derivedInspection.revision !== "string" ||
      (derivedInspection.inventory?.duplicateIds?.length ?? 1) !== 0 ||
      (derivedInspection.inventory?.unresolvedReferences?.length ?? 1) !== 0
    )
      throw new Error(
        `${fixture.path} exported duplicate or unresolved references`,
      );

    const [sourcePng, derivedPng] = await Promise.all([
      render(
        fixture.path,
        sourceInspection.revision,
        fixture.path.replace(/\.svg$/u, "-source.png"),
        workspaceId,
      ),
      render(
        outputPath,
        derivedInspection.revision,
        fixture.path.replace(/\.svg$/u, "-derived.png"),
        workspaceId,
      ),
    ]);
    const difference = comparePngVisual(sourcePng, derivedPng, 1);
    if (difference.differingPixels !== 0)
      throw new Error(
        `${fixture.path} changed visual pixels after extraction: ${JSON.stringify(difference)}`,
      );
  }

  const multiSource =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><style>#card .selected { fill: #c00; }</style><g id="card"><rect id="first" class="selected" width="10" height="10"/><rect id="second" class="selected" x="10" width="10" height="10"/></g><circle id="foreign-object" opacity="0"/></svg>';
  await writeFile(
    join(workspaceRoot, "selection-multi.svg"),
    multiSource,
    "utf8",
  );
  const multiInspection = requireSuccess(
    await client.callTool({
      arguments: { level: "summary", path: "selection-multi.svg", workspaceId },
      name: "document_inspect",
    }),
    "inspect multi-selection",
  );
  const multi = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: multiInspection.revision,
        flavor: "plain",
        outputPath: "selection-multi-output.svg",
        path: "selection-multi.svg",
        selectionIds: ["first", "second"],
        workspaceId,
      },
      name: "export_svg",
    }),
    "export multi-selection",
  );
  if (!multi.warnings?.includes("SELECTION_STYLESHEET_CONTEXT_PARTIAL"))
    throw new Error(
      "multi-selection did not declare contextual CSS fidelity loss",
    );
  const multiOutput = await readFile(
    join(workspaceRoot, "selection-multi-output.svg"),
    "utf8",
  );
  if (multiOutput.includes('id="foreign-object"'))
    throw new Error(
      "multi-selection incorporated an object outside its closure",
    );
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 selection visual MCP checks passed.\n");
