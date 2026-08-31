import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import packageMetadata from "../package.json" with { type: "json" };

const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-f05-mvp-"));
const client = new Client(
  { name: "inkscape-mcp-f05-mvp-e2e", version: packageMetadata.version },
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
    throw new Error(`${label} returned an MCP error`);
  return result.structuredContent;
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

  const path = "mvp-label.svg";
  const created = requireSuccess(
    await client.callTool({
      arguments: {
        height: 3,
        outputPath: path,
        unit: "cm",
        width: 8,
        workspaceId,
      },
      name: "document_create",
    }),
    "document_create",
  );
  if (created.documentPath !== path || typeof created.revision !== "string")
    throw new Error("document_create did not publish the MVP document");

  const resized = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: created.revision,
        height: 4,
        mode: "page_only",
        path,
        unit: "cm",
        width: 10,
        workspaceId,
      },
      name: "document_resize",
    }),
    "document_resize",
  );
  if (
    typeof resized.revision !== "string" ||
    resized.revision === created.revision
  )
    throw new Error(
      "document_resize did not publish the 10 cm by 4 cm revision",
    );

  const inspected = requireSuccess(
    await client.callTool({
      arguments: { level: "summary", path, workspaceId },
      name: "document_inspect",
    }),
    "document_inspect",
  );
  if (inspected.revision !== resized.revision)
    throw new Error("document_inspect did not observe the resized document");

  const preview = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: resized.revision,
        outputPath: "mvp-preview.png",
        path,
        width: 250,
        workspaceId,
      },
      name: "document_render_preview",
    }),
    "document_render_preview",
  );
  if (preview.width !== 250 || preview.height !== 100)
    throw new Error(
      "document_render_preview did not preserve the 10:4 page ratio",
    );

  const png = requireSuccess(
    await client.callTool({
      arguments: {
        background: "transparent",
        expectedRevision: resized.revision,
        outputPath: "mvp-label.png",
        path,
        width: 400,
        workspaceId,
      },
      name: "export_png",
    }),
    "export_png",
  );
  if (
    png.width !== 400 ||
    png.height !== 160 ||
    png.background !== "transparent"
  )
    throw new Error("export_png did not publish the requested 400 by 160 PNG");

  const pdf = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: resized.revision,
        outputPath: "mvp-label.pdf",
        path,
        workspaceId,
      },
      name: "export_pdf",
    }),
    "export_pdf",
  );
  if (pdf.pageCount !== 1 || pdf.strategy !== "full_document")
    throw new Error("export_pdf did not publish the single-page MVP PDF");

  const svg = requireSuccess(
    await client.callTool({
      arguments: {
        expectedRevision: resized.revision,
        flavor: "plain",
        outputPath: "mvp-label-plain.svg",
        path,
        workspaceId,
      },
      name: "export_svg",
    }),
    "export_svg",
  );
  if (typeof svg.revision !== "string" || typeof svg.viewBox !== "string")
    throw new Error("export_svg did not publish the plain SVG metadata");

  const [pngBytes, pdfBytes, plainSvg] = await Promise.all([
    readFile(join(workspaceRoot, "mvp-label.png")),
    readFile(join(workspaceRoot, "mvp-label.pdf")),
    readFile(join(workspaceRoot, "mvp-label-plain.svg"), "utf8"),
  ]);
  if (
    !pngBytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("MVP PNG does not have a PNG signature");
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("MVP PDF does not have a PDF signature");
  if ((await PDFDocument.load(pdfBytes)).getPageCount() !== 1)
    throw new Error("MVP PDF could not be reopened as one page");
  if (!plainSvg.includes('xmlns="http://www.w3.org/2000/svg"'))
    throw new Error("MVP plain SVG does not have the SVG namespace");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 MVP end-to-end MCP checks passed.\n");
