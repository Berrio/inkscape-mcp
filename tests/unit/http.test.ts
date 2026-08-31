import { describe, expect, it } from "vitest";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { DEFAULT_CONFIG } from "../../src/config/index.js";
import {
  createSecureHttpHandler,
  createHttpCredentialProvider,
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
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "http_request_completed",
        principal: expect.stringMatching(/^http_[a-f0-9]{24}$/u),
        status: 200,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("127.0.0.1");
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

  it("rotates a local multi-principal credential file without restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-http-auth-"));
    const credentialPath = join(directory, "credentials.json");
    const oldToken = "a".repeat(32);
    const newToken = "b".repeat(32);
    await writeFile(
      credentialPath,
      JSON.stringify({ designer_a: oldToken, designer_b: token }),
      "utf8",
    );
    const provider = createHttpCredentialProvider({
      INKSCAPE_MCP_HTTP_TOKENS_FILE: credentialPath,
    });
    const handler = createSecureHttpHandler(
      config,
      provider,
      { close: async () => undefined, fetch: async () => new Response("ok") },
      { log: () => undefined },
    );
    const request = (value: string) =>
      new Request("http://127.0.0.1:3000/mcp", {
        headers: {
          Authorization: `Bearer ${value}`,
          Host: "127.0.0.1:3000",
        },
      });
    try {
      expect((await handler.fetch(request(oldToken))).status).toBe(200);
      expect((await handler.fetch(request(token))).status).toBe(200);
      const replacement = join(directory, "credentials.next.json");
      await writeFile(
        replacement,
        JSON.stringify({ designer_a: newToken }),
        "utf8",
      );
      await rename(replacement, credentialPath);
      expect((await handler.fetch(request(oldToken))).status).toBe(401);
      expect((await handler.fetch(request(token))).status).toBe(401);
      expect((await handler.fetch(request(newToken))).status).toBe(200);
    } finally {
      await handler.close();
      await rm(directory, { force: true, recursive: true });
    }
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

  it("binds HTTP document resources to the authenticated principal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inkscape-mcp-http-owner-"));
    const credentialPath = join(directory, "credentials.json");
    const alphaToken = "c".repeat(32);
    const betaToken = "d".repeat(32);
    await writeFile(
      credentialPath,
      JSON.stringify({ alpha: alphaToken, beta: betaToken }),
      "utf8",
    );
    await writeFile(
      join(directory, "source.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',
      "utf8",
    );
    const server = await startHttpMcpServer(
      {
        ...config,
        http: { ...config.http, port: 0 },
        workspaceRoots: [directory],
      },
      createHttpCredentialProvider({
        INKSCAPE_MCP_HTTP_TOKENS_FILE: credentialPath,
      }),
      { log: () => undefined },
    );
    const connect = async (name: string, currentToken: string) => {
      const client = new Client(
        { name, version: "0.0.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          authProvider: { token: async () => currentToken },
        }),
      );
      return client;
    };
    const alpha = await connect("owner-alpha", alphaToken);
    const beta = await connect("owner-beta", betaToken);
    try {
      const workspace = await alpha.callTool({
        arguments: {},
        name: "workspace_list",
      });
      const workspaceId = workspace.structuredContent?.workspaces?.[0]?.id;
      expect(typeof workspaceId).toBe("string");
      const inspected = await alpha.callTool({
        arguments: { level: "summary", path: "source.svg", workspaceId },
        name: "document_inspect",
      });
      expect(inspected.isError).not.toBe(true);
      const summaryUri = inspected.structuredContent?.resources?.summaryUri;
      expect(typeof summaryUri).toBe("string");
      await expect(
        alpha.readResource({ uri: summaryUri }),
      ).resolves.toMatchObject({
        contents: [expect.objectContaining({ mimeType: "application/json" })],
      });
      await expect(beta.readResource({ uri: summaryUri })).rejects.toThrow(
        "Document resource is unavailable",
      );
    } finally {
      await alpha.close();
      await beta.close();
      await server.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
