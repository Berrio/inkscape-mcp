import { expect, it } from "vitest";

import { writeSecurityAuditLog } from "../../src/server/security-audit.js";

it("writes a fixed security event without client-sensitive fields", () => {
  const lines: string[] = [];
  writeSecurityAuditLog("sanitize_mode_trusted_rejected", {
    write: (line) => lines.push(line),
  });

  expect(lines).toEqual([
    `${JSON.stringify({
      component: "inkscape-mcp",
      event: "sanitize_mode_trusted_rejected",
      outcome: "rejected",
      policy: "client-sanitize-mode",
    })}\n`,
  ]);
});
