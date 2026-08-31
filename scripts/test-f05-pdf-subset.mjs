import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-pdf-subset-"),
);
const expectedBoxes = [
  { height: 142, width: 284 },
  { height: 142, width: 142 },
];
const tolerancePoints = 0.6;
const client = new Client(
  { name: "inkscape-mcp-f05-pdf-subset", version: packageMetadata.version },
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

function requireBoxes(boxes, label) {
  if (!Array.isArray(boxes) || boxes.length !== expectedBoxes.length)
    throw new Error(`${label} did not contain two boxes`);
  for (const [index, expected] of expectedBoxes.entries()) {
    const actual = boxes[index];
    if (
      actual === undefined ||
      Math.abs(actual.width - expected.width) > tolerancePoints ||
      Math.abs(actual.height - expected.height) > tolerancePoints
    )
      throw new Error(
        `${label} did not preserve subset page order at ${index}: ${actual?.width}x${actual?.height}`,
      );
  }
}

try {
  await client.connect(transport);
  const listed = await client.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspaceId = listed.structuredContent?.workspaces?.[0]?.id;
  if (listed.isError || typeof workspaceId !== "string")
    throw new Error("workspace_list did not return an authorized workspace");

  const path = "f05-subset-three-pages.svg";
  const source = await readFile(
    join(process.cwd(), "tests", "fixtures", "pdf-subset-three-pages.svg"),
  );
  const expectedRevision = revision(source);
  await writeFile(join(workspaceRoot, path), source);
  const exported = await client.callTool({
    arguments: {
      expectedRevision,
      outputPath: "f05-subset-one-three.pdf",
      pageIds: ["page_one", "page_three"],
      path,
      workspaceId,
    },
    name: "export_pdf",
  });
  const output = exported.structuredContent;
  if (
    exported.isError ||
    output?.pageCount !== 2 ||
    output.strategy !== "prune_subset" ||
    output.pageIds?.join(",") !== "page_one,page_three" ||
    !output.warnings?.includes("PDF_SUBSET_PRUNED")
  )
    throw new Error("export_pdf did not declare the pruned subset strategy");
  requireBoxes(output.mediaBoxes, "MCP MediaBox");
  requireBoxes(output.cropBoxes, "MCP CropBox");

  const bytes = await readFile(join(workspaceRoot, "f05-subset-one-three.pdf"));
  const document = await PDFDocument.load(bytes);
  if (document.getPageCount() !== 2)
    throw new Error(
      "the published subset PDF did not contain exactly two pages",
    );
  const pages = document.getPages();
  requireBoxes(
    pages.map((page) => page.getMediaBox()),
    "published PDF MediaBox",
  );
  requireBoxes(
    pages.map((page) => page.getCropBox()),
    "published PDF CropBox",
  );
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("subset PDF export modified its SVG source");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 PDF subset MCP checks passed.\n");
