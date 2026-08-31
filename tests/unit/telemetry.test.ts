import { expect, it } from "vitest";

import { InternalTelemetry } from "../../src/server/telemetry.js";

it("retains only bounded allowlisted telemetry without payload labels", () => {
  const telemetry = new InternalTelemetry();
  const finish = telemetry.start("stdio_listening");
  finish();
  telemetry.record("stdio_error");
  for (let index = 0; index < 120; index += 1) telemetry.record("stdio_error");
  const snapshot = telemetry.snapshot();
  expect(snapshot.counters).toEqual({ stdio_error: 121, stdio_listening: 1 });
  expect(snapshot.recentSpans).toHaveLength(1);
  expect(snapshot.recentSpans[0]).toMatchObject({
    name: "stdio_listening",
    outcome: "ok",
  });
  expect(JSON.stringify(snapshot)).not.toContain("C:\\\\");
  expect(JSON.stringify(snapshot)).not.toContain("token=");
});

it("bounds retained spans and reports an error outcome without error text", () => {
  const telemetry = new InternalTelemetry();
  for (let index = 0; index < 101; index += 1)
    telemetry.start("stdio_error")("error");
  const snapshot = telemetry.snapshot();
  expect(snapshot.recentSpans).toHaveLength(100);
  expect(snapshot.recentSpans.every((span) => span.outcome === "error")).toBe(
    true,
  );
});
