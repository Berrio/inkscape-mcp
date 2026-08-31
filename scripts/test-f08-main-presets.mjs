import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f08-presets-"),
);
const client = new Client(
  { name: "inkscape-mcp-f08-main-presets", version: packageMetadata.version },
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
    throw new Error(
      `${label} returned an MCP error: ${result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(" ")}`,
    );
  return result.structuredContent;
}

async function planAndExecute(preset, workspaceId) {
  const plan = requireSuccess(
    await client.callTool({
      arguments: { preset, workspaceId },
      name: "document_export_preset_plan",
    }),
    `${preset.name} plan`,
  );
  if (typeof plan.planToken !== "string")
    throw new Error(`${preset.name} plan did not return a plan token`);
  const result = requireSuccess(
    await client.callTool({
      arguments: {
        mode: "all_or_nothing",
        planToken: plan.planToken,
        workspaceId,
      },
      name: "document_export_batch",
    }),
    `${preset.name} batch`,
  );
  return { plan, result };
}

function assertManifest(result, expectedRevision, expectedPaths, label) {
  if (
    result.failures?.length !== 0 ||
    result.successes?.length !== expectedPaths.length ||
    result.manifest?.mode !== "all_or_nothing" ||
    result.manifest?.publication !== "manifest_commit" ||
    result.manifest?.source?.expectedRevision !== expectedRevision ||
    result.manifest?.source?.path !== "source.svg" ||
    !Array.isArray(result.manifest?.variants) ||
    result.manifest.variants.map((variant) => variant.outputPath).join("|") !==
      expectedPaths.join("|") ||
    typeof result.manifest.commitMarker !== "string"
  )
    throw new Error(`${label} did not publish the expected batch manifest`);
}

try {
  await client.connect(transport);
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
  const drawn = requireSuccess(
    await client.callTool({
      arguments: {
        elements: [
          {
            height: 12,
            id: "preset-artwork",
            kind: "rect",
            style: { fill: "#336699" },
            width: 30,
            x: 5,
            y: 4,
          },
        ],
        expectedRevision: source.revision,
        path: "source.svg",
        workspaceId,
      },
      name: "elements_create",
    }),
    "elements_create",
  );
  const sourceReference = {
    expectedRevision: drawn.revision,
    path: "source.svg",
  };

  const web = await planAndExecute(
    {
      name: "web-asset-pack",
      outputDirectory: "web",
      source: sourceReference,
    },
    workspaceId,
  );
  const webPaths = [
    "web/web.svg",
    "web/web-1x.png",
    "web/web-2x.png",
    "web/web-3x.png",
  ];
  if (web.plan.variantCount !== 4 || web.plan.preflight?.profile !== "web")
    throw new Error("web-asset-pack plan did not retain its web contract");
  assertManifest(web.result, drawn.revision, webPaths, "web-asset-pack");
  const [webSvg, ...webPngs] = await Promise.all([
    readFile(join(workspaceRoot, webPaths[0]), "utf8"),
    ...webPaths.slice(1).map((path) => readFile(join(workspaceRoot, path))),
  ]);
  if (!webSvg.includes('xmlns="http://www.w3.org/2000/svg"'))
    throw new Error("web-asset-pack did not publish a plain SVG");
  const webWidths = webPngs.map((png) => decodePngRgba(png).width);
  if (webWidths.join(",") !== "1200,2400,3600")
    throw new Error("web-asset-pack did not publish 1x/2x/3x PNG variants");

  const print = await planAndExecute(
    {
      name: "print-a4-pdf",
      outputDirectory: "print",
      overrides: { text: "paths" },
      source: sourceReference,
    },
    workspaceId,
  );
  const printPath = "print/print-a4.pdf";
  if (
    print.plan.variantCount !== 1 ||
    print.plan.preflight?.profile !== "print" ||
    !print.plan.preflight?.issues?.some(
      (issue) => issue.code === "PRINT_BLEED_SPEC_REQUIRED",
    )
  )
    throw new Error("print-a4-pdf plan did not run the print preflight");
  assertManifest(print.result, drawn.revision, [printPath], "print-a4-pdf");
  const pdf = await readFile(join(workspaceRoot, printPath));
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("print-a4-pdf did not publish a PDF signature");
  if ((await PDFDocument.load(pdf)).getPageCount() !== 1)
    throw new Error("print-a4-pdf did not publish a reopenable one-page PDF");

  const social = await planAndExecute(
    {
      metadata: {
        createdAt: "2026-08-31T00:00:00Z",
        sourceLabel: "F08 main preset smoke",
      },
      name: "social-landscape",
      outputDirectory: "social",
      overrides: { heightPx: 675, widthPx: 1200 },
      source: sourceReference,
    },
    workspaceId,
  );
  const socialPath = "social/social-landscape.png";
  if (
    social.plan.variantCount !== 1 ||
    social.plan.presetMetadata?.sourceLabel !== "F08 main preset smoke"
  )
    throw new Error("social plan did not retain required source metadata");
  assertManifest(
    social.result,
    drawn.revision,
    [socialPath],
    "social-landscape",
  );
  if (
    social.result.manifest?.presetMetadata?.createdAt !==
      "2026-08-31T00:00:00Z" ||
    social.result.manifest?.presetMetadata?.sourceLabel !==
      "F08 main preset smoke"
  )
    throw new Error("social manifest did not retain required source metadata");
  const socialPng = await readFile(join(workspaceRoot, socialPath));
  const socialSize = decodePngRgba(socialPng);
  if (socialSize.width !== 1200 || socialSize.height !== 675)
    throw new Error(
      "social-landscape did not publish its requested dimensions",
    );

  for (const result of [web.result, print.result, social.result]) {
    const marker = result.manifest?.commitMarker;
    if (!marker || !existsSync(join(workspaceRoot, marker)))
      throw new Error("preset batch did not publish its commit marker");
    const contents = JSON.parse(
      await readFile(join(workspaceRoot, marker), "utf8"),
    );
    if (contents.publication !== "manifest_commit")
      throw new Error("preset commit marker did not record atomic publication");
  }
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F08 main preset MCP checks passed.\n");
