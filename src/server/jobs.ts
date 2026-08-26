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
  controller: AbortController;
  owner: string;
};

/** In-memory, owner-bound jobs. The executor receives one signal which must be
 * passed all the way to the native renderer. No partial result is exposed when
 * cancellation wins the race. */
export class JobStore {
  private readonly jobs = new Map<string, JobRecord<unknown>>();

  public create<T>(
    owner: string,
    execute: (options: {
      onProgress: (progress: JobProgress) => void;
      signal: AbortSignal;
    }) => Promise<T>,
  ): JobSnapshot<T> {
    const id = `job_${crypto.randomUUID().replaceAll("-", "")}`;
    const record: JobRecord<T> = {
      controller: new AbortController(),
      id,
      owner,
      status: "queued",
    };
    this.jobs.set(id, record);
    queueMicrotask(async () => {
      if (record.controller.signal.aborted) {
        record.status = "cancelled";
        return;
      }
      record.status = "running";
      try {
        const result = await execute({
          onProgress: (progress) => {
            if (record.status === "running") record.progress = { ...progress };
          },
          signal: record.controller.signal,
        });
        if (record.controller.signal.aborted) record.status = "cancelled";
        else {
          record.result = result;
          record.status = "completed";
        }
      } catch (error) {
        if (record.controller.signal.aborted) record.status = "cancelled";
        else {
          record.error = error instanceof Error ? error.message : "Job failed";
          record.status = "failed";
        }
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
    if (record.status === "queued" || record.status === "running")
      record.controller.abort();
    return snapshot(record) as JobSnapshot<T>;
  }

  private require(id: string, owner: string): JobRecord<unknown> {
    const record = this.jobs.get(id);
    if (!record || record.owner !== owner)
      throw new Error("Job is unavailable");
    return record;
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
