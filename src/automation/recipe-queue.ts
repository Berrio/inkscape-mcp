import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { ServerConfig } from "../config/index.js";
import {
  AutonomousRecipeError,
  parseAutonomousRecipe,
  type AutonomousRecipe,
} from "./recipe-command.js";
import { WorkspaceService } from "../workspace/index.js";

const jobIdSchema = z.string().regex(/^recipe_job_[a-f0-9]{32}$/u);
const jobStatusSchema = z.enum([
  "cancelled",
  "completed",
  "failed",
  "queued",
  "running",
]);
const storedJobSchema = z
  .object({
    attempt: z.number().int().min(0).max(100),
    cancellationRequestedAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    error: z.string().max(4_096).optional(),
    id: jobIdSchema,
    recipe: z.unknown(),
    receipt: z.unknown().optional(),
    startedAt: z.string().datetime().optional(),
    status: jobStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

export type DurableRecipeStatus = z.output<typeof jobStatusSchema>;
export type DurableRecipeJob = {
  attempt: number;
  cancellationRequestedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  recipe: AutonomousRecipe;
  receipt?: unknown;
  startedAt?: string;
  status: DurableRecipeStatus;
  updatedAt: string;
};

/** Compact metadata for inspecting a durable queue without exposing recipe bodies. */
export type DurableRecipeJobSummary = {
  attempt: number;
  cancellationRequestedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  operationCount: number;
  source: string;
  startedAt?: string;
  status: DurableRecipeStatus;
  updatedAt: string;
};

export class DurableRecipeQueueError extends Error {
  public constructor(
    public readonly code:
      "QUEUE_BUSY" | "QUEUE_INVALID" | "QUEUE_NOT_FOUND" | "QUEUE_STATE",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DurableRecipeQueueError";
  }
}

/** A workspace-local queue. Jobs are JSON receipts, never shell commands. */
export class DurableRecipeQueue {
  private lastTimestampMs = 0;

  private constructor(private readonly root: string) {}

  public static async open(
    config: ServerConfig,
    workspaceIndex: number,
  ): Promise<DurableRecipeQueue> {
    const workspaces = await WorkspaceService.create(config.workspaceRoots);
    const workspace = workspaces.list()[workspaceIndex];
    if (workspace === undefined)
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        `--workspace-index ${workspaceIndex} is not configured`,
      );
    const root = await workspaces.ensureOutputDirectory(
      workspace.id,
      ".inkscape-mcp/recipe-queue",
    );
    return new DurableRecipeQueue(root.absolutePath);
  }

  public async enqueue(recipe: AutonomousRecipe): Promise<DurableRecipeJob> {
    const now = this.timestamp();
    const job: DurableRecipeJob = {
      attempt: 0,
      createdAt: now,
      id: `recipe_job_${randomUUID().replaceAll("-", "")}`,
      recipe,
      status: "queued",
      updatedAt: now,
    };
    await this.write(job);
    return publicJob(job);
  }

  public async get(id: string): Promise<DurableRecipeJob> {
    return publicJob(await this.read(id));
  }

  /** Lists durable job metadata, newest activity first, without recipes or receipts. */
  public async list(options: {
    limit: number;
    status?: DurableRecipeStatus;
  }): Promise<DurableRecipeJobSummary[]> {
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > 100
    )
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        "--limit must be an integer from 1 to 100",
      );
    const entries = await readdir(this.root, { withFileTypes: true });
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => await this.read(entry.name.slice(0, -5))),
    );
    return jobs
      .filter(
        (job) => options.status === undefined || job.status === options.status,
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, options.limit)
      .map((job) => publicJobSummary(job));
  }

  /** Requests cancellation; an active atomic batch completes before it takes effect. */
  public async cancel(id: string): Promise<DurableRecipeJob> {
    const job = await this.read(id);
    if (job.status === "queued") {
      job.status = "cancelled";
      job.updatedAt = this.timestamp();
      await this.write(job);
      return publicJob(job);
    }
    if (job.status === "running") {
      if (job.cancellationRequestedAt === undefined) {
        job.cancellationRequestedAt = this.timestamp();
        job.updatedAt = job.cancellationRequestedAt;
        await this.write(job);
      }
      return publicJob(job);
    }
    if (job.status === "cancelled") return publicJob(job);
    throw new DurableRecipeQueueError(
      "QUEUE_STATE",
      "Only queued or running recipes can be cancelled",
    );
  }

  public async retry(id: string): Promise<DurableRecipeJob> {
    const job = await this.read(id);
    if (job.status !== "failed" && job.status !== "cancelled")
      throw new DurableRecipeQueueError(
        "QUEUE_STATE",
        "Only failed or cancelled recipes can be retried",
      );
    job.attempt += 1;
    delete job.error;
    delete job.cancellationRequestedAt;
    delete job.receipt;
    delete job.startedAt;
    job.status = "queued";
    job.updatedAt = this.timestamp();
    await this.write(job);
    return publicJob(job);
  }

  /** Claims and executes at most maxJobs recipes under an exclusive local lock. */
  public async work(
    maxJobs: number,
    execute: (
      recipe: AutonomousRecipe,
      options: { isCancellationRequested: () => Promise<boolean> },
    ) => Promise<unknown>,
  ): Promise<{
    cancelled: number;
    completed: number;
    failed: number;
    processed: number;
  }> {
    if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 20)
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        "--max-jobs must be an integer from 1 to 20",
      );
    const release = await this.acquireLock();
    try {
      await this.recoverInterrupted();
      let completed = 0;
      let cancelled = 0;
      let failed = 0;
      let processed = 0;
      for (const job of await this.queuedJobs()) {
        if (processed >= maxJobs) break;
        processed += 1;
        job.status = "running";
        job.startedAt = this.timestamp();
        job.updatedAt = job.startedAt;
        await this.write(job);
        try {
          job.receipt = await execute(job.recipe, {
            isCancellationRequested: async () =>
              (await this.read(job.id)).cancellationRequestedAt !== undefined,
          });
          const cancellationRequestedAt = await this.cancellationRequestedAt(
            job.id,
          );
          if (cancellationRequestedAt !== undefined) {
            job.cancellationRequestedAt = cancellationRequestedAt;
            delete job.receipt;
            job.status = "cancelled";
            cancelled += 1;
          } else {
            job.status = "completed";
            completed += 1;
          }
        } catch (error) {
          if (
            error instanceof AutonomousRecipeError &&
            error.code === "RECIPE_CANCELLED"
          ) {
            const cancellationRequestedAt = await this.cancellationRequestedAt(
              job.id,
            );
            if (cancellationRequestedAt !== undefined)
              job.cancellationRequestedAt = cancellationRequestedAt;
            job.status = "cancelled";
            cancelled += 1;
          } else {
            job.error =
              error instanceof Error
                ? error.message.slice(0, 4_096)
                : "Recipe execution failed";
            job.status = "failed";
            failed += 1;
          }
        }
        job.updatedAt = this.timestamp();
        await this.write(job);
      }
      return { cancelled, completed, failed, processed };
    } finally {
      await release();
    }
  }

  private async queuedJobs(): Promise<DurableRecipeJob[]> {
    const entries = await readdir(this.root, { withFileTypes: true });
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => await this.read(entry.name.slice(0, -5))),
    );
    return jobs
      .filter((job) => job.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private async recoverInterrupted(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const job = await this.read(entry.name.slice(0, -5));
      if (job.status !== "running") continue;
      job.error =
        "QUEUE_WORKER_INTERRUPTED: retry explicitly after checking published artifacts";
      job.status = "failed";
      job.updatedAt = this.timestamp();
      await this.write(job);
    }
  }

  private async read(id: string): Promise<DurableRecipeJob> {
    if (!jobIdSchema.safeParse(id).success)
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        "Invalid recipe job ID",
      );
    let text: string;
    try {
      text = await readFile(this.pathFor(id), "utf8");
    } catch {
      throw new DurableRecipeQueueError(
        "QUEUE_NOT_FOUND",
        "Recipe job is unavailable",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        "Stored recipe job is invalid JSON",
      );
    }
    const parsed = storedJobSchema.safeParse(value);
    if (!parsed.success || parsed.data.id !== id)
      throw new DurableRecipeQueueError(
        "QUEUE_INVALID",
        "Stored recipe job is invalid",
      );
    return {
      attempt: parsed.data.attempt,
      ...(parsed.data.cancellationRequestedAt === undefined
        ? {}
        : { cancellationRequestedAt: parsed.data.cancellationRequestedAt }),
      createdAt: parsed.data.createdAt,
      ...(parsed.data.error === undefined ? {} : { error: parsed.data.error }),
      id: parsed.data.id,
      recipe: parseAutonomousRecipe(parsed.data.recipe),
      ...(parsed.data.receipt === undefined
        ? {}
        : { receipt: parsed.data.receipt }),
      ...(parsed.data.startedAt === undefined
        ? {}
        : { startedAt: parsed.data.startedAt }),
      status: parsed.data.status,
      updatedAt: parsed.data.updatedAt,
    };
  }

  private async write(job: DurableRecipeJob): Promise<void> {
    const target = this.pathFor(job.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
  }

  private async cancellationRequestedAt(
    id: string,
  ): Promise<string | undefined> {
    return (await this.read(id)).cancellationRequestedAt;
  }

  private pathFor(id: string): string {
    return join(this.root, `${id}.json`);
  }

  private timestamp(): string {
    this.lastTimestampMs = Math.max(Date.now(), this.lastTimestampMs + 1);
    return new Date(this.lastTimestampMs).toISOString();
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const lock = join(this.root, "worker.lock");
    try {
      await mkdir(lock);
    } catch {
      if (!(await isAbandonedLock(lock)))
        throw new DurableRecipeQueueError(
          "QUEUE_BUSY",
          "Another queue worker is already running",
        );
      await rm(lock, { force: true, recursive: true });
      try {
        await mkdir(lock);
      } catch {
        throw new DurableRecipeQueueError(
          "QUEUE_BUSY",
          "Another queue worker is already running",
        );
      }
    }
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({
        host: hostname(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }),
    );
    return async () => {
      await rm(lock, { force: true, recursive: true });
    };
  }
}

function publicJob(job: DurableRecipeJob): DurableRecipeJob {
  return structuredClone(job);
}

function publicJobSummary(job: DurableRecipeJob): DurableRecipeJobSummary {
  return {
    attempt: job.attempt,
    ...(job.cancellationRequestedAt === undefined
      ? {}
      : { cancellationRequestedAt: job.cancellationRequestedAt }),
    createdAt: job.createdAt,
    ...(job.error === undefined ? {} : { error: job.error }),
    id: job.id,
    operationCount: job.recipe.operations.length,
    source: job.recipe.source,
    ...(job.startedAt === undefined ? {} : { startedAt: job.startedAt }),
    status: job.status,
    updatedAt: job.updatedAt,
  };
}

async function isAbandonedLock(lock: string): Promise<boolean> {
  let owner: unknown;
  try {
    owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
  } catch {
    return false;
  }
  const parsed = z
    .object({ host: z.string().min(1), pid: z.number().int().positive() })
    .safeParse(owner);
  if (!parsed.success || parsed.data.host !== hostname()) return false;
  try {
    process.kill(parsed.data.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
