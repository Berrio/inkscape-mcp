import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const workspaceRoot = await mkdtemp(
  join(tmpdir(), "inkscape mcp powershell test-"),
);
const runnerPath = resolve(
  "scripts",
  "windows",
  "Invoke-InkscapeMcpRecipe.ps1",
);
const queueRunnerPath = resolve(
  "scripts",
  "windows",
  "Invoke-InkscapeMcpQueue.ps1",
);
const registrationPath = resolve(
  "scripts",
  "windows",
  "Register-InkscapeMcpDailyTask.ps1",
);
const queueRegistrationPath = resolve(
  "scripts",
  "windows",
  "Register-InkscapeMcpQueueDailyTask.ps1",
);

async function assertPowerShellSyntax(path) {
  const escapedPath = path.replaceAll("'", "''");
  const command = `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.ToString() }; exit 1 }`;
  await executeFile(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true },
  );
}

try {
  await assertPowerShellSyntax(runnerPath);
  await assertPowerShellSyntax(queueRunnerPath);
  await assertPowerShellSyntax(registrationPath);
  await assertPowerShellSyntax(queueRegistrationPath);
  await writeFile(
    join(workspaceRoot, "label.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="10" height="10" fill="#dbeafe"/></svg>',
  );
  const recipePath = join(workspaceRoot, "scheduled recipe.json");
  await writeFile(
    recipePath,
    JSON.stringify({
      operations: [
        {
          kind: "export",
          outputDirectory: "scheduled output",
          preset: "web-png",
        },
      ],
      schema: "inkscape-mcp-recipe/v1",
      source: "label.svg",
    }),
  );
  const logPath = join(workspaceRoot, "logs", "scheduled export.log");
  const result = await executeFile(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      runnerPath,
      "-RecipePath",
      recipePath,
      "-WorkspaceRoot",
      workspaceRoot,
      "-LogPath",
      logPath,
      "-NonInteractive",
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const receipt = JSON.parse(result.stdout);
  if (
    receipt.schema !== "inkscape-mcp-recipe-receipt/v1" ||
    !existsSync(join(workspaceRoot, "scheduled output", "web-1200.png")) ||
    !(await readFile(logPath, "utf8")).includes("recipe exit=0")
  ) {
    throw new Error(
      "Windows PowerShell runner did not publish and log a recipe",
    );
  }
  const queueRecipePath = join(workspaceRoot, "queue recipe.json");
  await writeFile(
    queueRecipePath,
    JSON.stringify({
      operations: [
        {
          kind: "export",
          outputDirectory: "queue output",
          preset: "web-png",
        },
      ],
      schema: "inkscape-mcp-recipe/v1",
      source: "label.svg",
    }),
  );
  const queued = await executeFile(
    process.execPath,
    [
      "dist/cli.js",
      "queue",
      "enqueue",
      queueRecipePath,
      "--workspace-root",
      workspaceRoot,
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const queuedJob = JSON.parse(queued.stdout);
  const queueLogPath = join(workspaceRoot, "logs", "queue worker.log");
  const queueResult = await executeFile(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      queueRunnerPath,
      "-WorkspaceRoot",
      workspaceRoot,
      "-LogPath",
      queueLogPath,
      "-NonInteractive",
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const queueSummary = JSON.parse(queueResult.stdout);
  if (
    queuedJob.status !== "queued" ||
    queueSummary.completed !== 1 ||
    !existsSync(join(workspaceRoot, "queue output", "web-1200.png")) ||
    !(await readFile(queueLogPath, "utf8")).includes("queue worker exit=0")
  ) {
    throw new Error(
      "Windows queue runner did not complete and log a queued recipe",
    );
  }
  const taskName = `inkscape-mcp-whatif-${process.pid}`;
  await executeFile(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      registrationPath,
      "-TaskName",
      taskName,
      "-RecipePath",
      recipePath,
      "-WorkspaceRoot",
      workspaceRoot,
      "-LogPath",
      logPath,
      "-DailyAt",
      "02:00",
      "-WhatIf",
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024, windowsHide: true },
  );
  await executeFile(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      queueRegistrationPath,
      "-TaskName",
      `${taskName}-queue`,
      "-WorkspaceRoot",
      workspaceRoot,
      "-LogPath",
      queueLogPath,
      "-DailyAt",
      "02:00",
      "-WhatIf",
    ],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024, windowsHide: true },
  );
  process.stdout.write("Windows automation smoke test passed.\n");
} finally {
  await rm(workspaceRoot, { force: true, recursive: true });
}
