import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import packageMetadata from "../package.json" with { type: "json" };

const server = {
  args: ["dist/cli.js"],
  command: process.execPath,
  cwd: process.cwd(),
  stderr: "pipe",
};
const requiredTools = [
  "accessibility_inspect",
  "document_create",
  "document_export_batch",
  "document_import",
  "document_inspect",
  "document_render_preview",
  "elements_create",
  "images_manage",
  "inkscape_status",
  "workspace_list",
];
const expectedAnnotations = new Map([
  ["document_create", { destructiveHint: false }],
  ["document_export_batch", { destructiveHint: false }],
  ["document_inspect", { readOnlyHint: true }],
  ["document_render_preview", { destructiveHint: false }],
  ["elements_create", { destructiveHint: true }],
  ["inkscape_status", { readOnlyHint: true }],
  ["job_cancel", { destructiveHint: false }],
  ["job_get", { readOnlyHint: true }],
  ["workspace_list", { readOnlyHint: true }],
]);
const requiredOutputProperties = new Map([
  ["document_create", "revision"],
  ["document_export_batch", "mode"],
  ["document_inspect", "revision"],
  ["document_render_preview", "artifact"],
  ["elements_create", "revision"],
  ["inkscape_status", "workspaceReady"],
  ["job_cancel", "status"],
  ["job_get", "status"],
  ["workspace_list", "workspaces"],
]);

function outputSchemaBranches(schema) {
  if (Array.isArray(schema?.anyOf))
    return schema.anyOf.flatMap(outputSchemaBranches);
  if (Array.isArray(schema?.oneOf))
    return schema.oneOf.flatMap(outputSchemaBranches);
  if (schema?.type === "object") return [schema];
  return [];
}

function assertToolAnnotationsAndOutputSchemas(tools) {
  for (const tool of tools) {
    const schemas = outputSchemaBranches(tool.outputSchema);
    if (
      schemas.length === 0 ||
      schemas.some(
        (schema) =>
          schema.additionalProperties !== false ||
          typeof schema.properties !== "object" ||
          Object.keys(schema.properties).length === 0,
      )
    )
      throw new Error(`tool ${tool.name} has a missing or open output schema`);
    const annotations = tool.annotations;
    if (
      annotations === undefined ||
      Object.values(annotations).some((value) => typeof value !== "boolean") ||
      (annotations.readOnlyHint === true &&
        annotations.destructiveHint === true)
    )
      throw new Error(`tool ${tool.name} has invalid intent annotations`);
  }
  for (const [name, expected] of expectedAnnotations) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (JSON.stringify(tool?.annotations) !== JSON.stringify(expected))
      throw new Error(`tool ${name} changed its stable intent annotation`);
  }
  for (const [name, property] of requiredOutputProperties) {
    const tool = tools.find((candidate) => candidate.name === name);
    if (
      !outputSchemaBranches(tool?.outputSchema).some(
        (schema) => property in schema.properties,
      )
    )
      throw new Error(`tool ${name} output schema omits ${property}`);
  }
}

async function inspectCatalog(
  label,
  versionNegotiation = { mode: { pin: "2026-07-28" } },
) {
  const client = new Client(
    {
      name: `inkscape-mcp-f09-contract-${label}`,
      version: packageMetadata.version,
    },
    { versionNegotiation },
  );
  const transport = new StdioClientTransport(server);
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name);
    if (
      tools.length < 80 ||
      new Set(names).size !== names.length ||
      requiredTools.some((name) => !names.includes(name)) ||
      tools.some(
        (tool) =>
          typeof tool.description !== "string" ||
          tool.description.length === 0 ||
          tool.inputSchema === undefined ||
          tool.outputSchema === undefined,
      )
    )
      throw new Error("server did not expose its complete typed tool catalog");
    assertToolAnnotationsAndOutputSchemas(tools);
    const instructions = client.getInstructions();
    for (const phrase of [
      "workspace_list",
      "expectedRevision",
      "expectedOutputRevision",
      "relative path",
      "capability",
    ])
      if (!instructions?.includes(phrase))
        throw new Error(`server instructions omit ${phrase}`);
    const noWorkspace = await client.callTool({
      arguments: {
        path: "does-not-exist.svg",
        workspaceId: "ws_0000000000000000",
      },
      name: "document_inspect",
    });
    if (!noWorkspace.isError)
      throw new Error("document inspection used implicit document state");
    const unknownInput = await client.callTool({
      arguments: { unexpected: true },
      name: "inkscape_status",
    });
    if (!unknownInput.isError)
      throw new Error("tool validation did not return a recoverable error");
    return JSON.stringify(tools);
  } finally {
    await client.close();
  }
}

async function assertUnsupportedPinnedVersionIsRejected() {
  const client = new Client(
    {
      name: "inkscape-mcp-f09-unsupported-version",
      version: packageMetadata.version,
    },
    { versionNegotiation: { mode: { pin: "2099-01-01" } } },
  );
  const transport = new StdioClientTransport(server);
  try {
    await client.connect(transport);
  } catch (error) {
    if (!String(error).includes("Unsupported protocol version")) throw error;
    return;
  } finally {
    await client.close();
  }
  throw new Error(
    "stdio server silently accepted an unsupported protocol version",
  );
}

async function assertInvalidProtocolReturnsJsonRpcError() {
  const child = spawn(process.execPath, server.args, {
    cwd: server.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  const messages = [];
  const waiters = [];
  const nextMessage = () =>
    new Promise((resolve, reject) => {
      const queued = messages.shift();
      if (queued !== undefined) {
        resolve(queued);
        return;
      }
      const timeout = setTimeout(
        () => reject(new Error("stdio server did not answer JSON-RPC")),
        5_000,
      );
      waiters.push({ reject, resolve, timeout });
    });
  child.once("error", (error) => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        for (const waiter of waiters) {
          clearTimeout(waiter.timeout);
          waiter.reject(
            new Error("stdio server wrote non-JSON content to stdout"),
          );
        }
        return;
      }
      const waiter = waiters.shift();
      if (waiter === undefined) messages.push(message);
      else {
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
      }
      newline = buffer.indexOf("\n");
    }
  });
  try {
    child.stdin.write(
      `${JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "raw-contract-test", version: "0.0.0" },
          protocolVersion: "2026-07-28",
        },
      })}\n`,
    );
    const initialized = await nextMessage();
    if (initialized?.id !== 1 || initialized.error !== undefined)
      throw new Error("stdio server did not initialize a raw MCP client");
    child.stdin.write(
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"cursor":3}}\n',
    );
    const invalid = await nextMessage();
    if (invalid?.id !== 2 || typeof invalid?.error?.code !== "number")
      throw new Error(
        "invalid MCP parameters did not receive a JSON-RPC error",
      );
  } finally {
    child.kill();
  }
}

function revision(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertJobProgressIsObservable() {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-f09-job-"));
  const client = new Client(
    { name: "inkscape-mcp-f09-job-progress", version: packageMetadata.version },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StdioClientTransport({
    ...server,
    args: ["dist/cli.js", "--workspace-root", workspaceRoot],
  });
  try {
    await client.connect(transport);
    const listed = await client.callTool({
      arguments: {},
      name: "workspace_list",
    });
    const workspace = listed.structuredContent?.workspaces?.[0];
    if (listed.isError || typeof workspace?.id !== "string")
      throw new Error("job progress test could not resolve its workspace");
    const path = "job-progress.svg";
    await writeFile(
      join(workspaceRoot, path),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1000px" height="1000px" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#123456"/></svg>',
      "utf8",
    );
    const expectedRevision = revision(
      await readFile(join(workspaceRoot, path)),
    );
    const submitted = await client.callTool({
      arguments: {
        delivery: "job",
        mode: "all_or_nothing",
        specs: [
          {
            area: { kind: "page" },
            background: { mode: "transparent" },
            format: "png",
            size: { dpi: 300, mode: "dpi" },
            source: { expectedRevision, path },
            target: {
              kind: "file",
              overwrite: false,
              path: "job-progress.png",
            },
          },
        ],
        workspaceId: workspace.id,
      },
      name: "document_export_batch",
    });
    const jobId = submitted.structuredContent?.jobId;
    if (submitted.isError || typeof jobId !== "string")
      throw new Error("document_export_batch did not create a job");
    const stageOrder = {
      completed: 6,
      publishing: 5,
      rendering: 3,
      staging: 2,
      validated: 1,
      verifying: 4,
    };
    let previous = 0;
    let observed = false;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await client.callTool({
        arguments: { jobId, workspaceId: workspace.id },
        name: "job_get",
      });
      if (status.isError) throw new Error("job_get rejected its owner");
      const stage = status.structuredContent?.progress?.stage;
      if (stage !== undefined) {
        const order = stageOrder[stage];
        if (order === undefined || order < previous)
          throw new Error("job_get reported non-monotonic progress");
        previous = order;
        observed = true;
      }
      if (
        status.structuredContent?.status === "cancelled" ||
        status.structuredContent?.status === "completed" ||
        status.structuredContent?.status === "failed"
      )
        break;
      await delay(25);
    }
    if (!observed) throw new Error("job_get never exposed job progress");
  } finally {
    await client.close();
    await rm(workspaceRoot, { force: true, recursive: true });
  }
}

const firstCatalog = await inspectCatalog("first");
const secondCatalog = await inspectCatalog("second");
if (firstCatalog !== secondCatalog)
  throw new Error("two fresh stdio servers emitted different tool catalogs");
const legacyCatalog = await inspectCatalog("legacy", { mode: "legacy" });
const toolNames = (catalog) =>
  JSON.parse(catalog)
    .map((tool) => tool.name)
    .sort();
if (
  JSON.stringify(toolNames(legacyCatalog)) !==
  JSON.stringify(toolNames(firstCatalog))
)
  throw new Error("legacy stdio negotiation changed the advertised tool names");
await assertUnsupportedPinnedVersionIsRejected();
await assertInvalidProtocolReturnsJsonRpcError();
await assertJobProgressIsObservable();

process.stderr.write("F09 server catalog MCP checks passed.\n");
