import { spawn } from "node:child_process";
import { join } from "node:path";

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
const child = spawn(
  process.execPath,
  [
    inspectorEntry,
    "--cli",
    "node",
    "dist/cli.js",
    "--method",
    "tools/list",
    "--format",
    "json",
  ],
  {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

const maximumBytes = 2 * 1024 * 1024;
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
  throw new Error(`Inspector CLI tools/list failed with status ${status}`);
let output;
try {
  output = JSON.parse(stdout);
} catch {
  throw new Error("Inspector CLI did not return JSON tools/list output");
}
if (
  !Array.isArray(output?.result?.tools) ||
  output.result.tools.length < 80 ||
  !output.result.tools.some((tool) => tool.name === "inkscape_status")
)
  throw new Error("Inspector CLI did not validate the expected tool catalog");

process.stderr.write("F09 Inspector CLI MCP checks passed.\n");
