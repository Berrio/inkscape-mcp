import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appPathsCandidates,
  assessInkscapeVersion,
  locateInkscape,
  msixInstallLocationCandidates,
  parseInkscapeVersion,
  parseMsixCandidates,
  parseRegistryCandidates,
  pathCandidates,
  probeInkscapeCandidate,
  standardCandidates,
} from "../../src/discovery/index.js";
import { ProcessRunner } from "../../src/runner/index.js";

const fakeInkscape = resolve(
  process.cwd(),
  "tests",
  "fakes",
  "fake-inkscape.mjs",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inkscape-mcp-discovery-"));
  temporaryDirectories.push(path);
  return path;
}

describe("Inkscape discovery", () => {
  it("parses known Inkscape version output", () => {
    expect(parseInkscapeVersion("Inkscape 1.4.4 (dcaf3e7, 2026-05-05)")).toBe(
      "1.4.4 (dcaf3e7, 2026-05-05)",
    );
    expect(parseInkscapeVersion("not inkscape")).toBeUndefined();
  });

  it("only treats the evidenced Windows 1.4.4 baseline as stable", () => {
    expect(
      assessInkscapeVersion("1.4.4 (dcaf3e7, 2026-05-05)", "win32"),
    ).toEqual({ pageAdapter: "pages_v14", status: "stable", warnings: [] });
    expect(assessInkscapeVersion("1.4.5", "win32")).toEqual({
      status: "experimental",
      warnings: ["INKSCAPE_1_4_PATCH_UNVERIFIED"],
    });
    expect(assessInkscapeVersion("1.5.0", "win32")).toEqual({
      status: "experimental",
      warnings: ["INKSCAPE_1_5_EXPERIMENTAL", "PAGES_V15_NOT_IMPLEMENTED"],
    });
    expect(assessInkscapeVersion("1.4.4", "linux")).toEqual({
      status: "experimental",
      warnings: ["INKSCAPE_PLATFORM_UNVERIFIED"],
    });
  });

  it("builds cross-platform PATH and standard candidates without hardcoding a package version", () => {
    expect(pathCandidates({ Path: "C:/one;C:/two" }, "win32")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executablePath: "C:\\one\\inkscape.exe",
          source: "path",
        }),
        expect.objectContaining({
          executablePath: "C:\\two\\inkscape.com",
          source: "path",
        }),
      ]),
    );
    expect(standardCandidates({}, "darwin")).toContainEqual(
      expect.objectContaining({
        executablePath: "/Applications/Inkscape.app/Contents/MacOS/inkscape",
      }),
    );
  });

  it("parses App Paths and uninstall registry output", () => {
    const output = [
      "(Default)    REG_SZ    C:\\Program Files\\Inkscape\\bin\\inkscape.exe",
      "InstallLocation    REG_SZ    C:\\Program Files\\Inkscape",
      'DisplayIcon    REG_SZ    "C:\\Program Files\\Inkscape\\bin\\inkscape.exe",0',
    ].join("\r\n");

    expect(appPathsCandidates(output)).toContainEqual(
      expect.objectContaining({
        executablePath: "C:\\Program Files\\Inkscape\\bin\\inkscape.exe",
      }),
    );
    expect(parseRegistryCandidates(output)).toContainEqual(
      expect.objectContaining({
        executablePath: "C:\\Program Files\\Inkscape\\bin\\inkscape.exe",
      }),
    );
    expect(
      parseRegistryCandidates(
        "DisplayIcon    REG_SZ    C:\\Program Files\\Docker\\Docker.exe",
      ),
    ).toEqual([]);
  });

  it("derives the MSIX executable only from the install location", () => {
    const installLocation =
      "C:\\Program Files\\WindowsApps\\25415Inkscape.Inkscape_1.4.40.0_x64__9waqn51p1ttv2";
    const candidates = msixInstallLocationCandidates(installLocation);

    expect(candidates).toContainEqual(
      expect.objectContaining({
        executablePath:
          "C:\\Program Files\\WindowsApps\\25415Inkscape.Inkscape_1.4.40.0_x64__9waqn51p1ttv2\\VFS\\ProgramFilesX64\\Inkscape\\bin\\inkscape.exe",
        installKind: "msix",
      }),
    );
    expect(
      parseMsixCandidates(
        JSON.stringify({
          Name: "25415Inkscape.Inkscape",
          InstallLocation: installLocation,
        }),
      ),
    ).toEqual(candidates);
  });

  it("filters missing candidates and probes a validated executable", async () => {
    const cwd = await temporaryDirectory();
    const executable = join(cwd, "inkscape.exe");
    await writeFile(executable, "placeholder", "utf8");
    const runner = new ProcessRunner(1);
    const report = await locateInkscape({
      config: { inkscapeBin: executable },
      cwd,
      env: { Path: "" },
      runner,
    });

    expect(report.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ executablePath: executable }),
      ]),
    );
    expect(report.rejections).not.toContainEqual(
      expect.objectContaining({ source: "path" }),
    );
    const probe = await probeInkscapeCandidate(
      runner,
      {
        executablePath: process.execPath,
        installKind: "path",
        sources: ["configured"],
      },
      cwd,
    );
    expect(probe).toMatchObject({
      reason: expect.stringContaining("--version exited with"),
    });
    const validProbe = await probeInkscapeCandidate(
      {
        run: async () => ({
          durationMs: 1,
          exitCode: 0,
          pid: 1,
          signal: null,
          stderr: Buffer.alloc(0),
          stderrTruncated: false,
          stdout: Buffer.from("Inkscape 1.4.4 (dcaf3e7, 2026-05-05)\n"),
          stdoutTruncated: false,
          terminationReason: "completed" as const,
        }),
      },
      {
        executablePath: "C:/fake/inkscape.exe",
        installKind: "path",
        sources: ["configured"],
      },
      cwd,
    );

    expect(validProbe).toMatchObject({
      version: "1.4.4 (dcaf3e7, 2026-05-05)",
    });
    expect(fakeInkscape).toContain("fake-inkscape.mjs");
  });
});
