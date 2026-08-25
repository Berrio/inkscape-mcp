#!/usr/bin/env node

import packageMetadata from "../package.json" with { type: "json" };

import { loadConfigFromCli } from "./config/index.js";
import { formatDoctor, runDoctor } from "./doctor/index.js";

const usage = `inkscape-mcp ${packageMetadata.version}

Usage:
  inkscape-mcp --help
  inkscape-mcp --version
  inkscape-mcp --doctor [--json] [configuración]

This pre-alpha binary has no running MCP server yet.`;

const argumentsList = process.argv.slice(2);
const [argument] = argumentsList;

if (argument === "--help" || argument === "-h") {
  process.stdout.write(`${usage}\n`);
} else if (argument === "--version" || argument === "-V") {
  process.stdout.write(`${packageMetadata.version}\n`);
} else if (argument === "--doctor") {
  const json = argumentsList.includes("--json");
  const configArguments = argumentsList
    .slice(1)
    .filter((item) => item !== "--json");
  try {
    const config = await loadConfigFromCli(configArguments);
    const report = await runDoctor(config, process.cwd());
    process.stdout.write(
      `${json ? JSON.stringify(report, null, 2) : formatDoctor(report)}\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unable to run doctor"}\n`,
    );
    process.exitCode = 1;
  }
} else {
  process.stderr.write(
    "inkscape-mcp is not implemented yet. Run with --help.\n",
  );
  process.exitCode = 1;
}
