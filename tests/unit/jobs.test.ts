import { expect, it } from "vitest";

import { JobStore } from "../../src/server/jobs.js";

it("cancels a queued owner-bound job without exposing a result", async () => {
  const jobs = new JobStore();
  const job = jobs.create("ws_a", async () => "published");
  expect(jobs.cancel(job.id, "ws_a").status).toBe("queued");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(jobs.get(job.id, "ws_a")).toMatchObject({ status: "cancelled" });
  expect(jobs.get(job.id, "ws_a").result).toBeUndefined();
  expect(() => jobs.get(job.id, "ws_b")).toThrow("unavailable");
});
