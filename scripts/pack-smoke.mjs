import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npmCli = process.env.npm_execpath;
const temporaryRoot = mkdtempSync(join(tmpdir(), "inkscape-mcp-pack-"));
const packageDirectory = join(temporaryRoot, "package");
const installDirectory = join(temporaryRoot, "install");

try {
  if (!npmCli) {
    throw new Error("npm_execpath is required to run the package smoke test");
  }

  mkdirSync(packageDirectory);
  mkdirSync(installDirectory);

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

  process.stdout.write(
    `Package smoke test passed for ${packageMetadata.name}@${packageMetadata.version}.\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
