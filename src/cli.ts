#!/usr/bin/env node

import packageMetadata from "../package.json" with { type: "json" };

const usage = `inkscape-mcp ${packageMetadata.version}

Usage:
  inkscape-mcp --help
  inkscape-mcp --version

This pre-alpha binary has no running MCP server yet.`;

const [argument] = process.argv.slice(2);

if (argument === "--help" || argument === "-h") {
  process.stdout.write(`${usage}\n`);
} else if (argument === "--version" || argument === "-V") {
  process.stdout.write(`${packageMetadata.version}\n`);
} else {
  process.stderr.write(
    "inkscape-mcp is not implemented yet. Run with --help.\n",
  );
  process.exitCode = 1;
}
