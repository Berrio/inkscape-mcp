import {
  beginExportExecution,
  type ExportExecutionOptions,
  type ExportProgressStage,
} from "./execution.js";

export type ExportPipeline<TStaged, TRendered, TVerified, TResult> = {
  cleanup?: ((staged: TStaged | undefined) => Promise<void>) | undefined;
  publish: (verified: TVerified) => Promise<TResult>;
  render: (
    staged: TStaged,
    options: ExportExecutionOptions,
  ) => Promise<TRendered>;
  stage: (options: ExportExecutionOptions) => Promise<TStaged>;
  validate: () => Promise<void> | void;
  verify: (rendered: TRendered) => Promise<TVerified>;
};

/** Runs all export formats through the same observable, cancellable stage
 * sequence. Each adapter owns its temporary files but cleanup always runs. */
export async function runExportPipeline<TStaged, TRendered, TVerified, TResult>(
  pipeline: ExportPipeline<TStaged, TRendered, TVerified, TResult>,
  options: ExportExecutionOptions = {},
): Promise<TResult> {
  const execution = beginExportExecution(options);
  let staged: TStaged | undefined;
  try {
    checkpoint(execution.checkpoint, "validated");
    await pipeline.validate();
    checkpoint(execution.checkpoint, "staging");
    staged = await pipeline.stage(options);
    checkpoint(execution.checkpoint, "rendering");
    const rendered = await pipeline.render(staged, options);
    checkpoint(execution.checkpoint, "verifying");
    const verified = await pipeline.verify(rendered);
    checkpoint(execution.checkpoint, "publishing");
    const result = await pipeline.publish(verified);
    checkpoint(execution.checkpoint, "completed");
    return result;
  } finally {
    if (pipeline.cleanup !== undefined) await pipeline.cleanup(staged);
  }
}

function checkpoint(
  emit: (stage: ExportProgressStage, detail?: string) => void,
  stage: ExportProgressStage,
): void {
  emit(stage);
}
