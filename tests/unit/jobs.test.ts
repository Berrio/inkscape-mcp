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

it("returns an unchanged terminal snapshot when cancellation is repeated", async () => {
  const jobs = new JobStore();
  const job = jobs.create("ws_a", async () => "published");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(jobs.get(job.id, "ws_a")).toMatchObject({
    result: "published",
    status: "completed",
  });
  expect(jobs.cancel(job.id, "ws_a")).toMatchObject({
    result: "published",
    status: "completed",
  });
});

it("expires terminal jobs and invokes one terminal cleanup callback", async () => {
  const terminalStatuses: string[] = [];
  const jobs = new JobStore();
  const job = jobs.create("ws_a", async () => "published", {
    onTerminal: (snapshot) => terminalStatuses.push(snapshot.status),
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(jobs.get(job.id, "ws_a").status).toBe("completed");
  expect(terminalStatuses).toEqual(["completed"]);
  const expired = jobs.create("ws_a", async () => "expired", { ttlMs: 1 });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  expect(jobs.removeExpired()).toBe(1);
  expect(() => jobs.get(expired.id, "ws_a")).toThrow("unavailable");
});

it("does not turn an atomically published job into a cancelled job", async () => {
  let publish: (() => void) | undefined;
  const jobs = new JobStore();
  const job = jobs.create("ws_a", async ({ beginPublication }) => {
    beginPublication();
    await new Promise<void>((resolve) => {
      publish = resolve;
    });
    return "published";
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(jobs.cancel(job.id, "ws_a").status).toBe("running");
  publish?.();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(jobs.get(job.id, "ws_a")).toMatchObject({
    result: "published",
    status: "completed",
  });
});
