import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_CONFIG } from "../dist/config/index.js";
import { startHttpMcpServer } from "../dist/http.js";

const token = "f10_inspector_test_token_1234567890";
const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-f10-inspector-"));
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
const conformanceEntry = join(
  process.cwd(),
  "node_modules",
  "@modelcontextprotocol",
  "conformance",
  "dist",
  "index.js",
);
const server = await startHttpMcpServer(
  {
    ...DEFAULT_CONFIG,
    http: { ...DEFAULT_CONFIG.http, port: 0 },
    transport: "http",
  },
  token,
  { log: () => undefined },
);

try {
  const inspector = await runProcess(inspectorEntry, [
    "--cli",
    "--transport",
    "http",
    "--server-url",
    server.url,
    "--header",
    `Authorization: Bearer ${token}`,
    "--method",
    "tools/list",
    "--format",
    "json",
  ]);
  if (
    inspector.code !== 1 ||
    !/Unsupported protocol version: 2025-11-25/u.test(inspector.stderr)
  )
    throw new Error("Inspector HTTP compatibility result changed unexpectedly");
  const conformance = await runProcess(conformanceEntry, ["list", "--server"]);
  if (
    conformance.code !== 0 ||
    /2026-07-28/u.test(conformance.stdout) ||
    !/2025-11-25/u.test(conformance.stdout)
  )
    throw new Error("Conformance HTTP capability result changed unexpectedly");
} finally {
  await server.close();
  await rm(directory, { force: true, recursive: true });
}

process.stderr.write(
  "F10 Inspector/conformance tools do not yet support modern HTTP; gate remains unavailable.\n",
);

function runProcess(entry, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...argumentsList], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stderr: Buffer.concat(stderr)
          .toString("utf8")
          .replaceAll(token, "[redacted]"),
        stdout: Buffer.concat(stdout)
          .toString("utf8")
          .replaceAll(token, "[redacted]"),
      });
    });
  });
}
