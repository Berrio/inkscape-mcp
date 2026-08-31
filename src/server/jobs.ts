export type JobStatus =
  "cancelled" | "completed" | "failed" | "queued" | "running";
export type JobProgress = { detail?: string; stage: string };
export type JobSnapshot<T = unknown> = {
  error?: string;
  id: string;
  progress?: JobProgress;
  result?: T;
  status: JobStatus;
};

type JobRecord<T> = JobSnapshot<T> & {
  cancellationClosed: boolean;
  controller: AbortController;
  expiresAt: number;
  onTerminal?: (snapshot: JobSnapshot<T>) => void;
  owner: string;
};
export type JobOptions<T> = {
  onTerminal?: (snapshot: JobSnapshot<T>) => void;
  ttlMs?: number;
};

/** In-memory, owner-bound jobs. The executor receives one signal which must be
 * passed all the way to the native renderer. No partial result is exposed when
 * cancellation wins the race. */
export class JobStore {
  private readonly jobs = new Map<string, JobRecord<unknown>>();

  public constructor(private readonly defaultTtlMs = 24 * 60 * 60_000) {}

  public create<T>(
    owner: string,
    execute: (options: {
      /** Once an atomic publication starts it cannot be cancelled without
       * risking an externally visible partial batch. */
      beginPublication: () => void;
      onProgress: (progress: JobProgress) => void;
      signal: AbortSignal;
    }) => Promise<T>,
    options: JobOptions<T> = {},
  ): JobSnapshot<T> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    if (!Number.isInteger(ttlMs) || ttlMs < 1)
      throw new Error("Job TTL is invalid");
    const id = `job_${crypto.randomUUID().replaceAll("-", "")}`;
    const record: JobRecord<T> = {
      cancellationClosed: false,
      controller: new AbortController(),
      expiresAt: Date.now() + ttlMs,
      id,
      ...(options.onTerminal === undefined
        ? {}
        : { onTerminal: options.onTerminal }),
      owner,
      status: "queued",
    };
    this.jobs.set(id, record as JobRecord<unknown>);
    queueMicrotask(async () => {
      if (record.controller.signal.aborted) {
        this.finish(record, "cancelled");
        return;
      }
      record.status = "running";
      try {
        const result = await execute({
          beginPublication: () => {
            record.cancellationClosed = true;
          },
          onProgress: (progress) => {
            if (record.status === "running") record.progress = { ...progress };
          },
          signal: record.controller.signal,
        });
        if (record.controller.signal.aborted && !record.cancellationClosed)
          this.finish(record, "cancelled");
        else this.finish(record, "completed", result);
      } catch (error) {
        if (record.controller.signal.aborted) this.finish(record, "cancelled");
        else
          this.finish(
            record,
            "failed",
            undefined,
            error instanceof Error ? error.message : "Job failed",
          );
      }
    });
    return snapshot(record);
  }

  public get<T>(id: string, owner: string): JobSnapshot<T> {
    const record = this.require(id, owner);
    return snapshot(record) as JobSnapshot<T>;
  }

  public cancel<T>(id: string, owner: string): JobSnapshot<T> {
    const record = this.require(id, owner);
    if (
      (record.status === "queued" || record.status === "running") &&
      !record.cancellationClosed
    )
      record.controller.abort();
    return snapshot(record) as JobSnapshot<T>;
  }

  public removeExpired(): number {
    let removed = 0;
    for (const [id, record] of this.jobs)
      if (
        record.expiresAt <= Date.now() &&
        (record.status === "cancelled" ||
          record.status === "completed" ||
          record.status === "failed")
      ) {
        this.jobs.delete(id);
        removed += 1;
      }
    return removed;
  }

  private require(id: string, owner: string): JobRecord<unknown> {
    const record = this.jobs.get(id);
    if (!record || record.owner !== owner) {
      this.jobs.delete(id);
      throw new Error("Job is unavailable");
    }
    if (
      record.expiresAt <= Date.now() &&
      (record.status === "cancelled" ||
        record.status === "completed" ||
        record.status === "failed")
    ) {
      this.jobs.delete(id);
      throw new Error("Job is unavailable");
    }
    return record;
  }

  private finish<T>(
    record: JobRecord<T>,
    status: Extract<JobStatus, "cancelled" | "completed" | "failed">,
    result?: T,
    error?: string,
  ): void {
    if (
      record.status === "cancelled" ||
      record.status === "completed" ||
      record.status === "failed"
    )
      return;
    record.status = status;
    if (result !== undefined) record.result = result;
    if (error !== undefined) record.error = error;
    record.onTerminal?.(snapshot(record));
  }
}

function snapshot<T>(record: JobRecord<T>): JobSnapshot<T> {
  return {
    ...(record.error === undefined ? {} : { error: record.error }),
    id: record.id,
    ...(record.progress === undefined
      ? {}
      : { progress: { ...record.progress } }),
    ...(record.result === undefined || record.status !== "completed"
      ? {}
      : { result: record.result }),
    status: record.status,
  };
}
