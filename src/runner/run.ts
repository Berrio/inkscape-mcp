import { spawn, type ChildProcess } from "node:child_process";

import { ProcessAbortedError, ProcessSpawnError } from "./errors.js";
import { AsyncSemaphore } from "./semaphore.js";

export type ProcessTerminationReason =
  "completed" | "aborted" | "output-limit" | "timeout";

export type ProcessRunRequest = {
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  maxStderrBytes: number;
  maxStdoutBytes: number;
  signal?: AbortSignal;
  timeoutMs: number;
};

export type ProcessRunResult = {
  durationMs: number;
  exitCode: number | null;
  pid: number;
  signal: NodeJS.Signals | null;
  stderr: Buffer;
  stderrTruncated: boolean;
  stdout: Buffer;
  stdoutTruncated: boolean;
  terminationReason: ProcessTerminationReason;
};

export class ProcessTracker {
  private readonly pids = new Set<number>();

  public add(pid: number): void {
    this.pids.add(pid);
  }

  public delete(pid: number): void {
    this.pids.delete(pid);
  }

  public snapshot(): readonly number[] {
    return [...this.pids].sort((left, right) => left - right);
  }
}

export class ProcessRunner {
  public readonly tracker = new ProcessTracker();

  private readonly semaphore: AsyncSemaphore;

  public constructor(maxConcurrency: number) {
    this.semaphore = new AsyncSemaphore(maxConcurrency);
  }

  public get activeCount(): number {
    return this.semaphore.activeCount;
  }

  public get waitingCount(): number {
    return this.semaphore.waitingCount;
  }

  public async run(
    executable: string,
    request: ProcessRunRequest,
  ): Promise<ProcessRunResult> {
    assertRunRequest(request);
    const release = await this.semaphore.acquire(request.signal);

    try {
      if (request.signal?.aborted) {
        throw new ProcessAbortedError(
          "Process execution was aborted before spawn",
        );
      }
      return await runChildProcess(executable, request, this.tracker);
    } finally {
      release();
    }
  }
}

export function buildMinimalEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const inheritedKeys =
    process.platform === "win32"
      ? ["ComSpec", "Path", "SystemRoot", "TEMP", "TMP", "USERPROFILE"]
      : ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"];
  const environment: NodeJS.ProcessEnv = {};

  for (const key of inheritedKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

function assertRunRequest(request: ProcessRunRequest): void {
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1) {
    throw new Error("Process timeout must be a positive integer");
  }
  if (!Number.isInteger(request.maxStdoutBytes) || request.maxStdoutBytes < 1) {
    throw new Error("maxStdoutBytes must be a positive integer");
  }
  if (!Number.isInteger(request.maxStderrBytes) || request.maxStderrBytes < 1) {
    throw new Error("maxStderrBytes must be a positive integer");
  }
}

function runChildProcess(
  executable: string,
  request: ProcessRunRequest,
  tracker: ProcessTracker,
): Promise<ProcessRunResult> {
  return new Promise<ProcessRunResult>((resolve, reject) => {
    const startedAt = performance.now();
    const stdout = new OutputCollector(request.maxStdoutBytes);
    const stderr = new OutputCollector(request.maxStderrBytes);
    let child: ChildProcess;
    let settled = false;
    let terminationReason: ProcessTerminationReason = "completed";
    let terminationPromise: Promise<void> | undefined;

    try {
      child = spawn(executable, [...request.args], {
        cwd: request.cwd,
        env: buildMinimalEnvironment(request.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error: unknown) {
      reject(
        new ProcessSpawnError(
          "Unable to spawn process",
          error instanceof Error ? error.message : "unknown spawn error",
        ),
      );
      return;
    }

    if (child.pid === undefined) {
      reject(new ProcessSpawnError("Spawned process has no PID"));
      return;
    }

    tracker.add(child.pid);
    const pid = child.pid;
    const timeout = setTimeout(() => terminate("timeout"), request.timeoutMs);
    const onAbort = () => terminate("aborted");
    request.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.append(chunk)) {
        terminate("output-limit");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.append(chunk)) {
        terminate("output-limit");
      }
    });
    child.once("error", (error) => {
      finishError(
        new ProcessSpawnError("Process emitted a spawn error", error.message),
      );
    });
    child.once("close", (exitCode, signal) => {
      void finish(exitCode, signal);
    });

    function terminate(
      reason: Exclude<ProcessTerminationReason, "completed">,
    ): void {
      if (settled || terminationPromise !== undefined) {
        return;
      }
      terminationReason = reason;
      terminationPromise = terminateProcessTree(child, pid);
    }

    async function finish(
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): Promise<void> {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
      tracker.delete(pid);

      try {
        await terminationPromise;
        resolve({
          durationMs: Math.round(performance.now() - startedAt),
          exitCode,
          pid,
          signal,
          stderr: stderr.toBuffer(),
          stderrTruncated: stderr.truncated,
          stdout: stdout.toBuffer(),
          stdoutTruncated: stdout.truncated,
          terminationReason,
        });
      } catch (error: unknown) {
        reject(
          new ProcessSpawnError(
            "Unable to terminate process tree",
            error instanceof Error
              ? error.message
              : "unknown termination error",
          ),
        );
      }
    }

    function finishError(error: ProcessSpawnError): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
      tracker.delete(pid);
      reject(error);
    }
  });
}

async function terminateProcessTree(
  child: ChildProcess,
  pid: number,
): Promise<void> {
  if (process.platform === "win32") {
    await runTaskkill(pid);
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 250);
  });
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const taskkill = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });

    taskkill.once("error", (error) => reject(error));
    taskkill.once("close", () => resolve());
  });
}

class OutputCollector {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  public truncated = false;

  public constructor(private readonly maximumBytes: number) {}

  public append(chunk: Buffer): boolean {
    if (this.truncated) {
      return false;
    }

    const remaining = this.maximumBytes - this.size;
    if (chunk.byteLength <= remaining) {
      this.chunks.push(chunk);
      this.size += chunk.byteLength;
      return false;
    }

    if (remaining > 0) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.size += remaining;
    }
    this.truncated = true;
    return true;
  }

  public toBuffer(): Buffer {
    return Buffer.concat(this.chunks, this.size);
  }
}
