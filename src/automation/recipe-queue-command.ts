import { loadConfigFromCli } from "../config/index.js";
import {
  readAutonomousRecipe,
  runAutonomousRecipeDefinition,
} from "./recipe-command.js";
import {
  DurableRecipeQueue,
  type DurableRecipeStatus,
} from "./recipe-queue.js";

export type DurableQueueRequest = {
  configArguments: readonly string[];
  id?: string;
  limit: number;
  maxJobs: number;
  operation: "cancel" | "enqueue" | "get" | "list" | "retry" | "work";
  recipePath?: string;
  status?: DurableRecipeStatus;
  workspaceIndex: number;
};

/** Parses queue arguments and leaves only ordinary server flags for the worker. */
export function parseDurableQueueArguments(
  argumentsList: readonly string[],
): DurableQueueRequest {
  const operation = argumentsList[0];
  if (!isOperation(operation))
    throw new Error(
      "queue requires enqueue, work, list, get, cancel, or retry",
    );
  let id: string | undefined;
  let recipePath: string | undefined;
  let workspaceIndex = 0;
  let maxJobs = 1;
  let limit = 20;
  let status: DurableRecipeStatus | undefined;
  const configArguments: string[] = [];
  for (let index = 1; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]!;
    if (
      argument === "--workspace-index" ||
      argument === "--max-jobs" ||
      argument === "--limit" ||
      argument === "--status"
    ) {
      const value = argumentsList[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${argument}`);
      index += 1;
      if (argument === "--workspace-index") {
        if (!/^(?:[0-9]|[12][0-9]|3[01])$/u.test(value))
          throw new Error("--workspace-index must be an integer from 0 to 31");
        workspaceIndex = Number(value);
      } else if (argument === "--max-jobs") {
        if (!/^(?:[1-9]|1[0-9]|20)$/u.test(value))
          throw new Error("--max-jobs must be an integer from 1 to 20");
        maxJobs = Number(value);
      } else if (argument === "--limit") {
        if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(value))
          throw new Error("--limit must be an integer from 1 to 100");
        limit = Number(value);
      } else if (isStatus(value)) {
        status = value;
      } else {
        throw new Error(
          "--status must be queued, running, completed, failed, or cancelled",
        );
      }
      continue;
    }
    if (argument.startsWith("-")) {
      configArguments.push(argument);
      const value = argumentsList[index + 1];
      if (value === undefined) throw new Error(`Missing value for ${argument}`);
      configArguments.push(value);
      index += 1;
      continue;
    }
    if (operation === "enqueue" && recipePath === undefined)
      recipePath = argument;
    else if (
      (operation === "get" ||
        operation === "cancel" ||
        operation === "retry") &&
      id === undefined
    )
      id = argument;
    else throw new Error(`Unexpected queue argument: ${argument}`);
  }
  if (operation === "enqueue" && recipePath === undefined)
    throw new Error("queue enqueue requires one recipe JSON path");
  if (
    (operation === "get" || operation === "cancel" || operation === "retry") &&
    id === undefined
  )
    throw new Error(`queue ${operation} requires one recipe job ID`);
  if (operation !== "work" && maxJobs !== 1)
    throw new Error("--max-jobs is only valid for queue work");
  if (operation !== "list" && limit !== 20)
    throw new Error("--limit is only valid for queue list");
  if (operation !== "list" && status !== undefined)
    throw new Error("--status is only valid for queue list");
  return {
    configArguments,
    ...(id === undefined ? {} : { id }),
    limit,
    maxJobs,
    operation,
    ...(recipePath === undefined ? {} : { recipePath }),
    ...(status === undefined ? {} : { status }),
    workspaceIndex,
  };
}

export async function runDurableQueue(
  request: DurableQueueRequest,
  serverEntry: string,
): Promise<unknown> {
  const config = await loadConfigFromCli(request.configArguments);
  const queue = await DurableRecipeQueue.open(config, request.workspaceIndex);
  if (request.operation === "enqueue")
    return await queue.enqueue(await readAutonomousRecipe(request.recipePath!));
  if (request.operation === "list")
    return await queue.list({
      limit: request.limit,
      ...(request.status === undefined ? {} : { status: request.status }),
    });
  if (request.operation === "get") return await queue.get(request.id!);
  if (request.operation === "cancel") return await queue.cancel(request.id!);
  if (request.operation === "retry") return await queue.retry(request.id!);
  return await queue.work(
    request.maxJobs,
    async (recipe, options) =>
      await runAutonomousRecipeDefinition(
        recipe,
        request.configArguments,
        serverEntry,
        options,
      ),
  );
}

function isOperation(
  value: string | undefined,
): value is DurableQueueRequest["operation"] {
  return (
    value === "enqueue" ||
    value === "list" ||
    value === "work" ||
    value === "get" ||
    value === "cancel" ||
    value === "retry"
  );
}

function isStatus(value: string): value is DurableRecipeStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}
