import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "win32")
  throw new Error("F10 Windows baseline smoke requires Windows");

const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-f10-\u00f1-"));
const client = new Client(
  { name: "inkscape-mcp-f10-windows-baseline", version: "0.1.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport({
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const status = await client.callTool({
    arguments: {},
    name: "inkscape_status",
  });
  if (
    status.isError ||
    status.structuredContent?.inkscape?.installKind !== "msix" ||
    !status.structuredContent.inkscape.version.startsWith("1.4.4") ||
    status.structuredContent.inkscape.support !== "stable" ||
    status.structuredContent.inkscape.pageAdapter !== "pages_v14" ||
    status.structuredContent.inkscape.warnings.length !== 0
  ) {
    throw new Error(
      "Windows Inkscape 1.4.4 baseline was not reported as stable",
    );
  }

  const workspaces = await client.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspaceId = workspaces.structuredContent?.workspaces?.[0]?.id;
  if (workspaces.isError || typeof workspaceId !== "string")
    throw new Error("Windows baseline smoke could not open its workspace");

  const fonts = await client.callTool({ arguments: {}, name: "fonts_list" });
  if (
    fonts.isError ||
    fonts.structuredContent?.source !== "windows-installed-font-collection" ||
    (fonts.structuredContent.familyCount ?? 0) < 1 ||
    fonts.structuredContent.families.some((family) => /[\\/]:/u.test(family))
  ) {
    throw new Error(
      "fonts_list did not return a bounded Windows font inventory",
    );
  }

  const sourceDirectory = join(workspaceRoot, "Etiquetas");
  const outputDirectory = join(workspaceRoot, "Resultados");
  await Promise.all([mkdir(sourceDirectory), mkdir(outputDirectory)]);
  const sourcePath = "Etiquetas/\u00d1and\u00fa etiqueta.svg";
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="10mm" viewBox="0 0 20 10"><text x="1" y="6" font-family="MissingTestFontForPreflight, serif">\u00d1and\u00fa</text><rect x="0" y="0" width="20" height="10" fill="none" stroke="#112233"/></svg>';
  await writeFile(join(workspaceRoot, sourcePath), source, "utf8");
  const revision = createHash("sha256").update(source).digest("hex");

  const fontPreflight = await client.callTool({
    arguments: { path: sourcePath, workspaceId },
    name: "fonts_preflight",
  });
  if (
    fontPreflight.isError ||
    fontPreflight.structuredContent?.missingFamilies?.[0] !==
      "MissingTestFontForPreflight" ||
    !fontPreflight.structuredContent?.warnings?.includes(
      "FONT_EMBEDDING_AND_GLYPH_COVERAGE_UNVERIFIED",
    )
  ) {
    throw new Error("fonts_preflight did not preserve its Windows limitations");
  }

  const outputPath = "Resultados/Preview \u00d1and\u00fa.png";
  const preview = await client.callTool({
    arguments: {
      area: "page",
      expectedRevision: revision,
      outputPath,
      path: sourcePath,
      width: 128,
      workspaceId,
    },
    name: "document_render_preview",
  });
  const bytes = await readFile(join(workspaceRoot, outputPath));
  const hasArtifactReference =
    typeof preview.structuredContent?.artifact?.uri === "string";
  const hasInlineImage = preview.content.some(
    (item) => item.type === "image" && item.mimeType === "image/png",
  );
  const hasArtifactLink = preview.content.some(
    (item) =>
      item.type === "resource_link" &&
      item.mimeType === "image/png" &&
      item.uri === preview.structuredContent?.artifact?.uri,
  );
  const isPng = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (
    preview.isError ||
    preview.structuredContent?.width !== 128 ||
    preview.structuredContent?.documentPath !== outputPath ||
    !hasArtifactReference ||
    (!hasInlineImage && !hasArtifactLink) ||
    !isPng
  ) {
    throw new Error(
      `Windows baseline preview mismatch: ${JSON.stringify({
        documentPath: preview.structuredContent?.documentPath,
        hasArtifactReference,
        hasArtifactLink,
        hasInlineImage,
        isError: preview.isError === true,
        isPng,
        width: preview.structuredContent?.width,
      })}`,
    );
  }

  const rejectedPath = await client.callTool({
    arguments: {
      path: "C:\\outside.svg",
      workspaceId,
    },
    name: "document_inspect",
  });
  if (!rejectedPath.isError)
    throw new Error("Windows drive path was accepted as a workspace document");

  process.stdout.write("F10 Windows Inkscape 1.4.4 baseline smoke passed.\n");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}
