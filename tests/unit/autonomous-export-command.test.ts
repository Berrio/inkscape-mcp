import { describe, expect, it } from "vitest";

import { parseAutonomousExportArguments } from "../../src/automation/export-command.js";

describe("autonomous export command", () => {
  it("parses its closed arguments and preserves server configuration", () => {
    expect(
      parseAutonomousExportArguments([
        "--source",
        "labels.svg",
        "--preset",
        "web-asset-pack",
        "--output-directory",
        "exports/web",
        "--dry-run",
        "--workspace-index",
        "1",
        "--workspace-root",
        "C:/designs",
      ]),
    ).toEqual({
      configArguments: ["--workspace-root", "C:/designs"],
      dryRun: true,
      outputDirectory: "exports/web",
      preset: "web-asset-pack",
      source: "labels.svg",
      workspaceIndex: 1,
    });
  });

  it("rejects missing, repeated or malformed autonomous flags", () => {
    expect(() => parseAutonomousExportArguments([])).toThrow("--source");
    expect(() =>
      parseAutonomousExportArguments([
        "--source",
        "a.svg",
        "--source",
        "b.svg",
        "--preset",
        "web-png",
        "--output-directory",
        "out",
      ]),
    ).toThrow("only be supplied once");
    expect(() =>
      parseAutonomousExportArguments([
        "--source",
        "a.svg",
        "--preset",
        "not-a-preset",
        "--output-directory",
        "out",
      ]),
    ).toThrow("Invalid option");
    expect(() =>
      parseAutonomousExportArguments([
        "--source",
        "../a.svg",
        "--preset",
        "web-png",
        "--output-directory",
        "out",
      ]),
    ).toThrow();
  });
});
