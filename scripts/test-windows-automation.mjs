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
const registrationPath = resolve(
  "scripts",
  "windows",
  "Register-InkscapeMcpDailyTask.ps1",
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
  await assertPowerShellSyntax(registrationPath);
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
  process.stdout.write("Windows automation smoke test passed.\n");
} finally {
  await rm(workspaceRoot, { force: true, recursive: true });
}
