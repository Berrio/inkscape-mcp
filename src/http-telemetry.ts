import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

export type HttpRequestTelemetryEvent = {
  durationMs: number;
  event: "http_request_completed";
  principal?: string;
  status: number;
};
export type HttpRequestSpan = {
  finish: (status: number) => void;
  setPrincipal: (principal: string) => void;
};

/**
 * Minimal OpenTelemetry tracing with a deliberately allowlisted local exporter.
 * It cannot receive request URLs, headers, token values, document paths, or MCP
 * payloads. Operators can correlate a principal only through its derived ID.
 */
export class HttpTelemetry {
  private readonly provider: BasicTracerProvider;
  private readonly tracer;

  public constructor(log: (event: HttpRequestTelemetryEvent) => void) {
    this.provider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(new StructuredSpanExporter(log)),
      ],
    });
    this.tracer = this.provider.getTracer("inkscape-mcp/http", "0.1.0");
  }

  public start(): HttpRequestSpan {
    const span = this.tracer.startSpan("mcp.http.request", {
      attributes: { "mcp.http.authenticated": false },
    });
    return {
      finish: (status) => {
        span.setAttribute("http.response.status_code", status);
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
      },
      setPrincipal: (principal) => {
        span.setAttribute("mcp.http.authenticated", true);
        span.setAttribute("mcp.http.principal", principal);
      },
    };
  }

  public async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}

class StructuredSpanExporter implements SpanExporter {
  public constructor(
    private readonly log: (event: HttpRequestTelemetryEvent) => void,
  ) {}

  public export(
    spans: ReadableSpan[],
    complete: Parameters<SpanExporter["export"]>[1],
  ): void {
    for (const span of spans) {
      const principal = span.attributes["mcp.http.principal"];
      const status = span.attributes["http.response.status_code"];
      this.log({
        durationMs: Math.max(
          0,
          Math.round(span.duration[0] * 1_000 + span.duration[1] / 1_000_000),
        ),
        event: "http_request_completed",
        ...(typeof principal === "string" ? { principal } : {}),
        status: typeof status === "number" ? status : 500,
      });
    }
    complete({ code: 0 });
  }

  public async forceFlush(): Promise<void> {}

  public async shutdown(): Promise<void> {}
}
