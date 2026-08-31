import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflowPath = join(
  process.cwd(),
  ".github",
  "workflows",
  "portable-unit-ci.yml",
);

describe("portable unit CI workflow", () => {
  it("runs the portable quality gate on every supported operating system", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("node-version: 24.18.0");
    expect(workflow).toContain(
      "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
    );
    expect(workflow).toContain(
      "actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
    );
    expect(workflow).toContain("npm ci");
    expect(workflow).toContain("npm run check");
    expect(workflow).not.toContain("test:mcp");
  });
});
