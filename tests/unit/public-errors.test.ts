import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { redactDiagnostic } from "../../src/config/index.js";
import {
  publicErrorMessage,
  PublicToolError,
  withPublicErrors,
} from "../../src/server/public-errors.js";

const ABSOLUTE_PATH =
  /[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|(?<![\w.])\/(?:[^\s/]+\/)+/u;

describe("public MCP error messages", () => {
  it("replaces Node.js system errors with stable, path-free text", async () => {
    const error = await readFile(join(tmpdir(), "missing", "secret.svg")).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as Error).message)).toMatch(ABSOLUTE_PATH);
    expect(publicErrorMessage(error)).toBe(
      "File system entry is unavailable (ENOENT)",
    );
    const busy = Object.assign(new Error("EBUSY: open 'C:\\x\\a.svg'"), {
      code: "EBUSY",
      syscall: "open",
    });
    expect(publicErrorMessage(busy)).toBe(
      "File is locked by another program (EBUSY)",
    );
  });
  it("redacts Windows, UNC and POSIX paths in other messages", () => {
    expect(
      publicErrorMessage(
        new Error(
          "failed C:\\Users\\me\\a.svg \\\\host\\share\\b.svg /home/me/c.svg image/png",
        ),
      ),
    ).toBe("failed <redacted-path> <redacted-path> <redacted-path> image/png");
    expect(redactDiagnostic("ratio 1/2 and /tmp/x/y")).toBe(
      "ratio 1/2 and <redacted-path>",
    );
  });
  it("wraps handlers without losing protocol control-flow errors", async () => {
    await expect(
      withPublicErrors(async () => {
        throw Object.assign(new Error("ENOENT: realpath 'C:\\root'"), {
          code: "ENOENT",
          syscall: "realpath",
        });
      })(),
    ).rejects.toEqual(
      new PublicToolError("File system entry is unavailable (ENOENT)"),
    );
    const protocol = new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      "invalid",
    );
    await expect(
      withPublicErrors(async () => {
        throw protocol;
      })(),
    ).rejects.toBe(protocol);
    await expect(withPublicErrors(async () => "ok")()).resolves.toBe("ok");
  });
  it("does not leak a removed workspace root through a real tool call", async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), "inkscape-mcp-public-errors-"),
    );
    const client = new Client(
      { name: "public-errors-test", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(
      new StdioClientTransport({
        args: ["dist/cli.js", "--workspace-root", workspace],
        command: process.execPath,
        cwd: process.cwd(),
        stderr: "pipe",
      }),
    );
    try {
      const listed = await client.callTool({
        arguments: {},
        name: "workspace_list",
      });
      const workspaceId = (
        listed.structuredContent as { workspaces: { id: string }[] }
      ).workspaces[0]!.id;
      await rm(workspace, { force: true, recursive: true });
      const result = await client.callTool({
        arguments: { workspaceId },
        name: "workspace_list_documents",
      });
      const text = JSON.stringify(result.content);
      expect(result.isError).toBe(true);
      expect(text).not.toMatch(ABSOLUTE_PATH);
      expect(text).toContain("ENOENT");
    } finally {
      await client.close();
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);
});
