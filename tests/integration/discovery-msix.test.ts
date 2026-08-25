import { describe, expect, it } from "vitest";

import {
  locateInkscape,
  probeInkscapeCandidate,
} from "../../src/discovery/index.js";
import { ProcessRunner } from "../../src/runner/index.js";

const runWindowsInkscapeIntegration =
  process.platform === "win32" && process.env.RUN_INKSCAPE_INTEGRATION === "1";

describe.runIf(runWindowsInkscapeIntegration)(
  "Windows MSIX Inkscape integration",
  () => {
    it("discovers and probes the locally installed Inkscape package", async () => {
      const runner = new ProcessRunner(1);
      const discovery = await locateInkscape({
        config: { inkscapeBin: "auto" },
        cwd: process.cwd(),
        runner,
      });
      const candidate = discovery.candidates.find(
        (item) => item.installKind === "msix",
      );

      expect(candidate).toBeDefined();
      const probe = await probeInkscapeCandidate(
        runner,
        candidate!,
        process.cwd(),
      );

      expect(probe).toMatchObject({
        version: expect.stringMatching(/^1\.4\.4(?:\s|$)/u),
      });
    });
  },
);
