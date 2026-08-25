import { describe, expect, it } from "vitest";

import {
  CapabilityService,
  parseActionList,
  parseHelpOptions,
  parseInputTypes,
} from "../../src/capabilities/index.js";

describe("Inkscape capabilities", () => {
  it("parses options, input types and action names deterministically", () => {
    expect(
      parseHelpOptions("  --export-type  --help-all\n--export-type"),
    ).toEqual(["--export-type", "--help-all"]);
    expect(parseInputTypes("SVG\npng\ninvalid type\npng\n")).toEqual([
      "png",
      "svg",
    ]);
    expect(
      parseActionList("zoom-in : Zoom\nexport-do : Export\nnot an action"),
    ).toEqual(["export-do", "zoom-in"]);
  });

  it("caches a snapshot by executable metadata and version", async () => {
    let calls = 0;
    const runner = {
      run: async (
        _executable: string,
        request: { args: readonly string[] },
      ) => {
        calls += 1;
        const output =
          request.args[0] === "--action-list"
            ? "zoom-in : Zoom\nexport-do : Export\n"
            : request.args[0] === "--list-input-types"
              ? "svg\npng\n"
              : "--export-type\n--help-all\n";
        return {
          durationMs: 1,
          exitCode: 0,
          pid: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          stderrTruncated: false,
          stdout: Buffer.from(output),
          stdoutTruncated: false,
          terminationReason: "completed" as const,
        };
      },
    };
    const service = new CapabilityService();
    const candidate = {
      executablePath: process.execPath,
      installKind: "system" as const,
      sources: ["path" as const],
    };

    const first = await service.inspect(
      runner,
      candidate,
      "1.4.4",
      process.cwd(),
    );
    const second = await service.inspect(
      runner,
      candidate,
      "1.4.4",
      process.cwd(),
    );

    expect(first.actionCount).toBe(2);
    expect(first.actionEvidence).toEqual([
      { name: "export-do", origin: "unknown" },
      { name: "zoom-in", origin: "unknown" },
    ]);
    expect(first.flags).toContainEqual({
      availability: "available",
      name: "--export-type",
    });
    expect(first.flags).toContainEqual({
      availability: "absent",
      name: "--export-page",
    });
    expect(first.experimentalCapabilities).toEqual([]);
    expect(second).toBe(first);
    expect(calls).toBe(3);
  });
});
