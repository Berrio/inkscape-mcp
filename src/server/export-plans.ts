import type { ExportSpec } from "../export/index.js";

export type ExportPresetPlan = {
  digest: string;
  expiresAt: number;
  outputDirectory: string;
  outputPaths: readonly string[];
  specs: readonly ExportSpec[];
  token: string;
};

type PlanRecord = ExportPresetPlan & { owner: string };

/** In-memory owner-bound, one-use export plans. They intentionally disappear on restart. */
export class ExportPlanStore {
  private readonly plans = new Map<string, PlanRecord>();

  public create(
    owner: string,
    request: {
      digest: string;
      outputDirectory: string;
      specs: readonly ExportSpec[];
      ttlMs: number;
    },
  ): ExportPresetPlan {
    this.removeExpired();
    if (!Number.isSafeInteger(request.ttlMs) || request.ttlMs < 1)
      throw new Error("Export plan TTL is invalid");
    const token = `plan_${crypto.randomUUID().replaceAll("-", "")}`;
    const plan: PlanRecord = {
      digest: request.digest,
      expiresAt: Date.now() + request.ttlMs,
      outputDirectory: request.outputDirectory,
      outputPaths: request.specs.map((spec) => {
        if (spec.target.kind !== "file")
          throw new Error("Export plan contains a non-file variant");
        return spec.target.path;
      }),
      owner,
      specs: request.specs,
      token,
    };
    this.plans.set(token, plan);
    return publicPlan(plan);
  }

  public consume(token: string, owner: string): ExportPresetPlan {
    this.removeExpired();
    const plan = this.plans.get(token);
    if (!plan || plan.owner !== owner)
      throw new Error("Export plan is unavailable");
    this.plans.delete(token);
    return publicPlan(plan);
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [token, plan] of this.plans)
      if (plan.expiresAt <= now) this.plans.delete(token);
  }
}

function publicPlan(plan: PlanRecord): ExportPresetPlan {
  return {
    digest: plan.digest,
    expiresAt: plan.expiresAt,
    outputDirectory: plan.outputDirectory,
    outputPaths: [...plan.outputPaths],
    specs: plan.specs,
    token: plan.token,
  };
}
