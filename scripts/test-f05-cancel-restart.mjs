import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import packageMetadata from "../package.json" with { type: "json" };

const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-f05-cancel-restart-"));
const workspaceRoot = join(root, "workspace");
const scratchRoot = join(root, "scratch");
const sourcePath = "cancel-source.svg";
const outputPath = "cancelled-a4.png";
await Promise.all([mkdir(workspaceRoot), mkdir(scratchRoot)]);

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><rect width="210" height="297" fill="#234567"/></svg>';
await writeFile(join(workspaceRoot, sourcePath), source, "utf8");
const expectedRevision = createHash("sha256").update(source).digest("hex");

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

function createClient(name) {
  return new Client(
    { name, version: packageMetadata.version },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
}

async function waitForCancelled(client, jobId, workspaceId) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const status = await client.callTool({
      arguments: { jobId, workspaceId },
      name: "job_get",
    });
    if (status.isError)
      throw new Error(
        "cancelled batch job became unavailable before terminal state",
      );
    if (status.structuredContent?.status === "cancelled") return;
    if (
      status.structuredContent?.status !== "queued" &&
      status.structuredContent?.status !== "running"
    )
      throw new Error(
        "cancelled batch job reached an unexpected terminal state",
      );
    await delay(25);
  }
  throw new Error("cancelled batch job did not reach terminal state");
}

async function expectResourceUnavailable(client, uri, message) {
  try {
    await client.readResource({ uri });
  } catch {
    return;
  }
  throw new Error(message);
}

let firstClient;
try {
  firstClient = createClient("inkscape-mcp-f05-cancel-restart-first");
  await firstClient.connect(new StdioClientTransport(server));
  const workspaceResult = await firstClient.callTool({
    arguments: {},
    name: "workspace_list",
  });
  const workspace = workspaceResult.structuredContent?.workspaces?.[0];
  if (workspaceResult.isError || typeof workspace?.id !== "string")
    throw new Error("first server did not return an authorized workspace");

  const created = await firstClient.callTool({
    arguments: {
      delivery: "job",
      mode: "all_or_nothing",
      specs: [
        {
          area: { kind: "page" },
          background: { mode: "transparent" },
          format: "png",
          size: { dpi: 300, mode: "dpi" },
          source: { expectedRevision, path: sourcePath },
          target: { kind: "file", overwrite: false, path: outputPath },
        },
      ],
      workspaceId: workspace.id,
    },
    name: "document_export_batch",
  });
  const jobId = created.structuredContent?.jobId;
  const manifestUri = created.structuredContent?.manifestUri;
  if (
    created.isError ||
    typeof jobId !== "string" ||
    typeof manifestUri !== "string"
  )
    throw new Error("could not create the cancellable batch job");

  const cancelled = await firstClient.callTool({
    arguments: { jobId, workspaceId: workspace.id },
    name: "job_cancel",
  });
  if (cancelled.isError) throw new Error("could not cancel the batch job");
  await waitForCancelled(firstClient, jobId, workspace.id);
  await access(join(workspaceRoot, outputPath))
    .then(() => {
      throw new Error("cancelled batch job published an output");
    })
    .catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  await expectResourceUnavailable(
    firstClient,
    manifestUri,
    "cancelled batch job left its manifest resource readable",
  );

  await firstClient.close();
  firstClient = undefined;

  const staleJobScratch = join(scratchRoot, "inkscape-mcp-job-interrupted");
  await mkdir(staleJobScratch);
  await writeFile(join(staleJobScratch, "partial-render"), "interrupted");
  await utimes(staleJobScratch, new Date(0), new Date(0));

  const restartedClient = createClient(
    "inkscape-mcp-f05-cancel-restart-second",
  );
  try {
    await restartedClient.connect(new StdioClientTransport(server));
    await stat(staleJobScratch)
      .then(() => {
        throw new Error("server restart did not remove stale job scratch");
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    const restartedWorkspaceResult = await restartedClient.callTool({
      arguments: {},
      name: "workspace_list",
    });
    const restartedWorkspace =
      restartedWorkspaceResult.structuredContent?.workspaces?.[0];
    if (
      restartedWorkspaceResult.isError ||
      typeof restartedWorkspace?.id !== "string"
    )
      throw new Error(
        "restarted server did not return an authorized workspace",
      );
    const staleJob = await restartedClient.callTool({
      arguments: { jobId, workspaceId: restartedWorkspace.id },
      name: "job_get",
    });
    if (!staleJob.isError)
      throw new Error("in-memory job state survived a server restart");
    await expectResourceUnavailable(
      restartedClient,
      manifestUri,
      "job manifest resource survived a server restart",
    );
  } finally {
    await restartedClient.close();
  }
} finally {
  await firstClient?.close();
  await rm(root, { force: true, recursive: true });
}

process.stderr.write("F05 cancellation and restart MCP checks passed.\n");
