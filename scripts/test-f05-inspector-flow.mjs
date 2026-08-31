import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape-mcp-f05-inspector-"),
);
const inspectorEntry = join(
  process.cwd(),
  "node_modules",
  "@modelcontextprotocol",
  "inspector",
  "clients",
  "launcher",
  "build",
  "index.js",
);
const maximumBytes = 2 * 1024 * 1024;

async function callThroughInspector(toolName, toolArgs) {
  const child = spawn(
    process.execPath,
    [
      inspectorEntry,
      "--cli",
      "node",
      "dist/cli.js",
      "--workspace-root",
      workspaceRoot,
      "--",
      "--method",
      "tools/call",
      "--tool-name",
      toolName,
      "--tool-args-json",
      JSON.stringify(toolArgs),
      "--format",
      "json",
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  for (const [stream, collect] of [
    [child.stdout, (chunk) => (stdout += chunk)],
    [child.stderr, (chunk) => (stderr += chunk)],
  ])
    stream.setEncoding("utf8").on("data", (chunk) => {
      collect(chunk);
      if (stdout.length + stderr.length > maximumBytes) child.kill("SIGKILL");
    });

  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (status !== 0)
    throw new Error(`Inspector ${toolName} exited with status ${status}`);
  let response;
  try {
    response = JSON.parse(stdout);
  } catch {
    throw new Error(`Inspector ${toolName} did not return JSON`);
  }
  if (!response?.result || response.result.isError === true)
    throw new Error(`Inspector ${toolName} returned an MCP error`);
  return response.result.structuredContent;
}

try {
  const status = await callThroughInspector("inkscape_status", {});
  if (
    status?.workspaceReady !== true ||
    status?.securityPosture?.pathsRedacted !== true
  )
    throw new Error("inkscape_status did not report a guarded workspace");

  const workspaces = await callThroughInspector("workspace_list", {});
  const workspaceId = workspaces?.workspaces?.[0]?.id;
  if (typeof workspaceId !== "string")
    throw new Error("workspace_list did not return an opaque workspace ID");

  const created = await callThroughInspector("document_create", {
    height: 3,
    outputPath: "inspector-flow.svg",
    unit: "cm",
    width: 8,
    workspaceId,
  });
  if (
    created?.documentPath !== "inspector-flow.svg" ||
    typeof created.revision !== "string"
  )
    throw new Error("document_create did not publish a revision");

  const resized = await callThroughInspector("document_resize", {
    expectedRevision: created.revision,
    height: 4,
    mode: "page_only",
    path: "inspector-flow.svg",
    unit: "cm",
    width: 10,
    workspaceId,
  });
  if (
    typeof resized?.revision !== "string" ||
    resized.revision === created.revision ||
    resized.dryRun !== false
  )
    throw new Error("document_resize did not publish a changed revision");

  const preview = await callThroughInspector("document_render_preview", {
    expectedRevision: resized.revision,
    outputPath: "inspector-preview.png",
    path: "inspector-flow.svg",
    width: 250,
    workspaceId,
  });
  if (
    preview?.documentPath !== "inspector-preview.png" ||
    preview.width !== 250 ||
    typeof preview.artifact?.uri !== "string"
  )
    throw new Error(
      "document_render_preview did not publish the expected preview",
    );

  const exported = await callThroughInspector("export_png", {
    background: "transparent",
    expectedRevision: resized.revision,
    outputPath: "inspector-export.png",
    path: "inspector-flow.svg",
    width: 400,
    workspaceId,
  });
  if (
    exported?.background !== "transparent" ||
    exported.width !== 400 ||
    exported.height !== 160 ||
    typeof exported.hash !== "string"
  )
    throw new Error(
      `export_png did not publish the expected PNG dimensions (${exported?.width}x${exported?.height})`,
    );
  const png = await readFile(join(workspaceRoot, "inspector-export.png"));
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("export_png did not write a valid PNG signature");
} finally {
  await rm(workspaceRoot, { force: true, recursive: true });
}

process.stderr.write("F05 Inspector stdio flow checks passed.\n");
