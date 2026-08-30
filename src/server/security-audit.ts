export type SecurityAuditEvent = "sanitize_mode_trusted_rejected";

/**
 * Emits a fixed, non-sensitive security event. It deliberately records no
 * client path, document content, workspace identifier, or supplied value.
 */
export function writeSecurityAuditLog(
  event: SecurityAuditEvent,
  options: { write?: (line: string) => void } = {},
): void {
  const record = {
    component: "inkscape-mcp",
    event,
    outcome: "rejected",
    policy: "client-sanitize-mode",
  };
  (options.write ?? process.stderr.write.bind(process.stderr))(
    `${JSON.stringify(record)}\n`,
  );
}
