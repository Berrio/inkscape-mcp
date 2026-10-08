import type { ProcessRunRequest, ProcessRunResult } from "../runner/index.js";

import type {
  CandidateRejection,
  InkscapeCandidate,
  InkscapeProbe,
} from "./types.js";

export async function probeInkscapeCandidate(
  runner: Pick<ProcessExecutor, "run">,
  candidate: InkscapeCandidate,
  cwd: string,
): Promise<InkscapeProbe | CandidateRejection> {
  let result;

  try {
    result = await runner.run(candidate.executablePath, {
      args: [
        `--app-id-tag=${createAppIdTag(candidate.executablePath)}`,
        "--version",
      ],
      cwd,
      maxStderrBytes: 128 * 1024,
      maxStdoutBytes: 128 * 1024,
      timeoutMs: 10_000,
    });
  } catch (error: unknown) {
    return rejection(
      candidate,
      `Unable to execute --version: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");
  const rawVersion = `${stdout}\n${stderr}`.trim();
  const version = parseInkscapeVersion(rawVersion);

  if (result.exitCode !== 0) {
    return rejection(
      candidate,
      `--version exited with ${String(result.exitCode)}`,
    );
  }
  if (result.terminationReason !== "completed") {
    return rejection(
      candidate,
      `--version ended with ${result.terminationReason}`,
    );
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return rejection(
      candidate,
      "--version output exceeded the configured limit",
    );
  }
  if (!version) {
    return rejection(
      candidate,
      "--version output is not recognized as Inkscape",
    );
  }

  return { candidate, rawVersion, stderr, version };
}

export type ProcessExecutor = {
  run(
    executable: string,
    request: ProcessRunRequest,
  ): Promise<ProcessRunResult>;
};

export function parseInkscapeVersion(output: string): string | undefined {
  const match = output.match(
    /\bInkscape\s+([0-9]+(?:\.[0-9]+){1,3}(?:\s*\([^\r\n)]*\))?)/iu,
  );
  return match?.[1];
}

let appIdSequence = 0;

/**
 * A unique application ID per invocation keeps the probe out of a running
 * GUI session *and* away from concurrent probes. A tag shared by concurrent
 * Inkscape processes makes them contend for one GApplication/D-Bus name:
 * measured on 1.4.4 MSIX, 16 of 24 concurrent runs failed with "Failed to
 * register: GDBus.Error…" or crashed, versus 0 of 24 with unique tags.
 */
export function createAppIdTag(executablePath: string): string {
  const digest = [...executablePath]
    .reduce(
      (hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0,
      0,
    )
    .toString(36);
  appIdSequence = (appIdSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `inkscape-mcp-${digest}-${process.pid.toString(36)}-${appIdSequence.toString(36)}`;
}

function rejection(
  candidate: InkscapeCandidate,
  reason: string,
): CandidateRejection {
  return {
    executablePath: candidate.executablePath,
    reason,
    source: candidate.sources[0] ?? "standard",
  };
}
