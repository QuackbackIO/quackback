/**
 * Audit attribution vocabulary, shared by the server that writes it and the
 * admin audit log that shows it.
 *
 * - channel: what carried a change. `ui` is a signed-in teammate in the app,
 *   `api` the REST API, `mcp` the MCP server, `assistant` the in-app assistant
 *   running a tool, `workflow` an automation run, `system` background work,
 *   `agent` the workspace's own AI agent answering customers.
 * - credential kind: what authenticated a non-UI change, an API key, an
 *   OAuth client or an AI agent's own credential.
 *
 * Both are stored as text, so a value is never renamed or reused once rows
 * carry it.
 */
export const AUDIT_CHANNELS = [
  'ui',
  'api',
  'mcp',
  'assistant',
  'workflow',
  'system',
  'agent',
] as const
export type AuditChannel = (typeof AUDIT_CHANNELS)[number]

export const AUDIT_CREDENTIAL_KINDS = ['api_key', 'oauth_client', 'agent_credential'] as const
export type AuditCredentialKind = (typeof AUDIT_CREDENTIAL_KINDS)[number]

export function isAuditChannel(value: unknown): value is AuditChannel {
  return typeof value === 'string' && (AUDIT_CHANNELS as readonly string[]).includes(value)
}
