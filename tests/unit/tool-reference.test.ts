import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vitest";

const root = process.cwd();

it("documents every registered MCP tool and its canonical schema source", () => {
  const server = readFileSync(resolve(root, "src/server/index.ts"), "utf8");
  const reference = readFileSync(
    resolve(root, "docs/tool-reference.md"),
    "utf8",
  );
  const tools = [
    ...server.matchAll(/server\.registerTool\(\s*"([^"]+)"/gu),
  ].map((match) => match[1]!);

  expect(tools.length).toBeGreaterThan(60);
  expect(new Set(tools).size).toBe(tools.length);
  for (const tool of tools) expect(reference).toContain(`\`${tool}\``);
  expect(reference).toContain("`tools/list`");
  expect(reference).toContain("`expectedRevision`");
  expect(reference).toContain("structuredContent");
});
