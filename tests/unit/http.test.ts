import { describe, expect, it } from "vitest";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { DEFAULT_CONFIG } from "../../src/config/index.js";
import {
  createSecureHttpHandler,
  readHttpBearerToken,
  startHttpMcpServer,
} from "../../src/http.js";

const token = "12345678901234567890123456789012";
const config = {
  ...DEFAULT_CONFIG,
  transport: "http" as const,
};

describe("secure local HTTP transport", () => {
  it("requires a high-entropy environment token", () => {
    expect(() => readHttpBearerToken({})).toThrow("INKSCAPE_MCP_HTTP_TOKEN");
    expect(() =>
      readHttpBearerToken({ INKSCAPE_MCP_HTTP_TOKEN: "too-short" }),
    ).toThrow("at least 32");
    expect(readHttpBearerToken({ INKSCAPE_MCP_HTTP_TOKEN: token })).toBe(token);
  });

  it("gates the official handler behind host, origin and bearer validation", async () => {
    const calls: Request[] = [];
    const events: unknown[] = [];
    const handler = createSecureHttpHandler(
      config,
      token,
      {
        close: async () => undefined,
        fetch: async (request) => {
          calls.push(request);
          return new Response("ok");
        },
      },
      { log: (event) => events.push(event) },
    );

    expect(
      (
        await handler.fetch(
          new Request("http://127.0.0.1:3000/mcp", {
            headers: { Host: "127.0.0.1:3000" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler.fetch(
          new Request("http://attacker.example/mcp", {
            headers: {
              Authorization: `Bearer ${token}`,
              Host: "attacker.example",
            },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler.fetch(
          new Request("http://127.0.0.1:3000/mcp", {
            headers: {
              Authorization: `Bearer ${token}`,
              Host: "127.0.0.1:3000",
              Origin: "https://attacker.example",
            },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handler.fetch(
          new Request("http://127.0.0.1:3000/not-mcp", {
            headers: {
              Authorization: `Bearer ${token}`,
              Host: "127.0.0.1:3000",
            },
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handler.fetch(
          new Request("http://127.0.0.1:3000/mcp", {
            headers: {
              Authorization: `Bearer ${token}`,
              Host: "127.0.0.1:3000",
            },
          }),
        )
      ).status,
    ).toBe(200);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(token);
    expect(events).toContainEqual({
      event: "http_request_rejected",
      status: 401,
    });
  });

  it("rate limits even if a caller forges forwarding headers", async () => {
    const handler = createSecureHttpHandler(
      config,
      token,
      {
        close: async () => undefined,
        fetch: async () => new Response("ok"),
      },
      { log: () => undefined },
    );
    for (let index = 0; index < 120; index += 1) {
      const response = await handler.fetch(
        new Request("http://127.0.0.1:3000/mcp", {
          headers: {
            Authorization: `Bearer ${token}`,
            Host: "127.0.0.1:3000",
            "X-Forwarded-For": `forged-${index}`,
          },
        }),
      );
      expect(response.status).toBe(200);
    }
    const rejected = await handler.fetch(
      new Request("http://127.0.0.1:3000/mcp", {
        headers: {
          Authorization: `Bearer ${token}`,
          Host: "127.0.0.1:3000",
        },
      }),
    );
    expect(rejected.status).toBe(429);
  });

  it("binds the real listener locally and refuses unauthenticated requests", async () => {
    const events: unknown[] = [];
    const server = await startHttpMcpServer(
      {
        ...config,
        http: { ...config.http, port: 0 },
      },
      token,
      { log: (event) => events.push(event) },
    );
    try {
      const response = await fetch(server.url, {
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(response.status).toBe(401);
      expect(events).toContainEqual({ event: "http_listening" });
    } finally {
      await server.close();
    }
  });

  it("serves a modern authenticated MCP client end to end", async () => {
    const server = await startHttpMcpServer(
      { ...config, http: { ...config.http, port: 0 } },
      token,
      { log: () => undefined },
    );
    const client = new Client(
      { name: "http-transport-test", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          authProvider: { token: async () => token },
        }),
      );
      const { tools } = await client.listTools();
      expect(tools.some((tool) => tool.name === "inkscape_status")).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
