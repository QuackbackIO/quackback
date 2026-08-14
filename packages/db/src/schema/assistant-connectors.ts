/**
 * Quinn Connectors — outbound MCP server connections.
 *
 * A connector is a remote MCP server Quackback dials so Quinn can call its
 * tools. Each discovered tool is catalogued on the connector and permissioned
 * individually (allow / ask / deny), matching the "Connectors" pattern used by
 * agent products: one connection, many tools, per-tool approval rules.
 *
 * Distinct from Quackback's inbound MCP *server* (`/api/mcp`), which exposes
 * Quackback to external agents.
 */
import { pgTable, text, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const ASSISTANT_CONNECTOR_TRANSPORTS = ['http'] as const
export type AssistantConnectorTransport = (typeof ASSISTANT_CONNECTOR_TRANSPORTS)[number]

/** Per-tool permission on a connector (Ask / Always allow / Deny). */
export type ConnectorToolRule = 'allow' | 'ask' | 'deny'

/** Cached tool catalogue entry from the last successful MCP tools/list. */
export interface StoredConnectorTool {
  /** Original MCP tool name from the remote server. */
  name: string
  description: string
  /**
   * JSON Schema for arguments (MCP inputSchema), stored as a JSON-encoded
   * string so TanStack Start server-fn serialization stays plain.
   */
  inputSchemaJson: string
}

/** Per-agent assignment: which Quinn agents may use this connector. */
export interface StoredConnectorAssignments {
  agent: boolean
  copilot: boolean
}

export const assistantConnectors = pgTable(
  'assistant_connectors',
  {
    id: typeIdWithDefault('assistant_connector')('id').primaryKey(),
    /** Admin-facing display name (e.g. "Linear", "GitHub"). */
    name: text('name').notNull(),
    /** URL-safe slug used in model-facing tool names: mcp_<slug>_<tool>. */
    slug: text('slug').notNull(),
    transport: text('transport', { enum: ASSISTANT_CONNECTOR_TRANSPORTS })
      .notNull()
      .default('http'),
    /** Remote MCP endpoint URL (Streamable HTTP). */
    url: text('url').notNull(),
    /**
     * Optional Bearer token (or similar). Encrypted at rest via
     * purpose `assistant-connector-auth` when present.
     */
    authTokenCiphertext: text('auth_token_ciphertext'),
    /** Last tools/list snapshot. */
    tools: jsonb('tools').$type<StoredConnectorTool[]>().notNull().default([]),
    /**
     * Per-tool permission rules keyed by original MCP tool name.
     * Missing key ⇒ default `ask` (safe).
     */
    toolRules: jsonb('tool_rules').$type<Record<string, ConnectorToolRule>>().notNull().default({}),
    assignments: jsonb('assignments')
      .$type<StoredConnectorAssignments>()
      .notNull()
      .default({ agent: true, copilot: true }),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    createdById: typeIdColumnNullable('principal')('created_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('assistant_connectors_slug_unique').on(sql`lower(${table.slug})`),
    index('assistant_connectors_enabled_idx').on(table.enabled),
  ]
)

export type AssistantConnectorRow = typeof assistantConnectors.$inferSelect
export type NewAssistantConnector = typeof assistantConnectors.$inferInsert
