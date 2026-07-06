/**
 * Single source of truth for the AI config changelog's event -> label map.
 * Read by both the assistant admin page's "Recent changes" card
 * (assistant-config-changelog-card.tsx) and the audit-log page's "AI config"
 * filter group (audit-log-page.tsx), so a new assistant.* event only needs
 * to be added here to show up correctly in both places.
 *
 * Client-safe: `AuditEventType` is imported as a type only, which is erased
 * at compile time, so no server code (db/pino/redis) reaches the client
 * bundle. The `Record<Extract<...>, string>` shape means adding a new
 * `assistant.*` literal to the AuditEventType union without a matching entry
 * here is a compile error — the label map can never drift from the taxonomy.
 */
import type { AuditEventType } from '@/lib/server/audit/log'

export const ASSISTANT_CONFIG_EVENT_LABELS: Record<
  Extract<AuditEventType, `assistant.${string}`>,
  string
> = {
  'assistant.guidance.created': 'Guidance rule created',
  'assistant.guidance.updated': 'Guidance rule updated',
  'assistant.guidance.reordered': 'Guidance rules reordered',
  'assistant.guidance.deleted': 'Guidance rule deleted',
  'assistant.tool_controls.changed': 'Tool controls changed',
  'assistant.surfaces.changed': 'Surface instructions changed',
  'assistant.basics.changed': 'Basics changed',
  'assistant.connector.created': 'Connector created',
  'assistant.connector.updated': 'Connector updated',
  'assistant.connector.deleted': 'Connector deleted',
}
