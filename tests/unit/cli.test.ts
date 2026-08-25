import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const cliPath = resolve(process.cwd(), "dist", "cli.js");

describe("inkscape-mcp CLI bootstrap", () => {
  it("prints help without starting a server", () => {
    const stdout = execFileSync(process.execPath, [cliPath, "--help"], {
      encoding: "utf8",
    });

    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("no running MCP server yet");
  });

  it("prints the package version", () => {
    const stdout = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
    });

    expect(stdout.trim()).toBe("0.0.0");
  });
});
