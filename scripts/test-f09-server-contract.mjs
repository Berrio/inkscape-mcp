import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawn } from "node:child_process";
import { clearTimeout, setTimeout } from "node:timers";
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

async function inspectCatalog(label) {
  const client = new Client(
    {
      name: `inkscape-mcp-f09-contract-${label}`,
      version: packageMetadata.version,
    },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
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

const firstCatalog = await inspectCatalog("first");
const secondCatalog = await inspectCatalog("second");
if (firstCatalog !== secondCatalog)
  throw new Error("two fresh stdio servers emitted different tool catalogs");
await assertInvalidProtocolReturnsJsonRpcError();

process.stderr.write("F09 server catalog MCP checks passed.\n");
