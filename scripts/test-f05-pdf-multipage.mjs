import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-pdf-multipage-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const tolerancePoints = 0.6;

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function within(actual, expected) {
  return Math.abs(actual - expected) <= tolerancePoints;
}

function requireBox(box, width, height, label) {
  if (!within(box.width, width) || !within(box.height, height))
    throw new Error(
      `${label} has unexpected size ${box.width.toFixed(2)}×${box.height.toFixed(2)}pt`,
    );
}

const client = new Client(
  { name: "inkscape-mcp-f05-pdf-multipage", version: packageMetadata.version },
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

  const path = "f05-multipage.svg";
  const source = await readFile(
    join(process.cwd(), "tests", "fixtures", "pdf-multipage.svg"),
  );
  await writeFile(join(workspaceRoot, path), source);
  const expectedRevision = revision(source);
  const exported = await client.callTool({
    arguments: {
      expectedRevision,
      outputPath: "f05-multipage.pdf",
      path,
      workspaceId: workspace.id,
    },
    name: "export_pdf",
  });
  const output = exported.structuredContent;
  if (
    exported.isError ||
    output?.pageCount !== 2 ||
    output.strategy !== "full_document" ||
    output.mediaBoxes?.length !== 2 ||
    output.cropBoxes?.length !== 2
  )
    throw new Error(
      "export_pdf did not report the complete multipage document",
    );
  requireBox(output.mediaBoxes[0], 284, 142, "first MCP MediaBox");
  requireBox(output.mediaBoxes[1], 142, 142, "second MCP MediaBox");
  requireBox(output.cropBoxes[0], 284, 142, "first MCP CropBox");
  requireBox(output.cropBoxes[1], 142, 142, "second MCP CropBox");

  const bytes = await readFile(join(workspaceRoot, "f05-multipage.pdf"));
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("export_pdf did not publish a PDF signature");
  const document = await PDFDocument.load(bytes);
  if (document.getPageCount() !== 2)
    throw new Error("the published PDF has an unexpected page count");
  const pages = document.getPages();
  requireBox(pages[0].getMediaBox(), 284, 142, "first PDF MediaBox");
  requireBox(pages[1].getMediaBox(), 142, 142, "second PDF MediaBox");
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("PDF export modified its SVG source");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 multipage PDF MCP checks passed.\n");
