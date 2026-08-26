export type ExportProgressStage =
  | "validated"
  | "staging"
  | "rendering"
  | "verifying"
  | "publishing"
  | "completed";
export type ExportProgress = {
  detail?: string | undefined;
  stage: ExportProgressStage;
};
export type ExportExecutionOptions = {
  onProgress?: ((progress: ExportProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
};

export class ExportAbortedError extends Error {
  public constructor(message = "Export execution was aborted") {
    super(message);
  }
}

/** Keeps progress ordering and cancellation explicit for every export pipeline. */
export function beginExportExecution(options: ExportExecutionOptions = {}): {
  checkpoint: (stage: ExportProgressStage, detail?: string) => void;
} {
  const sequence: ExportProgressStage[] = [
    "validated",
    "staging",
    "rendering",
    "verifying",
    "publishing",
    "completed",
  ];
  let previous = -1;
  return {
    checkpoint(stage, detail) {
      if (options.signal?.aborted) throw new ExportAbortedError();
      const position = sequence.indexOf(stage);
      if (position < previous)
        throw new Error("Export progress stage cannot move backwards");
      previous = position;
      options.onProgress?.({
        ...(detail === undefined ? {} : { detail }),
        stage,
      });
    },
  };
}
