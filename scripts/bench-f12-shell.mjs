// F12-T01 research benchmark: one-shot batch processes versus a persistent
// `inkscape --shell` worker. It is a measurement tool, not a product path:
// the shell needs an interactive stdin that the production runner forbids.
//
// Usage: npm run bench:f12-shell [-- --exports 10]
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";

import { locateInkscape } from "../dist/discovery/index.js";
import { verifyPng } from "../dist/export/index.js";
import { ProcessRunner } from "../dist/runner/index.js";

const exportsFlag = process.argv.indexOf("--exports");
const exportCount =
  exportsFlag < 0 ? 10 : Number(process.argv[exportsFlag + 1]);
if (!Number.isInteger(exportCount) || exportCount < 2 || exportCount > 100)
  throw new Error("--exports must be an integer between 2 and 100");
const COMMAND_TIMEOUT_MS = 60_000;

const runner = new ProcessRunner(1);
const discovery = await locateInkscape({
  config: { inkscapeBin: "auto" },
  cwd: process.cwd(),
  runner,
});
const executable = discovery.candidates[0]?.executablePath;
if (!executable) throw new Error("Inkscape is not available");

const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-f12-shell-"));
const input = join(directory, "input.svg");
await writeFile(
  input,
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0a7"/><circle cx="32" cy="32" r="20" fill="#fff"/></svg>',
);

try {
  const batch = await benchmarkBatch();
  const shell = await benchmarkShell();
  const recovery = await benchmarkRecovery();
  process.stdout.write(
    `${JSON.stringify(
      {
        exports: exportCount,
        inkscape: discovery.candidates[0]?.installKind,
        batch,
        shell,
        recovery,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(directory, { force: true, recursive: true });
}

async function benchmarkBatch() {
  const latencies = [];
  for (let index = 0; index < exportCount; index += 1) {
    const output = join(directory, `batch-${index}.png`);
    const startedAt = performance.now();
    const result = await runner.run(executable, {
      args: [input, "--export-type=png", `--export-filename=${output}`],
      cwd: directory,
      maxStderrBytes: 1 << 20,
      maxStdoutBytes: 1 << 20,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) throw new Error(`batch export ${index} failed`);
    await verifyPng(output);
    latencies.push(performance.now() - startedAt);
  }
  return summarize(latencies);
}

async function benchmarkShell() {
  const session = await startShell();
  try {
    const latencies = [];
    const memory = [];
    for (let index = 0; index < exportCount; index += 1) {
      const output = join(directory, `shell-${index}.png`);
      const startedAt = performance.now();
      // Open, export and close per request: the reset that isolates one
      // document from the next inside the long-lived process.
      await session.command(
        `file-open:${input}; export-type:png; export-filename:${output}; export-do; file-close`,
      );
      await verifyPng(output);
      latencies.push(performance.now() - startedAt);
      memory.push(treeWorkingSetMiB(session.pid));
    }
    return {
      ...summarize(latencies),
      startupMs: Math.round(session.startupMs),
      workingSetMiB: {
        afterFirst: memory[0],
        afterLast: memory.at(-1),
        growth: Number((memory.at(-1) - memory[0]).toFixed(1)),
      },
    };
  } finally {
    await session.stop();
  }
}

async function benchmarkRecovery() {
  const first = await startShell();
  const crashedAt = performance.now();
  await first.kill();
  const replacement = await startShell();
  try {
    const output = join(directory, "recovered.png");
    await replacement.command(
      `file-open:${input}; export-type:png; export-filename:${output}; export-do; file-close`,
    );
    await verifyPng(output);
    return {
      killToFirstExportMs: Math.round(performance.now() - crashedAt),
    };
  } finally {
    await replacement.stop();
  }
}

/** Starts `inkscape --shell` and resolves once its first prompt appears. */
async function startShell() {
  const startedAt = performance.now();
  const child = spawn(executable, ["--shell"], {
    cwd: directory,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = "";
  let waiter;
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    buffer += chunk;
    if (waiter && /(^|\n)>\s*$/u.test(buffer)) {
      const resolve = waiter;
      waiter = undefined;
      buffer = "";
      resolve();
    }
  });
  child.stderr.resume();
  const prompt = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("inkscape --shell prompt timed out")),
        COMMAND_TIMEOUT_MS,
      );
      waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      if (/(^|\n)>\s*$/u.test(buffer)) waiter();
    });
  await prompt();
  const startupMs = performance.now() - startedAt;
  return {
    pid: child.pid,
    startupMs,
    async command(line) {
      const ready = prompt();
      child.stdin.write(`${line}\n`);
      await ready;
    },
    async kill() {
      killTree(child.pid);
      await new Promise((resolve) => child.once("close", resolve));
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.stdin.end("quit\n");
      const exited = new Promise((resolve) => child.once("close", resolve));
      const timer = setTimeout(() => killTree(child.pid), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

function killTree(pid) {
  try {
    execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // Already gone.
  }
}

/** Working set of a process and its descendants, in MiB (Windows). */
function treeWorkingSetMiB(rootPid) {
  const csv = execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2}' -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize }",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const rows = csv
    .trim()
    .split(/\r?\n/u)
    .map((line) => line.split(",").map(Number));
  const included = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, parent] of rows)
      if (included.has(parent) && !included.has(pid)) {
        included.add(pid);
        grew = true;
      }
  }
  const bytes = rows
    .filter(([pid]) => included.has(pid))
    .reduce((sum, [, , size]) => sum + size, 0);
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function summarize(latencies) {
  const sorted = [...latencies].sort((left, right) => left - right);
  const total = latencies.reduce((sum, value) => sum + value, 0);
  return {
    meanMs: Math.round(total / latencies.length),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
    maxMs: Math.round(sorted.at(-1)),
    firstMs: Math.round(latencies[0]),
    totalMs: Math.round(total),
  };
}
