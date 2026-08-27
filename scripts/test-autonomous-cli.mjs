import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const workspaceRoot = await mkdtemp(join(tmpdir(), "inkscape-mcp-cli-test-"));

async function runExport(argumentsList) {
  const result = await executeFile(
    process.execPath,
    ["dist/cli.js", "export", ...argumentsList],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(result.stdout);
}

async function runRecipe(recipePath) {
  const result = await executeFile(
    process.execPath,
    ["dist/cli.js", "run", recipePath, "--workspace-root", workspaceRoot],
    {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(result.stdout);
}

try {
  await writeFile(
    join(workspaceRoot, "label.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="10mm" viewBox="0 0 30 10"><rect width="30" height="10" fill="#dbeafe"/><text x="15" y="6" text-anchor="middle">Label</text></svg>',
  );
  const common = [
    "--source",
    "label.svg",
    "--preset",
    "web-png",
    "--output-directory",
    "autonomous-output",
    "--workspace-root",
    workspaceRoot,
  ];
  const plan = await runExport(["--dry-run", ...common]);
  if (
    plan.status !== "planned" ||
    plan.variantCount !== 1 ||
    plan.outputPaths?.[0] !== "autonomous-output/web-1200.png" ||
    existsSync(join(workspaceRoot, "autonomous-output"))
  ) {
    throw new Error(
      "Autonomous CLI dry-run published files or an invalid plan",
    );
  }
  const result = await runExport(common);
  const outputPath = join(workspaceRoot, "autonomous-output", "web-1200.png");
  if (
    result.status !== "completed" ||
    result.successes?.length !== 1 ||
    result.successes?.[0]?.outputPath !== "autonomous-output/web-1200.png" ||
    !existsSync(outputPath) ||
    (await readFile(outputPath)).length < 100
  ) {
    throw new Error("Autonomous CLI did not publish its verified PNG");
  }
  const recipePath = join(workspaceRoot, "recipe.json");
  await writeFile(
    recipePath,
    JSON.stringify({
      operations: [
        { kind: "inspect" },
        {
          kind: "preflight",
          outputDirectory: "recipe-plan",
          preset: "plain-svg",
        },
        {
          kind: "export",
          outputDirectory: "recipe-output",
          preset: "web-png",
        },
      ],
      schema: "inkscape-mcp-recipe/v1",
      source: "label.svg",
    }),
  );
  const recipe = await runRecipe(recipePath);
  if (
    recipe.schema !== "inkscape-mcp-recipe-receipt/v1" ||
    recipe.operations?.[0]?.status !== "completed" ||
    recipe.operations?.[1]?.status !== "planned" ||
    recipe.operations?.[2]?.status !== "completed" ||
    existsSync(join(workspaceRoot, "recipe-plan")) ||
    !existsSync(join(workspaceRoot, "recipe-output", "web-1200.png"))
  ) {
    throw new Error("Autonomous recipe did not preflight and publish safely");
  }
  const invalidRecipePath = join(workspaceRoot, "invalid-recipe.json");
  await writeFile(
    invalidRecipePath,
    JSON.stringify({
      schema: "inkscape-mcp-recipe/v1",
      source: "../escape.svg",
    }),
  );
  try {
    await runRecipe(invalidRecipePath);
    throw new Error("Autonomous recipe accepted an invalid schema");
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid schema"))
      throw error;
    if (!isExitCode(error, 2))
      throw new Error("Autonomous invalid recipe did not exit with code 2", {
        cause: error,
      });
  }
  process.stdout.write("Autonomous CLI export smoke test passed.\n");
} finally {
  await rm(workspaceRoot, { force: true, recursive: true });
}

function isExitCode(error, expected) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === expected
  );
}
