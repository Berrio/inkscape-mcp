import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const repositoryRoot = process.cwd();
const evidenceDirectory = join(repositoryRoot, "docs", "progress", "assets");
const sourcePath = join(evidenceDirectory, "f03-resize-comparison.svg");
const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f03-evidence-"),
);
const server = {
  args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  command: process.execPath,
  cwd: repositoryRoot,
  stderr: "pipe",
};
const variants = [
  { file: "f03-resize-source.png", name: "source" },
  {
    file: "f03-resize-page-only.png",
    mode: "page_only",
    name: "page-only",
  },
  {
    file: "f03-resize-contain.png",
    mode: "scale_content_contain",
    name: "contain",
  },
  {
    file: "f03-resize-cover.png",
    mode: "scale_content_cover",
    name: "cover",
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireSuccessful(result, operation) {
  if (result.isError || result.structuredContent === undefined)
    throw new Error(`${operation} failed`);
  return result.structuredContent;
}

const client = new Client(
  { name: "inkscape-mcp-f03-evidence", version: packageMetadata.version },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport(server);

try {
  await mkdir(evidenceDirectory, { recursive: true });
  await client.connect(transport);
  const workspaceResult = requireSuccessful(
    await client.callTool({ arguments: {}, name: "workspace_list" }),
    "workspace_list",
  );
  const workspace = workspaceResult.workspaces?.[0];
  if (typeof workspace?.id !== "string")
    throw new Error("workspace_list did not return a workspace ID");

  const evidence = [];
  for (const variant of variants) {
    const documentPath = `f03-resize-${variant.name}.svg`;
    const outputPath = `f03-resize-${variant.name}.png`;
    await copyFile(sourcePath, join(workspaceRoot, documentPath));
    let revision = sha256(await readFile(join(workspaceRoot, documentPath)));
    if (variant.mode !== undefined) {
      const resize = requireSuccessful(
        await client.callTool({
          arguments: {
            expectedRevision: revision,
            height: 600,
            mode: variant.mode,
            path: documentPath,
            unit: "px",
            width: 600,
            workspaceId: workspace.id,
          },
          name: "document_resize",
        }),
        `document_resize ${variant.name}`,
      );
      if (typeof resize.revision !== "string")
        throw new Error(
          `document_resize ${variant.name} did not return a revision`,
        );
      if (
        variant.mode === "scale_content_cover" &&
        !resize.warnings?.includes("CONTENT_MAY_BE_CROPPED")
      )
        throw new Error("document_resize cover did not report crop risk");
      revision = resize.revision;
    }
    const preview = requireSuccessful(
      await client.callTool({
        arguments: {
          area: "page",
          expectedRevision: revision,
          outputPath,
          path: documentPath,
          width: 240,
          workspaceId: workspace.id,
        },
        name: "document_render_preview",
      }),
      `document_render_preview ${variant.name}`,
    );
    if (preview.width !== 240 || typeof preview.height !== "number")
      throw new Error(
        `document_render_preview ${variant.name} returned invalid dimensions`,
      );
    const rendered = await readFile(join(workspaceRoot, outputPath));
    await copyFile(
      join(workspaceRoot, outputPath),
      join(evidenceDirectory, variant.file),
    );
    evidence.push({
      file: variant.file,
      heightPx: preview.height,
      mode: variant.mode ?? "source",
      name: variant.name,
      sha256: sha256(rendered),
      widthPx: preview.width,
    });
  }
  await writeFile(
    join(evidenceDirectory, "f03-resize-previews.json"),
    `${JSON.stringify(
      {
        fixture: "docs/progress/assets/f03-resize-comparison.svg",
        generatedBy: "npm run evidence:f03",
        renderer: "Inkscape headless through document_render_preview",
        requestedWidthPx: 240,
        schemaVersion: 1,
        variants: evidence,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stderr.write("F03 resize preview evidence generated.\n");
} finally {
  await client.close();
  await rm(workspaceRoot, { force: true, recursive: true });
}
