import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ServerConfig } from "../config/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";
import { inspectDxf } from "../export/dxf.js";
import { inspectHpgl } from "../export/hpgl.js";
import { inspectGpl } from "../export/gpl.js";
import { inspectFxg } from "../export/fxg.js";
import { inspectSif } from "../export/sif.js";
import { inspectRasterImport } from "../import/raster-import.js";

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
  } catch {
    return {
      available: false,
      reason: "PNG output is missing or unreadable",
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
  } catch {
    return {
      available: false,
      reason: "DXF output is missing or unreadable",
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
  } catch {
    return {
      available: false,
      reason: "HPGL output is missing or unreadable",
    };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes the fixed GIMP Palette exporter without accepting an extension ID or options. */
export async function probeGplExport(
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
  const output = join(scratch, "probe.gpl");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#112233"/><rect x="1" width="1" height="1" fill="#aabbcc"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=gpl", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: "GPL export did not complete" };
    }
    inspectGpl(await readFile(output));
    return { available: true };
  } catch {
    return { available: false, reason: "GPL output is missing or unreadable" };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes the fixed FXG exporter without accepting an extension ID or options. */
export async function probeFxgExport(
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
  const output = join(scratch, "probe.fxg");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="3" fill="#112233"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=fxg", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: "FXG export did not complete" };
    }
    inspectFxg(await readFile(output));
    return { available: true };
  } catch {
    return { available: false, reason: "FXG output is missing or unreadable" };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes the fixed Synfig SIF exporter without accepting an extension ID or options. */
export async function probeSifExport(
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
  const output = join(scratch, "probe.sif");
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="3" fill="#112233"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, "--export-type=sif", `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: "SIF export did not complete" };
    }
    inspectSif(await readFile(output));
    return { available: true };
  } catch {
    return { available: false, reason: "SIF output is missing or unreadable" };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}

/** Probes only Inkscape's fixed WebP extension with a known small SVG. */
export async function probeWebpExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    | "maxRasterMegapixels"
    | "maxStderrBytes"
    | "maxStdoutBytes"
    | "processTimeoutMs"
    | "scratchRoot"
  >,
): Promise<ExportProbe> {
  return await probeRasterExtensionExport({
    config,
    executable,
    expectedMime: "image/webp",
    format: "webp",
    runner,
    title: "WebP",
  });
}

/** Probes only Inkscape's fixed JPEG extension with a known small SVG. */
export async function probeJpegExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    | "maxRasterMegapixels"
    | "maxStderrBytes"
    | "maxStdoutBytes"
    | "processTimeoutMs"
    | "scratchRoot"
  >,
): Promise<ExportProbe> {
  return await probeRasterExtensionExport({
    config,
    executable,
    expectedMime: "image/jpeg",
    format: "jpg",
    runner,
    title: "JPEG",
  });
}

/** Probes only Inkscape's fixed TIFF extension with a known small SVG. */
export async function probeTiffExport(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  config: Pick<
    ServerConfig,
    | "maxRasterMegapixels"
    | "maxStderrBytes"
    | "maxStdoutBytes"
    | "processTimeoutMs"
    | "scratchRoot"
  >,
): Promise<ExportProbe> {
  return await probeRasterExtensionExport({
    config,
    executable,
    expectedMime: "image/tiff",
    format: "tiff",
    runner,
    title: "TIFF",
  });
}

async function probeRasterExtensionExport(request: {
  config: Pick<
    ServerConfig,
    | "maxRasterMegapixels"
    | "maxStderrBytes"
    | "maxStdoutBytes"
    | "processTimeoutMs"
    | "scratchRoot"
  >;
  executable: string;
  expectedMime: "image/jpeg" | "image/tiff" | "image/webp";
  format: "jpg" | "tiff" | "webp";
  runner: Pick<ProcessExecutor, "run">;
  title: "JPEG" | "TIFF" | "WebP";
}): Promise<ExportProbe> {
  const { config, executable, expectedMime, format, runner, title } = request;
  const root =
    config.scratchRoot === "auto" ? tmpdir() : resolve(config.scratchRoot);
  const scratch = await mkdtemp(join(root, "inkscape-mcp-probe-"));
  const input = join(scratch, "probe.svg");
  const output = join(scratch, `probe.${format}`);
  try {
    await writeFile(
      input,
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#000"/></svg>',
      "utf8",
    );
    const result = await runner.run(executable, {
      args: [input, `--export-type=${format}`, `--export-filename=${output}`],
      cwd: scratch,
      maxStderrBytes: config.maxStderrBytes,
      maxStdoutBytes: config.maxStdoutBytes,
      timeoutMs: config.processTimeoutMs,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      return { available: false, reason: `${title} export did not complete` };
    }
    const raster = inspectRasterImport(
      await readFile(output),
      config.maxRasterMegapixels,
    );
    return raster.mime === expectedMime &&
      raster.width === 4 &&
      raster.height === 3
      ? { available: true }
      : {
          available: false,
          reason: `output is not the expected ${title} image`,
        };
  } catch {
    return {
      available: false,
      reason: `${title} output is missing or unreadable`,
    };
  } finally {
    await rm(scratch, { force: true, recursive: true });
  }
}
