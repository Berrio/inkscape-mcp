import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

import type { InkscapeCandidate } from "../discovery/index.js";
import type { ProcessExecutor } from "../discovery/probe.js";

import { parseActionList, parseHelpOptions, parseInputTypes } from "./parse.js";
import type { CapabilityObservation, InkscapeCapabilities } from "./types.js";

const CACHE_TTL_MS = 5 * 60_000;
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;

type CachedCapabilities = { expiresAt: number; value: InkscapeCapabilities };

export class CapabilityService {
  private readonly cache = new Map<string, CachedCapabilities>();

  public async inspect(
    runner: Pick<ProcessExecutor, "run">,
    candidate: InkscapeCandidate,
    version: string,
    cwd: string,
  ): Promise<InkscapeCapabilities> {
    const fingerprint = await capabilityFingerprint(
      candidate.executablePath,
      version,
    );
    const cached = this.cache.get(fingerprint);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const [helpAll, inputTypes, actionList] = await Promise.all([
      collect(runner, candidate.executablePath, ["--help-all"], cwd),
      collect(runner, candidate.executablePath, ["--list-input-types"], cwd),
      collect(runner, candidate.executablePath, ["--action-list"], cwd),
    ]);
    const value: InkscapeCapabilities = {
      actionCount: actionList.available
        ? parseActionList(actionList.output).length
        : 0,
      actions: actionList.available ? parseActionList(actionList.output) : [],
      fingerprint,
      helpOptions: helpAll.available ? parseHelpOptions(helpAll.output) : [],
      inputTypes: inputTypes.available
        ? parseInputTypes(inputTypes.output)
        : [],
      observations: {
        actionList: observation(actionList),
        helpAll: observation(helpAll),
        inputTypes: observation(inputTypes),
      },
      version,
    };
    this.cache.set(fingerprint, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    });
    return value;
  }

  public clear(): void {
    this.cache.clear();
  }
}

type CollectedCommand = CapabilityObservation & { output: string };

async function collect(
  runner: Pick<ProcessExecutor, "run">,
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<CollectedCommand> {
  try {
    const result = await runner.run(executable, {
      args,
      cwd,
      maxStderrBytes: 128 * 1024,
      maxStdoutBytes: OUTPUT_LIMIT_BYTES,
      timeoutMs: 30_000,
    });
    return {
      available:
        result.exitCode === 0 &&
        result.terminationReason === "completed" &&
        !result.stdoutTruncated &&
        !result.stderrTruncated,
      output: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    };
  } catch (error: unknown) {
    return {
      available: false,
      output: "",
      stderr:
        error instanceof Error ? error.message : "unknown execution error",
    };
  }
}

function observation(result: CollectedCommand): CapabilityObservation {
  return { available: result.available, stderr: result.stderr };
}

async function capabilityFingerprint(
  executablePath: string,
  version: string,
): Promise<string> {
  const metadata = await stat(executablePath);
  return createHash("sha256")
    .update(
      `${executablePath}\0${metadata.size}\0${metadata.mtimeMs}\0${version}`,
    )
    .digest("hex");
}
