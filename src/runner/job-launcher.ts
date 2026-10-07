/**
 * Windows process-tree containment helper, executed by `ProcessRunner` as
 * `node job-launcher.js -- <executable> [...args]` (or `--probe`).
 *
 * The launcher creates a Job Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
 * places itself in it and only then starts the target. Every descendant is
 * therefore a job member from its first instruction, including processes that
 * later detach from the parent/child tree. The job handle is owned solely by
 * this process: when the runner terminates the launcher, or the launcher exits
 * because its server disappeared, Windows closes the handle and kills the whole
 * job. The job does not allow breakaway.
 *
 * This file is standalone (Node built-ins plus `koffi`) so that it can run
 * from `dist/` and, during tests, directly from `src/` with type stripping.
 * It only uses erasable TypeScript syntax for that reason.
 */
import { spawn } from "node:child_process";

/** JOBOBJECTINFOCLASS.JobObjectExtendedLimitInformation */
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
/** sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) on 64-bit Windows. */
const EXTENDED_LIMIT_INFORMATION_BYTES = 144;
/** offsetof(JOBOBJECT_BASIC_LIMIT_INFORMATION, LimitFlags) on 64-bit. */
const LIMIT_FLAGS_OFFSET = 16;
/** Exit code reported when the job cannot be created before the target. */
const SETUP_FAILURE_EXIT_CODE = 70;
const PARENT_POLL_MS = 500;

type Koffi = {
  load: (library: string) => {
    func: (signature: string) => (...args: unknown[]) => unknown;
  };
};

async function enterKillOnCloseJob(): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("Job Objects are only available on Windows");
  if (process.arch !== "x64" && process.arch !== "arm64")
    throw new Error("Job Object layout is only defined for 64-bit Windows");
  const imported = (await import("koffi")) as unknown as {
    default?: Koffi;
  } & Koffi;
  const koffi = imported.default ?? imported;
  const kernel32 = koffi.load("kernel32.dll");
  const createJobObject = kernel32.func(
    "void * __stdcall CreateJobObjectW(void *attributes, void *name)",
  );
  const setInformationJobObject = kernel32.func(
    "int __stdcall SetInformationJobObject(void *job, int infoClass, void *info, uint32_t length)",
  );
  const assignProcessToJobObject = kernel32.func(
    "int __stdcall AssignProcessToJobObject(void *job, void *process)",
  );
  const getCurrentProcess = kernel32.func(
    "void * __stdcall GetCurrentProcess()",
  );

  const job = createJobObject(null, null);
  if (!job) throw new Error("CreateJobObjectW failed");
  const limits = Buffer.alloc(EXTENDED_LIMIT_INFORMATION_BYTES);
  limits.writeUInt32LE(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, LIMIT_FLAGS_OFFSET);
  if (
    !setInformationJobObject(
      job,
      JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
      limits,
      limits.byteLength,
    )
  )
    throw new Error("SetInformationJobObject failed");
  if (!assignProcessToJobObject(job, getCurrentProcess()))
    throw new Error("AssignProcessToJobObject failed");
  // The handle is deliberately never closed: process exit closes it, and the
  // kill-on-close limit then terminates every remaining job member.
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "--probe") {
    try {
      await enterKillOnCloseJob();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }
  if (argv[0] !== "--" || argv[1] === undefined) process.exit(2);
  const [executable, ...args] = argv.slice(1) as [string, ...string[]];
  try {
    await enterKillOnCloseJob();
  } catch {
    // Fail closed: never start the target without the containment the
    // runner selected after a successful probe.
    process.exit(SETUP_FAILURE_EXIT_CODE);
  }

  // `detached` keeps the target out of this launcher's libuv job, which
  // allows silent breakaway; the target therefore inherits only our job.
  const child = spawn(executable, args, {
    detached: true,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });
  child.once("error", () => process.exit(127));
  child.once("exit", (code) => process.exit(code ?? 1));

  // If the server dies without terminating us, exiting closes the job and
  // takes the whole native tree with it.
  const parentPid = process.ppid;
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(1);
    }
  }, PARENT_POLL_MS).unref();
}

await main(process.argv.slice(2));
