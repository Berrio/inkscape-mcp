import { createHash } from "node:crypto";

/**
 * Derives the internal owner keys used by durable process state. The principal
 * identifier never leaves this module: stored keys contain only a fixed-length
 * digest and the already opaque workspace ID.
 */
export type OwnerScope = {
  id: string;
  ownerForWorkspace: (workspaceId: string) => string;
  owns: (owner: string) => boolean;
};

export function httpOwnerScope(principalId: string): OwnerScope {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(principalId))
    throw new Error("HTTP principal is invalid");
  const principal = createHash("sha256")
    .update(`inkscape-mcp/http-principal/v1\0${principalId}`)
    .digest("hex")
    .slice(0, 24);
  const prefix = `http_${principal}_`;
  return {
    id: `http_${principal}`,
    ownerForWorkspace: (workspaceId) => `${prefix}${workspaceId}`,
    owns: (owner) => owner.startsWith(`${prefix}ws_`),
  };
}
