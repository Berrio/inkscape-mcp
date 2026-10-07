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
              : "--export-type\n--export-pdf-version\n--export-plain-svg\n--export-text-to-path\n--help-all\n";
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
    expect(first.flags).toContainEqual({
      availability: "absent",
      name: "--export-png-color-mode",
    });
    expect(first.experimentalCapabilities).toEqual([]);
    if (process.platform === "win32") {
      expect(first.versionSupport).toMatchObject({
        pageAdapter: "pages_v14",
        status: "stable",
      });
      expect(first.warnings).toEqual([]);
    } else {
      expect(first.versionSupport).toEqual({
        status: "experimental",
        warnings: ["INKSCAPE_PLATFORM_UNVERIFIED"],
      });
      expect(first.warnings).toEqual(["INKSCAPE_PLATFORM_UNVERIFIED"]);
    }
    expect(second).toBe(first);
    expect(calls).toBe(3);
  });

  it("retries a transient probe failure once and does not cache failures", async () => {
    const attempts = new Map<string, number>();
    let failActionList = 1;
    const runner = {
      run: async (
        _executable: string,
        request: { args: readonly string[] },
      ) => {
        const name = request.args[0]!;
        attempts.set(name, (attempts.get(name) ?? 0) + 1);
        const failing = name === "--action-list" && failActionList > 0;
        if (failing) failActionList -= 1;
        return {
          durationMs: 1,
          exitCode: failing ? null : 0,
          pid: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          stderrTruncated: false,
          stdout: Buffer.from(
            name === "--action-list" ? "export-do : Export\n" : "",
          ),
          stdoutTruncated: false,
          terminationReason: failing
            ? ("timeout" as const)
            : ("completed" as const),
        };
      },
    };
    const candidate = {
      executablePath: process.execPath,
      installKind: "system" as const,
      sources: ["path" as const],
    };
    const service = new CapabilityService();
    const recovered = await service.inspect(
      runner,
      candidate,
      "1.4.4",
      process.cwd(),
    );
    expect(attempts.get("--action-list")).toBe(2);
    expect(recovered.warnings).not.toContain(
      "INKSCAPE_ACTION_LIST_UNAVAILABLE",
    );

    failActionList = 2;
    const failedService = new CapabilityService();
    const failed = await failedService.inspect(
      runner,
      candidate,
      "1.4.4",
      process.cwd(),
    );
    expect(failed.warnings).toContain("INKSCAPE_ACTION_LIST_UNAVAILABLE");
    const next = await failedService.inspect(
      runner,
      candidate,
      "1.4.4",
      process.cwd(),
    );
    expect(next).not.toBe(failed);
    expect(next.warnings).not.toContain("INKSCAPE_ACTION_LIST_UNAVAILABLE");
  });

  it("does not retry deterministic output-limit failures", async () => {
    let calls = 0;
    await new CapabilityService().inspect(
      {
        run: async () => {
          calls += 1;
          return {
            durationMs: 1,
            exitCode: null,
            pid: 1,
            signal: null,
            stderr: Buffer.alloc(0),
            stderrTruncated: false,
            stdout: Buffer.alloc(0),
            stdoutTruncated: true,
            terminationReason: "output-limit" as const,
          };
        },
      },
      {
        executablePath: process.execPath,
        installKind: "system",
        sources: ["path"],
      },
      "1.4.4",
      process.cwd(),
    );
    expect(calls).toBe(3);
  });

  it("reports flag and action drift instead of assuming a matching version is compatible", async () => {
    const service = new CapabilityService();
    const result = await service.inspect(
      {
        run: async () => ({
          durationMs: 1,
          exitCode: 0,
          pid: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          stderrTruncated: false,
          stdout: Buffer.alloc(0),
          stdoutTruncated: false,
          terminationReason: "completed" as const,
        }),
      },
      {
        executablePath: process.execPath,
        installKind: "system",
        sources: ["path"],
      },
      "1.4.4",
      process.cwd(),
    );

    expect(result.warnings).toContain("INKSCAPE_ACTION_LIST_EMPTY");
    if (process.platform === "win32")
      expect(result.warnings).toContain(
        "INKSCAPE_1_4_4_FLAG_DRIFT:--export-type",
      );
    else expect(result.warnings).toContain("INKSCAPE_PLATFORM_UNVERIFIED");
  });
});
