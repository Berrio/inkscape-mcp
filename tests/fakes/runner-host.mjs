// Stands in for an MCP server that dies abruptly while a native tree runs.
// Usage: node runner-host.mjs <cwd> <child-pid-file> <grandchild-pid-file>
import { fileURLToPath, URL } from "node:url";

import { ProcessRunner } from "../../dist/runner/index.js";

const [cwd, childPidPath, grandchildPidPath] = process.argv.slice(2);
const fake = fileURLToPath(new URL("./fake-inkscape.mjs", import.meta.url));
const runner = new ProcessRunner(1);
process.stdout.write(`${await runner.processContainment()}\n`);
await runner.run(process.execPath, {
  args: [
    fake,
    "tree",
    "--child-pid",
    childPidPath,
    "--grandchild-pid",
    grandchildPidPath,
  ],
  cwd,
  maxStderrBytes: 1024,
  maxStdoutBytes: 1024,
  timeoutMs: 60_000,
});
