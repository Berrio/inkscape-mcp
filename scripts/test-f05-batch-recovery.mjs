import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-f05-batch-recovery-"));
const workspaceRoot = join(root, "workspace");
const scratchRoot = join(root, "scratch");
await Promise.all([mkdir(workspaceRoot), mkdir(scratchRoot)]);
const staleScratch = join(scratchRoot, "inkscape-mcp-staging-interrupted");
await mkdir(staleScratch);
await writeFile(join(staleScratch, "partial-input.svg"), "interrupted");
await utimes(staleScratch, new Date(0), new Date(0));

const server = {
  args: [
    "dist/cli.js",
    "--workspace-root",
    workspaceRoot,
    "--scratch-root",
    scratchRoot,
  ],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>';

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function batchSpec(format, outputPath, expectedRevision) {
  return {
    area: { kind: format === "png" ? "page" : "document" },
    ...(format === "png" ? { background: { mode: "transparent" } } : {}),
    ...(format === "plain-svg"
      ? { resourcePolicy: "preserve-local", text: "preserve" }
      : {}),
    format,
    source: { expectedRevision, path: "f05-batch-source.svg" },
    target: { kind: "file", overwrite: false, path: outputPath },
  };
}

const client = new Client(
  { name: "inkscape-mcp-f05-batch-recovery", version: packageMetadata.version },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);
const transport = new StdioClientTransport(server);

try {
  await client.connect(transport);
  await stat(staleScratch)
    .then(() => {
      throw new Error("server restart did not remove stale scratch");
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  const workspaceResult = await client.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = workspaceResult.structuredContent?.workspaces?.[0];
  if (workspaceResult.isError || typeof workspace?.id !== "string")
    throw new Error("workspace_list did not return an authorized workspace");

  const sourcePath = "f05-batch-source.svg";
  await mkdir(join(workspaceRoot, "batch"));
  await writeFile(join(workspaceRoot, sourcePath), source, "utf8");
  const expectedRevision = revision(
    await readFile(join(workspaceRoot, sourcePath)),
  );
  const exported = await client.callTool({
    arguments: {
      mode: "all_or_nothing",
      specs: [
        batchSpec("png", "batch/one.png", expectedRevision),
        batchSpec("plain-svg", "batch/two.svg", expectedRevision),
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  const output = exported.structuredContent;
  const markerPath = output?.manifest?.commitMarker;
  if (
    exported.isError ||
    output?.manifest?.publication !== "manifest_commit" ||
    typeof markerPath !== "string" ||
    !markerPath.startsWith(".inkscape-mcp-commits/batch-") ||
    !markerPath.endsWith(".json") ||
    output.successes?.length !== 2
  )
    throw new Error("batch export did not report its final manifest receipt");
  const marker = JSON.parse(
    await readFile(join(workspaceRoot, markerPath), "utf8"),
  );
  if (
    marker.publication !== "manifest_commit" ||
    marker.commitMarker !== markerPath ||
    marker.variants?.length !== 2 ||
    JSON.stringify(marker).includes(workspaceRoot)
  )
    throw new Error("batch receipt is incomplete or leaked an absolute path");
  for (const success of output.successes) {
    const bytes = await readFile(join(workspaceRoot, success.outputPath));
    if (revision(bytes) !== success.revision)
      throw new Error(
        `published batch member ${success.outputPath} has wrong hash`,
      );
  }
  const scratchEntries = await readdir(scratchRoot);
  if (scratchEntries.some((entry) => entry.startsWith("inkscape-mcp-staging-")))
    throw new Error("batch export left its staging scratch directory behind");
  if (
    revision(await readFile(join(workspaceRoot, sourcePath))) !==
    expectedRevision
  )
    throw new Error("batch export modified its SVG source");
} finally {
  await client.close();
  await rm(root, { force: true, recursive: true });
}

process.stderr.write("F05 batch receipt and recovery MCP checks passed.\n");
