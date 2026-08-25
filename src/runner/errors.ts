export class ProcessAbortedError extends Error {
  public constructor(message = "Process execution was aborted") {
    super(message);
    this.name = "ProcessAbortedError";
  }
}

export class ProcessSpawnError extends Error {
  public constructor(
    message: string,
    public readonly causeMessage?: string,
  ) {
    super(message);
    this.name = "ProcessSpawnError";
  }
}
