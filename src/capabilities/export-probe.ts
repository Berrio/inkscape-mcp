import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ServerConfig } from "../config/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";
import { inspectDxf } from "../export/dxf.js";
import { inspectHpgl } from "../export/hpgl.js";

export type ExportProbe = { available: boolean; reason?: string };

/**
 * Checks the small, structural subset that makes a DXF result usable as an
 * ASCII interchange file. DXF permits a leading 999 comment, so it must not
 * be mistaken for a failed export merely because SECTION is not the first
 * group pair.
 */
export function isAsciiDxf(bytes: Buffer): boolean {
  try {
    inspectDxf(bytes);
    return true;
  } catch {
    return false;
  }
}

/** HPGL is an ASCII command stream; require initialization and a pen command. */
export function isAsciiHpgl(bytes: Buffer): boolean {
  try {
    inspectHpgl(bytes);
    return true;
  } catch {
    return false;
  }
}

export async function probePngExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    "maxStderrBytes" | "maxStdoutBytes" | "processTimeoutMs" | "scratchRoot"
  >,
): Promise<ExportProbe> {
  const root =
    config.scratchRoot === "auto" ? tmpdir() : resolve(config.scratchRoot);
  const scratch = await mkdtemp(join(root, "inkscape-mcp-probe-"));
  const input = join(scratch, "probe.svg");
  const output = join(scratch, "probe.png");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#000"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=png", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return {
        available: false,
        reason: `export exited with ${String(result.exitCode ?? result.terminationReason)}`,
      };
    }
    const png = await readFile(output);
    return png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? { available: true }
      : { available: false, reason: "output is not a PNG" };
  } catch (error: unknown) {
    return {
      available: false,
      reason:
        error instanceof Error ? error.message : "unknown export probe error",
    };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes the fixed built-in DXF exporter without accepting extension IDs or argv. */
export async function probeDxfExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    "maxStderrBytes" | "maxStdoutBytes" | "processTimeoutMs" | "scratchRoot"
  >,
): Promise<ExportProbe> {
  const root =
    config.scratchRoot === "auto" ? tmpdir() : resolve(config.scratchRoot);
  const scratch = await mkdtemp(join(root, "inkscape-mcp-probe-"));
  const input = join(scratch, "probe.svg");
  const output = join(scratch, "probe.dxf");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=dxf", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: "DXF export did not complete" };
    }
    const dxf = await readFile(output);
    return isAsciiDxf(dxf)
      ? { available: true }
      : { available: false, reason: "output is not ASCII DXF" };
  } catch (error: unknown) {
    return {
      available: false,
      reason:
        error instanceof Error
          ? error.message
          : "unknown DXF export probe error",
    };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes only the fixed HPGL extension selected by Inkscape's output type. */
export async function probeHpglExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    "maxStderrBytes" | "maxStdoutBytes" | "processTimeoutMs" | "scratchRoot"
  >,
): Promise<ExportProbe> {
  const root =
    config.scratchRoot === "auto" ? tmpdir() : resolve(config.scratchRoot);
  const scratch = await mkdtemp(join(root, "inkscape-mcp-probe-"));
  const input = join(scratch, "probe.svg");
  const output = join(scratch, "probe.hpgl");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=hpgl", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: "HPGL export did not complete" };
    }
    const hpgl = await readFile(output);
    return isAsciiHpgl(hpgl)
      ? { available: true }
      : { available: false, reason: "output is not bounded ASCII HPGL" };
  } catch (error: unknown) {
    return {
      available: false,
      reason:
        error instanceof Error
          ? error.message
          : "unknown HPGL export probe error",
    };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}
