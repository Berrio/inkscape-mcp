import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ServerConfig } from "../config/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";

export type ExportProbe = { available: boolean; reason?: string };

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
