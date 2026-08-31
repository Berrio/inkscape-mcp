import { createHash } from "node:crypto";
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/index.js";
import { startHttpMcpServer } from "../../src/http.js";
import { buildServer } from "../../src/server/index.js";

const activeServers: ReturnType<typeof buildServer>[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

async function connectInMemory(
  mode: "legacy",
  configOptions: { maxInlineBytes?: number; workspaceRoots?: string[] } = {},
): Promise<Client> {
  const config = loadConfig({
    flags: {
      maxInlineBytes: configOptions.maxInlineBytes,
      workspaceRoots: configOptions.workspaceRoots ?? [process.cwd()],
    },
  });
  const server = buildServer(config);
  activeServers.push(server);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: "inkscape-mcp-in-memory-test", version: "0.1.0" },
    {
      versionNegotiation: { mode },
    },
  );
  await client.connect(clientTransport);
  return client;
}

describe("MCP compatibility contract", () => {
  it("serves the complete catalog through the in-process legacy SDK path", async () => {
    const client = await connectInMemory("legacy");
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.length).toBeGreaterThanOrEqual(80);
      expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
      expect(tools.some((tool) => tool.name === "inkscape_status")).toBe(true);
      const workspaceList = await client.callTool({
        arguments: {},
        name: "workspace_list",
      });
      expect(workspaceList.isError).not.toBe(true);
      expect(workspaceList.structuredContent).toMatchObject({
        workspaces: [expect.objectContaining({ id: expect.any(String) })],
      });
      expect(workspaceList.content[0]).toMatchObject({ type: "text" });
      const recoverableError = await client.callTool({
        arguments: {
          path: "missing.svg",
          workspaceId: "ws_0000000000000000",
        },
        name: "document_inspect",
      });
      expect(recoverableError.isError).toBe(true);
      expect(recoverableError.content[0]).toMatchObject({ type: "text" });
    } finally {
      await client.close();
    }
  });

  it("uses the SDK legacy mode explicitly over InMemoryTransport", async () => {
    const client = await connectInMemory("legacy");
    try {
      const result = await client.callTool({
        arguments: {},
        name: "workspace_list",
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        workspaces: [expect.objectContaining({ id: expect.any(String) })],
      });
      expect(client.getProtocolEra()).toBe("legacy");
      expect(client.getNegotiatedProtocolVersion()).toBe("2025-11-25");
    } finally {
      await client.close();
    }
  });

  it("negotiates the pinned modern revision with an in-process handler", async () => {
    const config = loadConfig({
      flags: { transport: "http", workspaceRoots: [process.cwd()] },
    });
    const token = "a".repeat(32);
    const server = await startHttpMcpServer(
      { ...config, http: { ...config.http, port: 0 } },
      token,
      { log: () => undefined },
    );
    const client = new Client(
      { name: "inkscape-mcp-modern-handler-test", version: "0.1.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(server.url), {
          authProvider: { token: async () => token },
        }),
      );
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      expect(client.getProtocolEra()).toBe("modern");
      expect((await client.listTools()).tools.length).toBeGreaterThanOrEqual(
        80,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("keeps a deterministic snapshot fingerprint of the full tool contract", async () => {
    const client = await connectInMemory("legacy");
    try {
      const tools = (await client.listTools()).tools
        .map(
          ({ annotations, description, inputSchema, name, outputSchema }) => ({
            annotations,
            description,
            inputSchema,
            name,
            outputSchema,
          }),
        )
        .sort((left, right) => left.name.localeCompare(right.name));
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(tools))
        .digest("hex");
      expect(fingerprint).toBe(
        "8aae2e2f54fb5f996811a9032c3ca395d842f8b3ed95f488b65895743269df07",
      );
    } finally {
      await client.close();
    }
  });
});
