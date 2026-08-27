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
  const binDirectory = join(installDirectory, "node_modules", ".bin");
  const binPath = join(
    binDirectory,
    process.platform === "win32" ? "inkscape-mcp.cmd" : "inkscape-mcp",
  );

  if (!existsSync(binPath)) {
    throw new Error("npm did not create the inkscape-mcp executable shim");
  }

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
    { name: "inkscape-mcp-pack-smoke", version: "0.0.0" },
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
    if (!listed.tools.some((tool) => tool.name === "inkscape_status"))
      throw new Error("Packed CLI did not list inkscape_status over stdio");
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
