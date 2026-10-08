import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Package under test for the E2E gate scripts. By default the gates exercise
 * the source checkout (`dist/cli.js` relative to the repository). The
 * `test:installed` gate sets `INKSCAPE_MCP_PACKAGE_ROOT` to an npm-installed
 * copy of the packed tarball so the same assertions run against what users
 * install (F11-G02).
 */
const configuredRoot = process.env.INKSCAPE_MCP_PACKAGE_ROOT;

export const packageRoot =
  configuredRoot === undefined || configuredRoot === ""
    ? process.cwd()
    : resolve(configuredRoot);

/** Server/CLI entry point passed to `node` by the gate scripts. */
export const serverEntry =
  configuredRoot === undefined || configuredRoot === ""
    ? "dist/cli.js"
    : join(packageRoot, "dist", "cli.js");

if (!existsSync(resolve(serverEntry)))
  throw new Error(`Server entry point is missing: ${serverEntry}`);
