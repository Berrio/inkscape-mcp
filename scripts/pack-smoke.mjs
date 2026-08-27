import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
const temporaryRoot = mkdtempSync(join(tmpdir(), "inkscape-mcp-pack-"));
const packageDirectory = join(temporaryRoot, "package");
const installDirectory = join(temporaryRoot, "install");
const workspaceDirectory = join(temporaryRoot, "workspace");

try {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the package smoke test");
  }

  mkdirSync(packageDirectory);
  mkdirSync(installDirectory);
  mkdirSync(workspaceDirectory);

  const packResult = execFileSync(
    process.execPath,
    [npmCli, "pack", "--json", "--pack-destination", packageDirectory],
    { cwd: root, encoding: "utf8" },
  );
  const [packed] = JSON.parse(packResult);

  if (!packed?.filename) {
    throw new Error("npm pack did not return a tarball filename");
  }

  const tarball = join(packageDirectory, basename(packed.filename));
  execFileSync(
    process.execPath,
    [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarball,
    ],
    { cwd: installDirectory, encoding: "utf8" },
  );

  const installedPackage = join(
    installDirectory,
    "node_modules",
    "inkscape-mcp",
  );
  const packageMetadata = JSON.parse(
    readFileSync(join(installedPackage, "package.json"), "utf8"),
  );
  const serverManifest = JSON.parse(
    readFileSync(join(installedPackage, "server.json"), "utf8"),
  );
  if (
    serverManifest.name !== packageMetadata.mcpName ||
    serverManifest.version !== packageMetadata.version ||
    serverManifest.packages?.[0]?.identifier !== packageMetadata.name ||
    serverManifest.packages?.[0]?.transport?.type !== "stdio"
  ) {
    throw new Error("Packed server.json does not match package metadata");
  }
  const binDirectory = join(installDirectory, "node_modules", ".bin");
  const binPath = join(
    binDirectory,
    process.platform === "win32" ? "inkscape-mcp.cmd" : "inkscape-mcp",
  );

  if (!existsSync(binPath)) {
    throw new Error("npm did not create the inkscape-mcp executable shim");
  }
  for (const scriptName of [
    "Invoke-InkscapeMcpRecipe.ps1",
    "Register-InkscapeMcpDailyTask.ps1",
    "Invoke-InkscapeMcpQueue.ps1",
    "Register-InkscapeMcpQueueDailyTask.ps1",
  ])
    if (!existsSync(join(installedPackage, "scripts", "windows", scriptName)))
      throw new Error(`Packed CLI is missing Windows automation ${scriptName}`);

  const output = execFileSync(
    process.execPath,
    [
      npmCli,
      "exec",
      "--prefix",
      installDirectory,
      "--",
      "inkscape-mcp",
      "--version",
    ],
    {
      encoding: "utf8",
    },
  );

  if (output.trim() !== packageMetadata.version) {
    throw new Error("Packed CLI version does not match package metadata");
  }

  writeFileSync(
    join(workspaceDirectory, "package-cli.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><rect width="10" height="10" fill="#dbeafe"/></svg>',
  );
  const autonomousExport = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "export",
        "--source",
        "package-cli.svg",
        "--preset",
        "web-png",
        "--output-directory",
        "package-cli-output",
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    autonomousExport.status !== "completed" ||
    !existsSync(join(workspaceDirectory, "package-cli-output", "web-1200.png"))
  ) {
    throw new Error("Packed CLI did not complete an autonomous export");
  }

  const recipePath = join(workspaceDirectory, "package-recipe.json");
  writeFileSync(
    recipePath,
    JSON.stringify({
      operations: [
        { kind: "inspect" },
        {
          kind: "preflight",
          outputDirectory: "package-recipe-plan",
          preset: "plain-svg",
        },
        {
          kind: "export",
          outputDirectory: "package-recipe-output",
          preset: "web-png",
        },
      ],
      schema: "inkscape-mcp-recipe/v1",
      source: "package-cli.svg",
    }),
  );
  const autonomousRecipe = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "run",
        recipePath,
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    autonomousRecipe.schema !== "inkscape-mcp-recipe-receipt/v1" ||
    autonomousRecipe.operations?.[2]?.status !== "completed" ||
    existsSync(join(workspaceDirectory, "package-recipe-plan")) ||
    !existsSync(
      join(workspaceDirectory, "package-recipe-output", "web-1200.png"),
    )
  ) {
    throw new Error("Packed CLI did not execute an autonomous recipe");
  }

  const queueRecipePath = join(workspaceDirectory, "package-queue-recipe.json");
  writeFileSync(
    queueRecipePath,
    JSON.stringify({
      operations: [{ kind: "inspect" }],
      schema: "inkscape-mcp-recipe/v1",
      source: "package-cli.svg",
    }),
  );
  const durableJob = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "queue",
        "enqueue",
        queueRecipePath,
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  const queueWorker = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "queue",
        "work",
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  const durableReceipt = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "queue",
        "get",
        durableJob.id,
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  const durableList = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "exec",
        "--prefix",
        installDirectory,
        "--",
        "inkscape-mcp",
        "queue",
        "list",
        "--status",
        "completed",
        "--workspace-root",
        workspaceDirectory,
      ],
      { encoding: "utf8" },
    ),
  );
  if (
    durableJob.status !== "queued" ||
    queueWorker.completed !== 1 ||
    durableReceipt.status !== "completed" ||
    durableReceipt.receipt?.schema !== "inkscape-mcp-recipe-receipt/v1" ||
    !Array.isArray(durableList) ||
    durableList[0]?.id !== durableJob.id ||
    durableList[0]?.receipt !== undefined
  ) {
    throw new Error("Packed CLI did not persist and run a durable recipe");
  }

  const doctorOutput = execFileSync(
    process.execPath,
    [
      npmCli,
      "exec",
      "--prefix",
      installDirectory,
      "--",
      "inkscape-mcp",
      "--doctor",
      "--json",
    ],
    { encoding: "utf8" },
  );
  const doctor = JSON.parse(doctorOutput);
  if (
    typeof doctor !== "object" ||
    doctor === null ||
    typeof doctor.workspaceReady !== "boolean"
  ) {
    throw new Error("Packed CLI doctor did not return a valid report");
  }

  const client = new Client(
    { name: "inkscape-mcp-pack-smoke", version: packageMetadata.version },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StdioClientTransport({
    args: [
      join(installedPackage, "dist", "cli.js"),
      "--workspace-root",
      workspaceDirectory,
    ],
    command: process.execPath,
    cwd: installDirectory,
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (
      !listed.tools.some((tool) => tool.name === "inkscape_status") ||
      !listed.tools.some((tool) => tool.name === "document_import_raster")
    )
      throw new Error("Packed CLI did not list the expected stdio tools");
    const status = await client.callTool({
      arguments: {},
      name: "inkscape_status",
    });
    if (status.isError || status.structuredContent === undefined)
      throw new Error("Packed CLI did not answer inkscape_status over stdio");
  } finally {
    await client.close();
  }

  process.stdout.write(
    `Package smoke test passed for ${packageMetadata.name}@${packageMetadata.version}.\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
