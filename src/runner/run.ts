import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { ProcessAbortedError, ProcessSpawnError } from "./errors.js";
import { AsyncSemaphore } from "./semaphore.js";

/** Bound on waiting for stdio to close once a process tree was terminated. */
const POST_TERMINATION_CLOSE_TIMEOUT_MS = 5_000;

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

/**
 * How the runner contains a native process tree:
 * - `job-object`: Windows Job Object with kill-on-close, joined before the
 *   target starts, so detached descendants die with the tree;
 * - `process-tree`: `taskkill /T` on Windows or the process group on POSIX.
 */
export type ProcessContainment = "job-object" | "process-tree";
export type ProcessRunnerOptions = {
  /** `auto` uses a Job Object on Windows when the probe succeeds. */
  containment?: "auto" | "process-tree" | undefined;
};
type JobLauncher = { nodeArgs: readonly string[]; script: string };

export class ProcessRunner {
  public readonly tracker = new ProcessTracker();

  private readonly semaphore: AsyncSemaphore;
  private readonly containmentMode: "auto" | "process-tree";

  public constructor(
    maxConcurrency: number,
    options: ProcessRunnerOptions = {},
  ) {
    this.semaphore = new AsyncSemaphore(maxConcurrency);
    this.containmentMode = options.containment ?? "auto";
  }

  /** Reports the containment that runs will actually use. */
  public async processContainment(): Promise<ProcessContainment> {
    return (await this.jobLauncher()) === undefined
      ? "process-tree"
      : "job-object";
  }

  private jobLauncher(): Promise<JobLauncher | undefined> {
    if (this.containmentMode !== "auto" || process.platform !== "win32")
      return Promise.resolve(undefined);
    // Job support is a property of the host, shared by every runner.
    hostJobLauncher ??= probeJobLauncher();
    return hostJobLauncher;
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
      const launcher = await this.jobLauncher();
      if (request.signal?.aborted) {
        throw new ProcessAbortedError(
          "Process execution was aborted before spawn",
        );
      }
      // Only an existing absolute executable goes through the launcher, so a
      // missing binary still surfaces as a spawn error, exactly as before.
      const contained =
        launcher !== undefined &&
        win32.isAbsolute(executable) &&
        existsSync(executable);
      return await runChildProcess(
        contained ? process.execPath : executable,
        contained
          ? {
              ...request,
              args: [
                ...launcher.nodeArgs,
                launcher.script,
                "--",
                executable,
                ...request.args,
              ],
            }
          : request,
        this.tracker,
        contained,
      );
    } finally {
      release();
    }
  }
}

const JOB_LAUNCHER_PROBE_TIMEOUT_MS = 15_000;
let hostJobLauncher: Promise<JobLauncher | undefined> | undefined;

/** Locates the launcher next to this module: `.js` in `dist/`, `.ts` when
 * the runner itself is executed from sources by the test suite. */
function resolveJobLauncher(): JobLauncher | undefined {
  const compiled = fileURLToPath(new URL("./job-launcher.js", import.meta.url));
  if (existsSync(compiled)) return { nodeArgs: [], script: compiled };
  const source = fileURLToPath(new URL("./job-launcher.ts", import.meta.url));
  if (existsSync(source))
    return {
      nodeArgs: ["--disable-warning=ExperimentalWarning"],
      script: source,
    };
  return undefined;
}

/** Proves once that this host can create and join a kill-on-close job. */
async function probeJobLauncher(): Promise<JobLauncher | undefined> {
  const launcher = resolveJobLauncher();
  if (launcher === undefined) return undefined;
  const succeeded = await new Promise<boolean>((resolveProbe) => {
    const probe = spawn(
      process.execPath,
      [...launcher.nodeArgs, launcher.script, "--probe"],
      {
        env: buildMinimalEnvironment(),
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    const timer = setTimeout(() => {
      probe.kill();
      resolveProbe(false);
    }, JOB_LAUNCHER_PROBE_TIMEOUT_MS);
    timer.unref();
    probe.once("error", () => {
      clearTimeout(timer);
      resolveProbe(false);
    });
    probe.once("exit", (code) => {
      clearTimeout(timer);
      resolveProbe(code === 0);
    });
  });
  return succeeded ? launcher : undefined;
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
  viaJobLauncher = false,
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
        // POSIX: a dedicated process group lets termination reach grandchildren.
        // Windows launcher: keeps it out of libuv's job, whose silent
        // breakaway would let the native tree escape the launcher's job.
        detached: process.platform !== "win32" || viaJobLauncher,
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
      // libuv reports the failure asynchronously; without a listener the
      // `error` event would become an uncaught exception.
      child.once("error", (error) =>
        reject(new ProcessSpawnError("Unable to spawn process", error.message)),
      );
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
      // A descendant that escaped termination can keep the stdio pipes open,
      // so `close` would never fire. Bound the wait and release the slot.
      void terminationPromise
        .catch(() => undefined)
        .then(() => {
          const deadline = setTimeout(() => {
            if (settled) return;
            child.stdout?.destroy();
            child.stderr?.destroy();
            void finish(child.exitCode, child.signalCode);
          }, POST_TERMINATION_CLOSE_TIMEOUT_MS);
          deadline.unref();
        });
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
    try {
      await runTaskkill(pid);
    } catch (error) {
      // taskkill reports an error when descendants vanish while it walks the
      // tree (for example when a Job Object closes first). Only a surviving
      // root process means the termination actually failed.
      if (isProcessAlive(pid)) throw error;
    }
    return;
  }

  signalProcessGroup(child, pid, "SIGTERM");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 250);
  });
  // Always escalate for the whole group: the leader may have exited while a
  // grandchild still ignores SIGTERM.
  signalProcessGroup(child, pid, "SIGKILL");
}

function signalProcessGroup(
  child: ChildProcess,
  pid: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Resolves taskkill from the system directory, never from CWD or PATH. */
export function systemTaskkillPath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const systemRoot = environment.SystemRoot ?? environment.windir;
  return win32.join(
    systemRoot && win32.isAbsolute(systemRoot) ? systemRoot : "C:\\Windows",
    "System32",
    "taskkill.exe",
  );
}

/** taskkill exit code when the target PID no longer exists. */
const TASKKILL_PROCESS_NOT_FOUND = 128;

function runTaskkill(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const taskkill = spawn(
      systemTaskkillPath(),
      ["/pid", String(pid), "/t", "/f"],
      {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );

    taskkill.once("error", (error) => reject(error));
    taskkill.once("close", (code) => {
      if (code === 0 || code === TASKKILL_PROCESS_NOT_FOUND) resolve();
      else reject(new Error(`taskkill failed with exit code ${String(code)}`));
    });
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
