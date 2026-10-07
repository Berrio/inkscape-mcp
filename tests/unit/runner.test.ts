import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMinimalEnvironment,
  ProcessRunner,
} from "../../src/runner/index.js";
import { systemTaskkillPath } from "../../src/runner/run.js";

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

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number((await readFile(path, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch {
      // The fake is still creating its PID evidence.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for fake descendant PID evidence");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls instead of sampling once: Windows finishes tearing down a killed
 * tree asynchronously, and a loaded machine can take longer than 100 ms. */
async function expectProcessesGone(pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && pids.some(isAlive))
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
}

function request(cwd: string, argumentsList: readonly string[]) {
  return {
    args: [fakeInkscape, ...argumentsList],
    cwd,
    maxStderrBytes: 1024,
    maxStdoutBytes: 1024,
    timeoutMs: 5_000,
  };
}

describe("ProcessRunner", () => {
  it("runs direct argv without a shell and captures valid output", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const outputPath = join(cwd, "salida ü; &.txt");
    const runner = new ProcessRunner(1);

    const result = await runner.run(
      process.execPath,
      request(cwd, ["success", "--output", outputPath]),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      stderrTruncated: false,
      stdoutTruncated: false,
      terminationReason: "completed",
    });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("fake output");
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("preserves nonzero exit codes and stderr", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);

    const result = await runner.run(process.execPath, request(cwd, ["error"]));

    expect(result.exitCode).toBe(17);
    expect(result.stderr.toString("utf8")).toContain("intentional failure");
    expect(result.terminationReason).toBe("completed");
  });

  it("allows fakes to model a partial artifact for later verifier tests", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const outputPath = join(cwd, "partial.txt");
    const runner = new ProcessRunner(1);

    const result = await runner.run(
      process.execPath,
      request(cwd, ["partial", "--output", outputPath]),
    );

    expect(result.exitCode).toBe(0);
    await expect(readFile(outputPath, "utf8")).resolves.toBe("partial output");
  });

  it("bounds stdout and terminates output floods", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);

    const result = await runner.run(process.execPath, {
      ...request(cwd, ["large-stdout"]),
      maxStdoutBytes: 256,
    });

    expect(result.terminationReason).toBe("output-limit");
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.byteLength).toBe(256);
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("bounds stderr and terminates output floods", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);

    const result = await runner.run(process.execPath, {
      ...request(cwd, ["large-stderr"]),
      maxStderrBytes: 256,
    });

    expect(result.terminationReason).toBe("output-limit");
    expect(result.stderrTruncated).toBe(true);
    expect(result.stderr.byteLength).toBe(256);
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("honors timeout and frees the global concurrency slot", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);

    const result = await runner.run(process.execPath, {
      ...request(cwd, ["timeout"]),
      timeoutMs: 100,
    });

    expect(result.terminationReason).toBe("timeout");
    expect(runner.activeCount).toBe(0);
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("queues work behind the configured global semaphore", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);
    const first = runner.run(process.execPath, {
      ...request(cwd, ["timeout"]),
      timeoutMs: 120,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const second = runner.run(process.execPath, request(cwd, ["success"]));

    expect(runner.activeCount).toBe(1);
    expect(runner.waitingCount).toBe(1);
    await expect(first).resolves.toMatchObject({
      terminationReason: "timeout",
    });
    await expect(second).resolves.toMatchObject({ exitCode: 0 });
    expect(runner.activeCount).toBe(0);
  });

  it("honors AbortSignal while a process is running", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const controller = new AbortController();
    const runner = new ProcessRunner(1);
    const execution = runner.run(process.execPath, {
      ...request(cwd, ["timeout"]),
      signal: controller.signal,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    controller.abort();

    await expect(execution).resolves.toMatchObject({
      terminationReason: "aborted",
    });
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("escalates termination when the process ignores the initial signal", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const runner = new ProcessRunner(1);

    const result = await runner.run(process.execPath, {
      ...request(cwd, ["ignore-termination"]),
      timeoutMs: 100,
    });

    expect(result.terminationReason).toBe("timeout");
    expect(runner.tracker.snapshot()).toEqual([]);
  });

  it("uses a minimal environment and allows explicit overrides", () => {
    const environment = buildMinimalEnvironment({
      MCP_TEST_VALUE: "visible",
      SECRET: undefined,
    });

    expect(environment.MCP_TEST_VALUE).toBe("visible");
    expect(environment.SECRET).toBeUndefined();
    expect(environment.Path ?? environment.PATH).toBeDefined();
  });

  it.runIf(process.platform === "win32")(
    "terminates child and grandchild trees on Windows timeout",
    async () => {
      const cwd = await temporaryDirectory("inkscape-mcp-runner-");
      const childPidPath = join(cwd, "child.pid");
      const grandchildPidPath = join(cwd, "grandchild.pid");
      const runner = new ProcessRunner(1);

      const result = await runner.run(process.execPath, {
        ...request(cwd, [
          "tree",
          "--child-pid",
          childPidPath,
          "--grandchild-pid",
          grandchildPidPath,
        ]),
        // Long enough for launcher→child→grandchild to start on a loaded
        // machine; a shorter timeout can kill the tree before it records PIDs.
        timeoutMs: 3_000,
      });
      const childPid = await waitForPid(childPidPath);
      const grandchildPid = await waitForPid(grandchildPidPath);

      expect(result.terminationReason).toBe("timeout");
      await expectProcessesGone([childPid, grandchildPid]);
    },
    20_000,
  );

  it("resolves taskkill from the system directory, never from PATH or CWD", () => {
    expect(systemTaskkillPath({ SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\taskkill.exe",
    );
    expect(systemTaskkillPath({ SystemRoot: "relative\\dir" })).toBe(
      "C:\\Windows\\System32\\taskkill.exe",
    );
    expect(systemTaskkillPath({})).toBe("C:\\Windows\\System32\\taskkill.exe");
  });

  it.runIf(process.platform === "win32")(
    "kills a descendant that left the process tree through the Job Object",
    async (context) => {
      const runner = new ProcessRunner(1);
      if ((await runner.processContainment()) !== "job-object") {
        context.skip();
        return;
      }
      const cwd = await temporaryDirectory("inkscape-mcp-runner-");
      const orphanPidPath = join(cwd, "orphan.pid");
      const startedAt = Date.now();
      const result = await runner.run(process.execPath, {
        ...request(cwd, ["orphan-pipe", "--orphan-pid", orphanPidPath]),
        timeoutMs: 10_000,
      });
      const orphanPid = await waitForPid(orphanPidPath);
      // The direct child exits at once; the launcher follows, the job closes
      // and the detached orphan dies with it, so stdio closes immediately
      // instead of waiting for the orphan or for any timeout.
      expect(result.terminationReason).toBe("completed");
      expect(result.exitCode).toBe(0);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      await expectProcessesGone([orphanPid]);
    },
    30_000,
  );

  it.runIf(process.platform === "win32")(
    "kills the native tree when the server process dies abruptly",
    async (context) => {
      if ((await new ProcessRunner(1).processContainment()) !== "job-object") {
        context.skip();
        return;
      }
      const cwd = await temporaryDirectory("inkscape-mcp-runner-");
      const childPidPath = join(cwd, "host-child.pid");
      const grandchildPidPath = join(cwd, "host-grandchild.pid");
      const host = spawn(
        process.execPath,
        [
          resolve(process.cwd(), "tests", "fakes", "runner-host.mjs"),
          cwd,
          childPidPath,
          grandchildPidPath,
        ],
        { stdio: ["ignore", "pipe", "inherit"], windowsHide: true },
      );
      const containment = await new Promise<string>((resolveLine) =>
        host.stdout.once("data", (chunk: Buffer) =>
          resolveLine(chunk.toString("utf8").trim()),
        ),
      );
      expect(containment).toBe("job-object");
      const childPid = await waitForPid(childPidPath);
      const grandchildPid = await waitForPid(grandchildPidPath);
      host.kill("SIGKILL");
      // The launcher polls its parent every 500 ms, then exits and the job
      // closes; allow a bounded margin before checking.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
      await expectProcessesGone([childPid, grandchildPid]);
    },
    30_000,
  );

  it("keeps the previous process-tree behavior when containment is disabled", async () => {
    const runner = new ProcessRunner(1, { containment: "process-tree" });
    await expect(runner.processContainment()).resolves.toBe("process-tree");
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const result = await runner.run(
      process.execPath,
      request(cwd, ["echo", "--value", "plain"]),
    );
    expect(result.stdout.toString("utf8").trim()).toBe("plain");
  });

  it("still reports a missing executable as a spawn error", async () => {
    const runner = new ProcessRunner(1);
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    await expect(
      runner.run(join(cwd, "missing-inkscape.exe"), request(cwd, [])),
    ).rejects.toMatchObject({ name: "ProcessSpawnError" });
  });

  it("releases a run whose escaped descendant keeps stdio open", async () => {
    const cwd = await temporaryDirectory("inkscape-mcp-runner-");
    const orphanPidPath = join(cwd, "orphan.pid");
    // Exercise the fallback path: without a job the orphan survives and only
    // the post-termination deadline can release the run.
    const runner = new ProcessRunner(1, { containment: "process-tree" });
    let orphanPid: number | undefined;
    try {
      const startedAt = Date.now();
      const result = await runner.run(process.execPath, {
        ...request(cwd, ["orphan-pipe", "--orphan-pid", orphanPidPath]),
        timeoutMs: 300,
      });
      orphanPid = await waitForPid(orphanPidPath);
      expect(result.terminationReason).toBe("timeout");
      expect(Date.now() - startedAt).toBeLessThan(15_000);
      expect(runner.activeCount).toBe(0);
    } finally {
      orphanPid ??= await waitForPid(orphanPidPath).catch(() => undefined);
      if (orphanPid !== undefined) {
        try {
          process.kill(orphanPid);
        } catch {
          // Already gone.
        }
        await expectProcessesGone([orphanPid]);
      }
    }
  }, 30_000);

  it.runIf(process.platform !== "win32")(
    "terminates the whole POSIX process group on timeout",
    async () => {
      const cwd = await temporaryDirectory("inkscape-mcp-runner-");
      const childPidPath = join(cwd, "child.pid");
      const grandchildPidPath = join(cwd, "grandchild.pid");
      const runner = new ProcessRunner(1);
      const result = await runner.run(process.execPath, {
        ...request(cwd, [
          "tree",
          "--child-pid",
          childPidPath,
          "--grandchild-pid",
          grandchildPidPath,
        ]),
        timeoutMs: 500,
      });
      expect(result.terminationReason).toBe("timeout");
      await expectProcessesGone([
        await waitForPid(childPidPath),
        await waitForPid(grandchildPidPath),
      ]);
    },
  );

  it.runIf(process.platform === "win32")(
    "terminates child and grandchild trees on Windows abort",
    async () => {
      const cwd = await temporaryDirectory("inkscape-mcp-runner-");
      const childPidPath = join(cwd, "abort-child.pid");
      const grandchildPidPath = join(cwd, "abort-grandchild.pid");
      const controller = new AbortController();
      const runner = new ProcessRunner(1);
      const execution = runner.run(process.execPath, {
        ...request(cwd, [
          "tree",
          "--child-pid",
          childPidPath,
          "--grandchild-pid",
          grandchildPidPath,
        ]),
        signal: controller.signal,
      });
      const childPid = await waitForPid(childPidPath);
      const grandchildPid = await waitForPid(grandchildPidPath);

      controller.abort();

      await expect(execution).resolves.toMatchObject({
        terminationReason: "aborted",
      });
      await expectProcessesGone([childPid, grandchildPid]);
    },
  );
});
