import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";

import { type ServerConfig } from "./config/index.js";
import { buildServer, createServerRuntime } from "./server/index.js";

const HTTP_PATH = "/mcp";
const LOCAL_HOSTNAMES = ["127.0.0.1", "localhost"];
const MAX_REQUESTS_PER_MINUTE = 120;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

export type HttpMcpServer = {
  close: () => Promise<void>;
  url: string;
};
export type HttpLogEvent = {
  event: "http_listening" | "http_request_rejected" | "http_server_error";
  status?: 400 | 401 | 403 | 413 | 429 | 500 | undefined;
};
export type HttpMcpServerOptions = {
  log?: ((event: HttpLogEvent) => void) | undefined;
};

type FetchHandler = Pick<McpHttpHandler, "close" | "fetch">;

/** Returns the only supported HTTP secret without copying it into config. */
export function readHttpBearerToken(env: NodeJS.ProcessEnv): string {
  const token = env.INKSCAPE_MCP_HTTP_TOKEN;
  if (!token || !TOKEN_PATTERN.test(token))
    throw new Error(
      "HTTP requires INKSCAPE_MCP_HTTP_TOKEN as a base64url token of at least 32 characters",
    );
  return token;
}

/** Wraps an official MCP v2 handler with the local HTTP security boundary. */
export function createSecureHttpHandler(
  config: ServerConfig,
  token: string,
  handler?: FetchHandler,
  options: HttpMcpServerOptions = {},
): FetchHandler {
  const log = options.log ?? writeHttpLog;
  const runtime = createServerRuntime(config);
  const securedHandler =
    handler ??
    createMcpHandler(() => buildServer(config, runtime), {
      legacy: "reject",
      maxSubscriptions: 16,
      onerror: () => log({ event: "http_server_error", status: 500 }),
    });
  const limiter = new LocalRateLimiter();
  return {
    close: () => securedHandler.close(),
    async fetch(request: Request): Promise<Response> {
      if (new URL(request.url).pathname !== HTTP_PATH)
        return new Response("Not found", { status: 404 });
      const rejected =
        hostHeaderValidationResponse(request, LOCAL_HOSTNAMES) ??
        originValidationResponse(request, LOCAL_HOSTNAMES);
      if (rejected) {
        log({
          event: "http_request_rejected",
          status: rejected.status as 400 | 403,
        });
        return rejected;
      }
      if (!limiter.allow("loopback")) {
        log({ event: "http_request_rejected", status: 429 });
        return new Response("Too many requests", {
          headers: { "Retry-After": "60" },
          status: 429,
        });
      }
      const auth = authenticateBearer(
        request.headers.get("authorization"),
        token,
      );
      if (auth instanceof Response) {
        log({ event: "http_request_rejected", status: 401 });
        return auth;
      }
      return securedHandler.fetch(request, { authInfo: auth });
    },
  };
}

/** Starts the opt-in loopback-only HTTP endpoint. */
export async function startHttpMcpServer(
  config: ServerConfig,
  token: string,
  options: HttpMcpServerOptions = {},
): Promise<HttpMcpServer> {
  if (config.transport !== "http")
    throw new Error("HTTP server requires transport=http");
  const log = options.log ?? writeHttpLog;
  const handler = createSecureHttpHandler(config, token, undefined, { log });
  const server = createServer((request, response) => {
    void handleNodeRequest(request, response, config, handler, log);
  });
  server.requestTimeout = config.processTimeoutMs;
  server.headersTimeout = Math.min(config.processTimeoutMs, 60_000);
  server.keepAliveTimeout = 5_000;
  server.listen(config.http.port, config.http.host);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("HTTP listener did not expose a TCP address");
  }
  log({ event: "http_listening" });
  return {
    close: async () => {
      await handler.close();
      server.close();
      await once(server, "close");
    },
    url: `http://${config.http.host}:${address.port}${HTTP_PATH}`,
  };
}

function authenticateBearer(
  authorization: string | null,
  expectedToken: string,
): AuthInfo | Response {
  const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/iu.exec(authorization ?? "");
  const actualToken = match?.[1];
  if (!actualToken || !constantTimeTokenEquals(actualToken, expectedToken))
    return new Response("Unauthorized", {
      headers: { "WWW-Authenticate": 'Bearer realm="inkscape-mcp"' },
      status: 401,
    });
  return {
    clientId: "local-http-token",
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    scopes: ["mcp"],
    token: expectedToken,
  };
}

function constantTimeTokenEquals(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

async function handleNodeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServerConfig,
  handler: FetchHandler,
  log: (event: HttpLogEvent) => void,
): Promise<void> {
  try {
    const webRequest = await toWebRequest(request, config);
    const webResponse = await handler.fetch(webRequest);
    await writeWebResponse(response, webResponse);
  } catch (error: unknown) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    log({ event: "http_request_rejected", status });
    if (!response.headersSent) response.writeHead(status);
    response.end(status === 413 ? "Request body too large" : "Bad request");
  }
}

async function toWebRequest(
  request: IncomingMessage,
  config: ServerConfig,
): Promise<Request> {
  const method = request.method ?? "GET";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const contentLength = Number(headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > config.maxInputBytes)
    throw new RequestBodyTooLargeError();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await readBody(request, config.maxInputBytes);
  return new Request(
    `http://${config.http.host}:${config.http.port}${request.url ?? "/"}`,
    body === undefined ? { headers, method } : { body, headers, method },
  );
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximumBytes) {
      request.destroy();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function writeWebResponse(
  response: ServerResponse,
  webResponse: Response,
): Promise<void> {
  for (const [name, value] of webResponse.headers)
    response.setHeader(name, value);
  response.writeHead(webResponse.status);
  if (!webResponse.body) {
    response.end();
    return;
  }
  const reader = webResponse.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      if (!response.write(Buffer.from(next.value)))
        await once(response, "drain");
    }
  } finally {
    reader.releaseLock();
    response.end();
  }
}

class RequestBodyTooLargeError extends Error {}

class LocalRateLimiter {
  readonly #buckets = new Map<string, { count: number; startedAt: number }>();

  public allow(key: string): boolean {
    const now = Date.now();
    const current = this.#buckets.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.#buckets.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (current.count >= MAX_REQUESTS_PER_MINUTE) return false;
    current.count += 1;
    return true;
  }
}

function writeHttpLog(event: HttpLogEvent): void {
  process.stderr.write(
    `${JSON.stringify({ component: "inkscape-mcp", transport: "http", ...event })}\n`,
  );
}
