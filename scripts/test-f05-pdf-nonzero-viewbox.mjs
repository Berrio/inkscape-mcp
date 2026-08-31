import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { comparePngVisual, decodePngRgba } from "../dist/export/index.js";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-pdf-nonzero-"),
);
const tolerancePoints = 0.6;
const client = new Client(
  { name: "inkscape-mcp-f05-pdf-nonzero", version: packageMetadata.version },
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

function requireBox(box, label) {
  if (
    box === undefined ||
    Math.abs(box.width - 284) > tolerancePoints ||
    Math.abs(box.height - 142) > tolerancePoints
  )
    throw new Error(`${label} did not preserve the 100 mm by 50 mm page box`);
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
        height: 100,
        outputPath,
        path,
        width: 200,
        workspaceId,
      },
      name: "document_render_preview",
    }),
    `render ${path}`,
  );
  if (output.width !== 200 || output.height !== 100)
    throw new Error(`${path} did not render at the expected aspect ratio`);
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

  const path = "f05-nonzero-viewbox.svg";
  const source = await readFile(
    join(process.cwd(), "tests", "fixtures", "pdf-nonzero-viewbox.svg"),
  );
  const expectedRevision = revision(source);
  await writeFile(join(workspaceRoot, path), source);
  const exported = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision,
        outputPath: "f05-nonzero-viewbox.pdf",
        path,
        workspaceId,
      },
      name: "export_pdf",
    }),
    "export_pdf",
  );
  if (
    exported.pageCount !== 1 ||
    exported.strategy !== "full_document" ||
    typeof exported.revision !== "string" ||
    exported.warnings?.some((warning) =>
      warning.includes("VIEWBOX_NORMALIZED_TEMPORARY"),
    )
  )
    throw new Error(
      "export_pdf did not report the expected non-normalized export",
    );
  requireBox(exported.mediaBoxes?.[0], "MCP MediaBox");
  requireBox(exported.cropBoxes?.[0], "MCP CropBox");

  const pdfBytes = await readFile(
    join(workspaceRoot, "f05-nonzero-viewbox.pdf"),
  );
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("export_pdf did not publish a PDF signature");
  const pdf = await PDFDocument.load(pdfBytes);
  if (pdf.getPageCount() !== 1)
    throw new Error(
      "published non-zero viewBox PDF has an unexpected page count",
    );
  requireBox(pdf.getPages()[0]?.getMediaBox(), "published PDF MediaBox");
  requireBox(pdf.getPages()[0]?.getCropBox(), "published PDF CropBox");

  const imported = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: exported.revision,
        manifestPath: "f05-nonzero-viewbox.pdf.import.json",
        mode: "internal",
        outputPath: "f05-nonzero-viewbox-imported.svg",
        page: 1,
        path: "f05-nonzero-viewbox.pdf",
        workspaceId,
      },
      name: "document_import_pdf",
    }),
    "document_import_pdf",
  );
  if (
    typeof imported.revision !== "string" ||
    imported.manifest?.format !== "pdf" ||
    !imported.manifest?.warnings?.includes(
      "PDF_INTERNAL_IMPORT_FIDELITY_NOT_GUARANTEED",
    )
  )
    throw new Error("document_import_pdf did not report its fidelity boundary");

  const [sourcePng, importedPng] = await Promise.all([
    render(path, expectedRevision, "f05-nonzero-source.png", workspaceId),
    render(
      "f05-nonzero-viewbox-imported.svg",
      imported.revision,
      "f05-nonzero-imported.png",
      workspaceId,
    ),
  ]);
  const difference = comparePngVisual(sourcePng, importedPng, 1);
  if (difference.differingPixels !== 0)
    throw new Error("non-zero viewBox PDF import changed visual pixels");
  if (revision(await readFile(join(workspaceRoot, path))) !== expectedRevision)
    throw new Error("non-zero viewBox export modified its SVG source");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 non-zero viewBox PDF MCP checks passed.\n");
