export type InternalMetricName = "stdio_error" | "stdio_listening";
export type InternalSpan = {
  durationMs: number;
  name: InternalMetricName;
  outcome: "error" | "ok";
};
export type InternalTelemetrySnapshot = {
  counters: Readonly<Record<InternalMetricName, number>>;
  recentSpans: readonly InternalSpan[];
};

/**
 * Process-local operational telemetry. It intentionally has no generic labels,
 * payload, exporter, filesystem sink, or MCP tool: documents and paths can
 * never enter this boundary by API design.
 */
export class InternalTelemetry {
  private readonly counters: Record<InternalMetricName, number> = {
    stdio_error: 0,
    stdio_listening: 0,
  };
  private readonly recentSpans: InternalSpan[] = [];

  public record(name: InternalMetricName): void {
    this.counters[name] += 1;
  }

  public start(name: InternalMetricName): (outcome?: "error" | "ok") => void {
    const startedAt = performance.now();
    return (outcome = "ok") => {
      this.record(name);
      this.recentSpans.push({
        durationMs: Math.max(0, performance.now() - startedAt),
        name,
        outcome,
      });
      if (this.recentSpans.length > 100) this.recentSpans.shift();
    };
  }

  public snapshot(): InternalTelemetrySnapshot {
    return {
      counters: { ...this.counters },
      recentSpans: this.recentSpans.map((span) => ({ ...span })),
    };
  }
}
