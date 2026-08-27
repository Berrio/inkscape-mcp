import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import packageMetadata from "../../package.json" with { type: "json" };

import { describe, expect, it } from "vitest";

const cliPath = resolve(process.cwd(), "dist", "cli.js");

describe("inkscape-mcp CLI bootstrap", () => {
  it("prints help without starting a server", () => {
    const stdout = execFileSync(process.execPath, [cliPath, "--help"], {
      encoding: "utf8",
    });

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("serves MCP through stdio");
  });

  it("prints the package version", () => {
    const stdout = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
    });

    expect(stdout.trim()).toBe(packageMetadata.version);
  });
});
