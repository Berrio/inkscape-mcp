#!/usr/bin/env node

import packageMetadata from "../package.json" with { type: "json" };
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";

import {
  parseAutonomousExportArguments,
  runAutonomousExport,
} from "./automation/export-command.js";
import { loadConfigFromCli } from "./config/index.js";
import { formatDoctor, runDoctor } from "./doctor/index.js";
import { buildServer } from "./server/index.js";

const usage = `inkscape-mcp ${packageMetadata.version}

Usage:
  inkscape-mcp --help
  inkscape-mcp --version
  inkscape-mcp --doctor [--json] [configuración]
  inkscape-mcp export --source <svg> --preset <name> --output-directory <dir> [--dry-run] [configuración]

With no command, it serves MCP through stdio.`;

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
} else if (argument === "export") {
  try {
    const request = parseAutonomousExportArguments(argumentsList.slice(1));
    const result = await runAutonomousExport(
      request,
      fileURLToPath(import.meta.url),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unable to export preset"}\n`,
    );
    process.exitCode = 1;
  }
} else {
  try {
    const config = await loadConfigFromCli(argumentsList);
    if (config.transport !== "stdio") {
      throw new Error("HTTP transport is not implemented yet");
    }
    serveStdio(() => buildServer(config), {
      legacy: "serve",
      onerror: (error) =>
        process.stderr.write(`MCP stdio error: ${error.message}\n`),
    });
  } catch (error: unknown) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unable to start MCP server"}\n`,
    );
    process.exitCode = 1;
  }
}
