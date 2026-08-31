import {
  createMcpHandler,
  hostHeaderValidationResponse,
  originValidationResponse,
  type AuthInfo,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";

import { type ServerConfig } from "./config/index.js";
import { buildServer, createServerRuntime } from "./server/index.js";
import { httpOwnerScope } from "./server/ownership.js";
import {
  HttpTelemetry,
  type HttpRequestTelemetryEvent,
} from "./http-telemetry.js";

const HTTP_PATH = "/mcp";
const LOCAL_HOSTNAMES = ["127.0.0.1", "localhost"];
const MAX_REQUESTS_PER_MINUTE = 120;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;

export type HttpMcpServer = {
  close: () => Promise<void>;
  url: string;
};
export type HttpLogEvent =
  | HttpRequestTelemetryEvent
  | {
      event: "http_listening" | "http_request_rejected" | "http_server_error";
      status?: 400 | 401 | 403 | 413 | 429 | 500 | 503 | undefined;
    };
export type HttpMcpServerOptions = {
  log?: ((event: HttpLogEvent) => void) | undefined;
};

type FetchHandler = Pick<McpHttpHandler, "close" | "fetch">;
type HttpCredential = { clientId: string; token: string };
export type HttpCredentialProvider = {
  authenticate: (authorization: string | null) => Promise<AuthInfo | undefined>;
};

/** Returns the only supported HTTP secret without copying it into config. */
export function readHttpBearerToken(env: NodeJS.ProcessEnv): string {
  const token = env.INKSCAPE_MCP_HTTP_TOKEN;
  if (!token || !TOKEN_PATTERN.test(token))
    throw new Error(
      "HTTP requires INKSCAPE_MCP_HTTP_TOKEN as a base64url token of at least 32 characters",
    );
  return token;
}

/**
 * Reads HTTP credentials from an operator-controlled source. A token file is
 * intentionally read again for every request, so an atomic local replacement
 * rotates credentials without restarting the MCP process. The filename is
 * configuration only and is never logged or exposed through MCP.
 */
export function createHttpCredentialProvider(
  env: NodeJS.ProcessEnv,
): HttpCredentialProvider {
  const path = env.INKSCAPE_MCP_HTTP_TOKENS_FILE;
  return path === undefined || path === ""
    ? new StaticHttpCredentialProvider(readHttpBearerToken(env))
    : new FileHttpCredentialProvider(path);
}

/** Wraps an official MCP v2 handler with the local HTTP security boundary. */
export function createSecureHttpHandler(
  config: ServerConfig,
  credentials: string | HttpCredentialProvider,
  handler?: FetchHandler,
  options: HttpMcpServerOptions = {},
): FetchHandler {
  const log = options.log ?? writeHttpLog;
  const runtime = createServerRuntime(config);
  const credentialProvider =
    typeof credentials === "string"
      ? new StaticHttpCredentialProvider(credentials)
      : credentials;
  const telemetry = new HttpTelemetry(log);
  const securedHandler =
    handler ??
    createMcpHandler(
      (context) => {
        if (context.authInfo === undefined)
          throw new Error("HTTP authentication is required");
        return buildServer(
          config,
          runtime,
          httpOwnerScope(context.authInfo.clientId),
        );
      },
      {
        legacy: "reject",
        maxSubscriptions: 16,
        onerror: () => log({ event: "http_server_error", status: 500 }),
      },
    );
  const limiter = new LocalRateLimiter();
  return {
    close: async () => {
      await securedHandler.close();
      await telemetry.shutdown();
    },
    async fetch(request: Request): Promise<Response> {
      const requestSpan = telemetry.start();
      const respond = (response: Response): Response => {
        requestSpan.finish(response.status);
        return response;
      };
      try {
        if (new URL(request.url).pathname !== HTTP_PATH)
          return respond(new Response("Not found", { status: 404 }));
        const rejected =
          hostHeaderValidationResponse(request, LOCAL_HOSTNAMES) ??
          originValidationResponse(request, LOCAL_HOSTNAMES);
        if (rejected) {
          log({
            event: "http_request_rejected",
            status: rejected.status as 400 | 403,
          });
          return respond(rejected);
        }
        if (!limiter.allow("loopback")) {
          log({ event: "http_request_rejected", status: 429 });
          return respond(
            new Response("Too many requests", {
              headers: { "Retry-After": "60" },
              status: 429,
            }),
          );
        }
        const auth = await authenticateBearer(
          request.headers.get("authorization"),
          credentialProvider,
        );
        if (auth === undefined) {
          log({ event: "http_server_error", status: 503 });
          return respond(
            new Response("Authentication temporarily unavailable", {
              status: 503,
            }),
          );
        }
        if (auth instanceof Response) {
          log({ event: "http_request_rejected", status: 401 });
          return respond(auth);
        }
        const ownerScope = httpOwnerScope(auth.clientId);
        requestSpan.setPrincipal(ownerScope.id);
        return respond(await securedHandler.fetch(request, { authInfo: auth }));
      } catch (error) {
        requestSpan.finish(500);
        throw error;
      }
    },
  };
}

/** Starts the opt-in loopback-only HTTP endpoint. */
export async function startHttpMcpServer(
  config: ServerConfig,
  credentials: string | HttpCredentialProvider,
  options: HttpMcpServerOptions = {},
): Promise<HttpMcpServer> {
  if (config.transport !== "http")
    throw new Error("HTTP server requires transport=http");
  const log = options.log ?? writeHttpLog;
  const handler = createSecureHttpHandler(config, credentials, undefined, {
    log,
  });
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

async function authenticateBearer(
  authorization: string | null,
  provider: HttpCredentialProvider,
): Promise<AuthInfo | Response | undefined> {
  const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/iu.exec(authorization ?? "");
  const actualToken = match?.[1];
  if (!actualToken)
    return new Response("Unauthorized", {
      headers: { "WWW-Authenticate": 'Bearer realm="inkscape-mcp"' },
      status: 401,
    });
  try {
    const auth = await provider.authenticate(authorization);
    return (
      auth ??
      new Response("Unauthorized", {
        headers: { "WWW-Authenticate": 'Bearer realm="inkscape-mcp"' },
        status: 401,
      })
    );
  } catch {
    return undefined;
  }
}

class StaticHttpCredentialProvider implements HttpCredentialProvider {
  public constructor(private readonly token: string) {}

  public async authenticate(
    authorization: string | null,
  ): Promise<AuthInfo | undefined> {
    return authenticateCredentials(authorization, [
      { clientId: "local-http-token", token: this.token },
    ]);
  }
}

class FileHttpCredentialProvider implements HttpCredentialProvider {
  public constructor(private readonly path: string) {}

  public async authenticate(
    authorization: string | null,
  ): Promise<AuthInfo | undefined> {
    return authenticateCredentials(authorization, await this.credentials());
  }

  private async credentials(): Promise<readonly HttpCredential[]> {
    const contents = await readFile(this.path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > 64 * 1024)
      throw new Error("HTTP credential source is invalid");
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("HTTP credential source is invalid");
    const entries = Object.entries(parsed).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length < 1 || entries.length > 32)
      throw new Error("HTTP credential source is invalid");
    return entries.map(([clientId, token]) => {
      if (
        !/^[A-Za-z0-9._-]{1,64}$/u.test(clientId) ||
        typeof token !== "string" ||
        !TOKEN_PATTERN.test(token)
      )
        throw new Error("HTTP credential source is invalid");
      return { clientId, token };
    });
  }
}

function authenticateCredentials(
  authorization: string | null,
  credentials: readonly HttpCredential[],
): AuthInfo | undefined {
  const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/iu.exec(authorization ?? "");
  const actualToken = match?.[1];
  if (!actualToken) return undefined;
  let selected: HttpCredential | undefined;
  for (const credential of credentials) {
    if (constantTimeTokenEquals(actualToken, credential.token))
      selected ??= credential;
  }
  return selected === undefined
    ? undefined
    : {
        clientId: selected.clientId,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        scopes: ["mcp"],
        token: actualToken,
      };
}

function constantTimeTokenEquals(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
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
