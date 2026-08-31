import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import packageMetadata from "../package.json" with { type: "json" };

const server = {
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const promptArguments = {
  audit_document: { profile: "web" },
  create_asset_pack: {},
  optimize_svg: {},
  prepare_print_pdf: { preset: "print-a4-pdf" },
  prepare_web_export: { preset: "web-png" },
};

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function expectResourceFailure(client, uri, message) {
  try {
    await client.readResource({ uri });
  } catch {
    return;
  }
  throw new Error(message);
}

async function run() {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "inkscape-mcp-f09-resource-"),
  );
  const client = new Client(
    { name: "inkscape-mcp-f09-resources", version: packageMetadata.version },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StdioClientTransport({
    ...server,
    args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  });
  try {
    await client.connect(transport);
    const listedResources = await client.listResources();
    const resourceUris = listedResources.resources.map(
      (resource) => resource.uri,
    );
    for (const uri of [
      "inkscape://server/capabilities",
      "inkscape://server/presets/exports",
      "inkscape://server/presets/page-sizes",
    ])
      if (!resourceUris.includes(uri))
        throw new Error(`static resource ${uri} is not advertised`);
    if (resourceUris.some((uri) => uri.startsWith("inkscape://document/")))
      throw new Error("document resources must not be enumerable");
    const capabilities = await client.readResource({
      uri: "inkscape://server/capabilities",
    });
    const capabilityText = capabilities.contents[0]?.text;
    if (
      typeof capabilityText !== "string" ||
      capabilityText.includes(workspaceRoot) ||
      !Object.hasOwn(JSON.parse(capabilityText), "securityLevel")
    )
      throw new Error("capability resource leaks a path or omits its contract");
    const pagePresets = await client.readResource({
      uri: "inkscape://server/presets/page-sizes",
    });
    if (!pagePresets.contents[0]?.text?.includes("a4-portrait"))
      throw new Error("page preset resource is incomplete");
    const exportPresets = await client.readResource({
      uri: "inkscape://server/presets/exports",
    });
    if (!exportPresets.contents[0]?.text?.includes("web-asset-pack"))
      throw new Error("export preset resource is incomplete");

    const promptNames = (await client.listPrompts()).prompts.map(
      (prompt) => prompt.name,
    );
    for (const name of Object.keys(promptArguments)) {
      if (!promptNames.includes(name))
        throw new Error(`prompt ${name} is not advertised`);
      const prompt = await client.getPrompt({
        arguments: promptArguments[name],
        name,
      });
      if (
        prompt.messages.length !== 1 ||
        prompt.messages[0]?.role !== "user" ||
        prompt.messages[0]?.content.type !== "text" ||
        prompt.messages[0]?.content.text.length === 0
      )
        throw new Error(`prompt ${name} is not a visible text recipe`);
    }

    const workspaceResult = await client.callTool({
      arguments: {},
      name: "workspace_list",
    });
    const workspace = workspaceResult.structuredContent?.workspaces?.[0];
    if (workspaceResult.isError || typeof workspace?.id !== "string")
      throw new Error("could not resolve resource test workspace");
    const path = "resource-document.svg";
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="5"/></svg>';
    await writeFile(join(workspaceRoot, path), svg, "utf8");
    const inspected = await client.callTool({
      arguments: { path, workspaceId: workspace.id },
      name: "document_inspect",
    });
    const resources = inspected.structuredContent?.resources;
    if (
      inspected.isError ||
      typeof resources?.metadataUri !== "string" ||
      resources.metadataUri.includes(path) ||
      resources.metadataUri.includes(workspaceRoot)
    )
      throw new Error(
        "document inspection did not publish opaque resource links",
      );
    const metadata = await client.readResource({ uri: resources.metadataUri });
    const summary = await client.readResource({ uri: resources.summaryUri });
    const source = await client.readResource({ uri: resources.svgUri });
    if (
      !metadata.contents[0]?.text?.includes('"revision"') ||
      !summary.contents[0]?.text?.includes('"pageCount"') ||
      source.contents[0]?.text !== svg
    )
      throw new Error(
        "document resource metadata, summary or SVG is incorrect",
      );
    await expectResourceFailure(
      client,
      "inkscape://document/doc_00000000000000000000000000000000/metadata",
      "unknown document resource was readable",
    );
    await writeFile(
      join(workspaceRoot, path),
      `${svg}\n<!-- changed -->`,
      "utf8",
    );
    await expectResourceFailure(
      client,
      resources.summaryUri,
      "stale document resource remained readable",
    );

    const previewPath = "resource-preview.png";
    const currentRevision = revision(await readFile(join(workspaceRoot, path)));
    const preview = await client.callTool({
      arguments: {
        area: "page",
        expectedRevision: currentRevision,
        outputPath: previewPath,
        path,
        width: 64,
        workspaceId: workspace.id,
      },
      name: "document_render_preview",
    });
    const artifact = preview.structuredContent?.artifact;
    if (preview.isError || typeof artifact?.id !== "string")
      throw new Error("preview did not publish an artifact resource");
    const chunk = await client.callTool({
      arguments: {
        artifactId: artifact.id,
        length: 64,
        offset: 0,
        workspaceId: workspace.id,
      },
      name: "artifact_read_chunk",
    });
    if (
      chunk.isError ||
      typeof chunk.structuredContent?.bytesBase64 !== "string" ||
      chunk.structuredContent.length < 1
    )
      throw new Error("owner artifact chunk read did not return bounded data");
    const foreign = await client.callTool({
      arguments: {
        artifactId: artifact.id,
        length: 1,
        offset: 0,
        workspaceId: "ws_0000000000000000",
      },
      name: "artifact_read_chunk",
    });
    if (!foreign.isError)
      throw new Error(
        "artifact chunk read allowed a different workspace owner",
      );

    const progress = [];
    const synchronousBatch = await client.callTool(
      {
        arguments: {
          delivery: "sync",
          mode: "all_or_nothing",
          specs: [
            {
              area: { kind: "page" },
              background: { mode: "transparent" },
              format: "png",
              size: { mode: "width", widthPx: 32 },
              source: { expectedRevision: currentRevision, path },
              target: {
                kind: "file",
                overwrite: false,
                path: "resource-progress.png",
              },
            },
          ],
          workspaceId: workspace.id,
        },
        name: "document_export_batch",
      },
      {
        onprogress: (update) => progress.push(update),
        resetTimeoutOnProgress: true,
        timeout: 30_000,
      },
    );
    const positions = progress.map((update) => update.progress);
    if (
      synchronousBatch.isError ||
      positions.length < 6 ||
      positions.some(
        (position, index) =>
          !Number.isInteger(position) ||
          position < 1 ||
          position > 6 ||
          (index > 0 && position < positions[index - 1]),
      ) ||
      ![1, 2, 3, 4, 5, 6].every((position) => positions.includes(position)) ||
      progress.some(
        (update) =>
          update.total !== 6 ||
          typeof update.message !== "string" ||
          update.message.includes(path) ||
          update.message.includes(workspaceRoot),
      )
    )
      throw new Error(
        "MCP progress token did not produce safe staged progress",
      );

    const batch = await client.callTool({
      arguments: {
        delivery: "job",
        mode: "all_or_nothing",
        specs: [
          {
            area: { kind: "page" },
            background: { mode: "transparent" },
            format: "png",
            size: { mode: "width", widthPx: 32 },
            source: { expectedRevision: currentRevision, path },
            target: {
              kind: "file",
              overwrite: false,
              path: "resource-manifest.png",
            },
          },
        ],
        workspaceId: workspace.id,
      },
      name: "document_export_batch",
    });
    const jobId = batch.structuredContent?.jobId;
    const manifestUri = batch.structuredContent?.manifestUri;
    if (
      batch.isError ||
      typeof jobId !== "string" ||
      typeof manifestUri !== "string" ||
      manifestUri.includes(workspaceRoot)
    )
      throw new Error("batch job did not publish an opaque manifest resource");
    let completed = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await client.callTool({
        arguments: { jobId, workspaceId: workspace.id },
        name: "job_get",
      });
      if (status.isError) throw new Error("batch job became unavailable");
      if (status.structuredContent?.status === "completed") {
        completed = true;
        break;
      }
      if (
        status.structuredContent?.status !== "queued" &&
        status.structuredContent?.status !== "running"
      )
        throw new Error(
          "batch job did not complete for manifest resource test",
        );
      await delay(25);
    }
    if (!completed)
      throw new Error("batch job did not complete before timeout");
    const manifest = await client.readResource({ uri: manifestUri });
    if (
      !manifest.contents[0]?.text?.includes('"mode":"all_or_nothing"') ||
      manifest.contents[0]?.text.includes(workspaceRoot)
    )
      throw new Error("export manifest resource is missing or leaked a root");

    const cancellable = await client.callTool({
      arguments: {
        delivery: "job",
        mode: "all_or_nothing",
        specs: [
          {
            area: { kind: "page" },
            background: { mode: "transparent" },
            format: "png",
            size: { dpi: 300, mode: "dpi" },
            source: { expectedRevision: currentRevision, path },
            target: {
              kind: "file",
              overwrite: false,
              path: "resource-cancelled.png",
            },
          },
        ],
        workspaceId: workspace.id,
      },
      name: "document_export_batch",
    });
    const cancelledJobId = cancellable.structuredContent?.jobId;
    const cancelledManifestUri = cancellable.structuredContent?.manifestUri;
    if (
      cancellable.isError ||
      typeof cancelledJobId !== "string" ||
      typeof cancelledManifestUri !== "string"
    )
      throw new Error("could not create a cancellable export job");
    const cancelled = await client.callTool({
      arguments: { jobId: cancelledJobId, workspaceId: workspace.id },
      name: "job_cancel",
    });
    if (cancelled.isError)
      throw new Error("could not cancel an owned export job");
    let cancellationFinished = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await client.callTool({
        arguments: { jobId: cancelledJobId, workspaceId: workspace.id },
        name: "job_get",
      });
      if (status.isError) throw new Error("cancelled job became unavailable");
      if (status.structuredContent?.status === "cancelled") {
        cancellationFinished = true;
        break;
      }
      await delay(25);
    }
    if (!cancellationFinished)
      throw new Error("export job did not reach cancelled state");
    await expectResourceFailure(
      client,
      cancelledManifestUri,
      "cancelled job left its manifest resource readable",
    );

    const asynchronousBestEffort = await client.callTool({
      arguments: {
        delivery: "job",
        mode: "best_effort",
        specs: [
          {
            area: { kind: "page" },
            background: { mode: "transparent" },
            format: "png",
            size: { mode: "width", widthPx: 32 },
            source: { expectedRevision: currentRevision, path },
            target: {
              kind: "file",
              overwrite: false,
              path: "resource-best-effort-job.png",
            },
          },
        ],
        workspaceId: workspace.id,
      },
      name: "document_export_batch",
    });
    if (!asynchronousBestEffort.isError)
      throw new Error("asynchronous best-effort export bypassed atomic policy");
  } finally {
    await client.close();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

await run();
process.stderr.write("F09 resources and prompts MCP checks passed.\n");
