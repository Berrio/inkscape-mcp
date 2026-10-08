// F11-G02: run the P0/P1 E2E gates and the Inspector stdio check against the
// packed tarball installed with npm, not against the source checkout.
import { execFileSync, spawnSync } from "node:child_process";
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
if (!npmCli)
  throw new Error("npm_execpath is required; run `npm run test:installed`");

/** Gates that do not exercise the packaged stdio server. */
const EXCLUDED_SCRIPTS = new Set([
  // Builds and installs its own tarball.
  "scripts/pack-smoke.mjs",
  // This orchestrator itself.
  "scripts/test-installed-package.mjs",
  // HTTP is outside the Windows/stdio 1.0 release (F10).
  "scripts/test-f10-http-inspector.mjs",
]);

const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const gateScripts = [
  ...new Set(
    Object.entries(packageJson.scripts)
      .filter(([name]) => name.startsWith("test:"))
      .flatMap(([, command]) =>
        [...command.matchAll(/node (scripts\/[\w.-]+\.mjs)/gu)].map(
          (match) => match[1],
        ),
      ),
  ),
]
  .filter((script) => !EXCLUDED_SCRIPTS.has(script))
  .sort();

const temporaryRoot = mkdtempSync(join(tmpdir(), "inkscape-mcp-installed-"));
const packageDirectory = join(temporaryRoot, "package");
const installDirectory = join(temporaryRoot, "install");
const results = [];
try {
  mkdirSync(packageDirectory);
  mkdirSync(installDirectory);
  const [packed] = JSON.parse(
    execFileSync(
      process.execPath,
      [npmCli, "pack", "--json", "--pack-destination", packageDirectory],
      { cwd: root, encoding: "utf8" },
    ),
  );
  if (!packed?.filename) throw new Error("npm pack returned no tarball");
  execFileSync(
    process.execPath,
    [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(packageDirectory, basename(packed.filename)),
    ],
    { cwd: installDirectory, encoding: "utf8" },
  );
  const installedPackage = join(
    installDirectory,
    "node_modules",
    "inkscape-mcp",
  );
  if (!existsSync(join(installedPackage, "dist", "cli.js")))
    throw new Error("Installed package has no dist/cli.js");
  const installedVersion = JSON.parse(
    readFileSync(join(installedPackage, "package.json"), "utf8"),
  ).version;
  if (installedVersion !== packageJson.version)
    throw new Error("Installed package version does not match the checkout");

  process.stdout.write(
    `Running ${gateScripts.length} gates against installed ${packageJson.name}@${installedVersion}\n`,
  );
  for (const script of gateScripts) {
    const startedAt = Date.now();
    const run = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, INKSCAPE_MCP_PACKAGE_ROOT: installedPackage },
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    results.push({ script, status: run.status, seconds });
    process.stdout.write(
      `${run.status === 0 ? "PASS" : "FAIL"} ${script} (${seconds}s)\n`,
    );
  }
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

const failed = results.filter((result) => result.status !== 0);
process.stdout.write(
  `Installed package gates: ${results.length - failed.length}/${results.length} passed.\n`,
);
if (failed.length > 0) process.exitCode = 1;
