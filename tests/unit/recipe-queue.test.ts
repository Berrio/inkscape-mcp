import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../../src/config/index.js";
import { DurableRecipeQueue } from "../../src/automation/recipe-queue.js";
import type { AutonomousRecipe } from "../../src/automation/recipe-command.js";

const recipe: AutonomousRecipe = {
  operations: [{ kind: "inspect" }],
  schema: "inkscape-mcp-recipe/v1",
  source: "label.svg",
  workspaceIndex: 0,
};

it("persists queued recipes, supports cancellation/retry, and records a receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-recipe-queue-"));
  try {
    const queue = await DurableRecipeQueue.open(
      { ...DEFAULT_CONFIG, workspaceRoots: [root] },
      0,
    );
    const queued = await queue.enqueue(recipe);
    expect(queued.status).toBe("queued");
    expect((await queue.cancel(queued.id)).status).toBe("cancelled");
    expect((await queue.retry(queued.id)).attempt).toBe(1);
    expect(
      await queue.work(1, async (stored) => ({ source: stored.source })),
    ).toEqual({ cancelled: 0, completed: 1, failed: 0, processed: 1 });
    expect(await queue.get(queued.id)).toMatchObject({
      receipt: { source: "label.svg" },
      status: "completed",
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("lists compact queue metadata in reverse activity order and supports status filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-recipe-queue-"));
  try {
    const queue = await DurableRecipeQueue.open(
      { ...DEFAULT_CONFIG, workspaceRoots: [root] },
      0,
    );
    const first = await queue.enqueue(recipe);
    const second = await queue.enqueue({ ...recipe, source: "second.svg" });
    await queue.cancel(first.id);
    expect(await queue.list({ limit: 10 })).toEqual([
      expect.objectContaining({
        id: first.id,
        operationCount: 1,
        source: "label.svg",
        status: "cancelled",
      }),
      expect.objectContaining({
        id: second.id,
        operationCount: 1,
        source: "second.svg",
        status: "queued",
      }),
    ]);
    expect(await queue.list({ limit: 1, status: "queued" })).toEqual([
      expect.objectContaining({ id: second.id, status: "queued" }),
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("records a running cancellation and stops after the current atomic operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-recipe-queue-"));
  try {
    const queue = await DurableRecipeQueue.open(
      { ...DEFAULT_CONFIG, workspaceRoots: [root] },
      0,
    );
    const queued = await queue.enqueue(recipe);
    let release: (() => void) | undefined;
    const started = Promise.withResolvers<void>();
    const working = queue.work(1, async (_recipe, options) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      expect(await options.isCancellationRequested()).toBe(true);
      return { publishedAtomicBatch: true };
    });
    await started.promise;
    expect(await queue.cancel(queued.id)).toMatchObject({
      cancellationRequestedAt: expect.any(String),
      status: "running",
    });
    release?.();
    expect(await working).toEqual({
      cancelled: 1,
      completed: 0,
      failed: 0,
      processed: 1,
    });
    expect(await queue.get(queued.id)).toMatchObject({ status: "cancelled" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

it("keeps execution failures durable until an explicit retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "inkscape-mcp-recipe-queue-"));
  try {
    const queue = await DurableRecipeQueue.open(
      { ...DEFAULT_CONFIG, workspaceRoots: [root] },
      0,
    );
    const queued = await queue.enqueue(recipe);
    await queue.work(1, async () => {
      throw new Error("renderer unavailable");
    });
    expect(await queue.get(queued.id)).toMatchObject({
      error: "renderer unavailable",
      status: "failed",
    });
    expect((await queue.retry(queued.id)).status).toBe("queued");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
