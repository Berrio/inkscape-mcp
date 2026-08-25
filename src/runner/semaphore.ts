import { ProcessAbortedError } from "./errors.js";

type WaitingEntry = {
  reject: (reason: Error) => void;
  resolve: (release: () => void) => void;
  signal: AbortSignal | undefined;
};

export class AsyncSemaphore {
  private readonly waiting: WaitingEntry[] = [];
  private active = 0;

  public constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Semaphore maximum must be a positive integer");
    }
  }

  public get activeCount(): number {
    return this.active;
  }

  public get waitingCount(): number {
    return this.waiting.length;
  }

  public async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new ProcessAbortedError(
        "Process execution was aborted before queueing",
      );
    }

    if (this.active < this.maximum) {
      this.active += 1;
      return this.releaseOnce();
    }

    return new Promise<() => void>((resolve, reject) => {
      const entry: WaitingEntry = { reject, resolve, signal };
      const abort = () => {
        this.removeWaitingEntry(entry);
        reject(
          new ProcessAbortedError("Process execution was aborted while queued"),
        );
      };

      signal?.addEventListener("abort", abort, { once: true });
      this.waiting.push(entry);
    });
  }

  private releaseOnce(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;
      this.release();
    };
  }

  private release(): void {
    const entry = this.waiting.shift();

    if (entry === undefined) {
      this.active -= 1;
      return;
    }

    if (entry.signal?.aborted) {
      entry.reject(
        new ProcessAbortedError("Process execution was aborted while queued"),
      );
      this.release();
      return;
    }

    entry.resolve(this.releaseOnce());
  }

  private removeWaitingEntry(entry: WaitingEntry): void {
    const index = this.waiting.indexOf(entry);
    if (index >= 0) {
      this.waiting.splice(index, 1);
    }
  }
}
